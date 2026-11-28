import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { PRODUCT_IMAGES_DIR_NAME } from '../../application/services/EmergencyWipeService';
import { FileSystemError, MediaError, ValidationError } from '../../core/errors/AppError';
import { Logger } from '../../core/logging/Logger';
import { isStoredImageFileName, parseProductVisual } from '../../core/utils/productVisual';
import {
  IImageStorageService,
  StoredImageResult,
} from '../../domain/services/IImageStorageService';

const ICON_DIMENSION_PX = 300;
const JPEG_COMPRESS_QUALITY = 0.75;

export class ImageStorageService implements IImageStorageService {
  private readonly logger = new Logger('ImageStorageService');

  public async pickFromCamera(): Promise<StoredImageResult | null> {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      const error = new MediaError(
        'MEDIA_PERMISSION_DENIED',
        'Permiso de cámara denegado por el usuario.',
        { canAskAgain: permission.canAskAgain }
      );
      this.logger.warn(error.message, error.context);
      throw error;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });

    const selectedAsset = result.assets?.[0];
    if (result.canceled || !selectedAsset) {
      return null;
    }

    return this.processAndPersistIcon(selectedAsset.uri);
  }

  public async pickFromGallery(): Promise<StoredImageResult | null> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      const error = new MediaError(
        'MEDIA_PERMISSION_DENIED',
        'Permiso de acceso a la galería denegado por el usuario.',
        { canAskAgain: permission.canAskAgain }
      );
      this.logger.warn(error.message, error.context);
      throw error;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });

    const selectedAsset = result.assets?.[0];
    if (result.canceled || !selectedAsset) {
      return null;
    }

    return this.processAndPersistIcon(selectedAsset.uri);
  }

  public resolveImageUri(fileName: string | null): string | null {
    if (fileName === null || fileName.length === 0) {
      return null;
    }

    // Descarto emojis en silencio y bloqueo cualquier nombre malformado para evitar path traversal.
    const visual = parseProductVisual(fileName);
    if (visual.kind === 'EMOJI') {
      return null;
    }

    if (visual.kind !== 'IMAGE') {
      this.logger.warn('Nombre de imagen inválido descartado al resolver URI', { fileName });
      return null;
    }

    const targetFile = new File(this.getImagesDirectory(), visual.fileName);
    return targetFile.uri;
  }

  public async deleteImage(fileName: string): Promise<void> {
    if (!isStoredImageFileName(fileName)) {
      throw new ValidationError('Nombre de archivo de imagen inválido.', { fileName });
    }

    const targetFile = new File(this.getImagesDirectory(), fileName);
    try {
      if (targetFile.exists) {
        targetFile.delete();
      }
      this.logger.info('Imagen de producto eliminada del almacenamiento local', { fileName });
    } catch (error: unknown) {
      const fsError = new FileSystemError(
        'Error al eliminar la imagen local del producto',
        { fileName, uri: targetFile.uri },
        error
      );
      this.logger.error(fsError.message, fsError);
      throw fsError;
    }
  }

  public async pruneOrphanImages(referencedFileNames: ReadonlySet<string>): Promise<number> {
    const imagesDir = this.getImagesDirectory();
    if (!imagesDir.exists) {
      return 0;
    }

    let removedCount = 0;
    try {
      const entries = imagesDir.list();
      for (const entry of entries) {
        if (entry instanceof File && !referencedFileNames.has(entry.name)) {
          entry.delete();
          removedCount += 1;
        }
      }

      if (removedCount > 0) {
        this.logger.info('Limpieza de imágenes huérfanas completada', { removedCount });
      }
      return removedCount;
    } catch (error: unknown) {
      const fsError = new FileSystemError(
        'Fallo al ejecutar la limpieza de imágenes huérfanas',
        { dirUri: imagesDir.uri },
        error
      );
      this.logger.error(fsError.message, fsError);
      throw fsError;
    }
  }

  private async processAndPersistIcon(sourceUri: string): Promise<StoredImageResult> {
    const imagesDir = this.ensureImagesDirectory();
    const fileName = `${Crypto.randomUUID()}.jpg`;
    const destinationFile = new File(imagesDir, fileName);

    let manipulatorContext: ReturnType<typeof ImageManipulator.manipulate> | null = null;
    let renderedImage: Awaited<
      ReturnType<ReturnType<typeof ImageManipulator.manipulate>['renderAsync']>
    > | null = null;

    try {
      manipulatorContext = ImageManipulator.manipulate(sourceUri);
      manipulatorContext.resize({ width: ICON_DIMENSION_PX, height: ICON_DIMENSION_PX });
      renderedImage = await manipulatorContext.renderAsync();

      const savedResult = await renderedImage.saveAsync({
        compress: JPEG_COMPRESS_QUALITY,
        format: SaveFormat.JPEG,
      });

      // Copio sin borrar manualmente el caché de ImageManipulator para evitar condiciones de carrera con iOS.
      const processedTempFile = new File(savedResult.uri);
      processedTempFile.copy(destinationFile);

      this.logger.info('Ícono de producto comprimido y persistido localmente', {
        fileName,
        width: savedResult.width,
        height: savedResult.height,
      });

      return {
        fileName,
        resolvedUri: destinationFile.uri,
      };
    } catch (error: unknown) {
      const mediaError = new MediaError(
        'MEDIA_PROCESSING_ERROR',
        'No se pudo redimensionar o guardar la imagen del producto.',
        { fileName },
        error
      );
      this.logger.error(mediaError.message, mediaError);
      throw mediaError;
    } finally {
      renderedImage?.release();
      manipulatorContext?.release();
    }
  }

  private getImagesDirectory(): Directory {
    return new Directory(Paths.document, PRODUCT_IMAGES_DIR_NAME);
  }

  private ensureImagesDirectory(): Directory {
    const dir = this.getImagesDirectory();
    if (!dir.exists) {
      dir.create({ intermediates: true });
    }
    return dir;
  }
}