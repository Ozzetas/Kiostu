import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { z } from 'zod';
import { PRODUCT_IMAGES_DIR_NAME } from '../../application/services/EmergencyWipeService';
import { FileSystemError, MediaError, ValidationError } from '../../core/errors/AppError';
import { Logger } from '../../core/logging/Logger';
import {
  IImageStorageService,
  StoredImageResult,
} from '../../domain/services/IImageStorageService';

const ICON_DIMENSION_PX = 300;
const JPEG_COMPRESS_QUALITY = 0.75;
const DOWNLOAD_TIMEOUT_MS = 10_000;
const MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9_-]+\.jpg$/;

const ALLOWED_IMAGE_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const RemoteImageUrlSchema = z
  .string()
  .trim()
  .url('La URL de la imagen no tiene un formato válido.')
  .refine((value) => value.startsWith('https://') || value.startsWith('http://'), {
    message: 'Solo se permiten enlaces HTTP o HTTPS para descargar imágenes.',
  });

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

  public async importFromUrl(rawUrl: string): Promise<StoredImageResult> {
    const parsedUrl = RemoteImageUrlSchema.safeParse(rawUrl);
    if (!parsedUrl.success) {
      const firstIssue = parsedUrl.error.issues[0]?.message ?? 'URL de imagen inválida.';
      throw new ValidationError(firstIssue, { rawUrl });
    }

    const tempFile = new File(Paths.cache, `download_${Crypto.randomUUID()}.tmp`);

    try {
      const imageBytes = await this.downloadImageBytesWithTimeout(parsedUrl.data);
      tempFile.write(imageBytes);
      return await this.processAndPersistIcon(tempFile.uri);
    } finally {
      this.safeDeleteFile(tempFile);
    }
  }

  public resolveImageUri(fileName: string | null): string | null {
    if (fileName === null || fileName.length === 0) {
      return null;
    }

    // Valido formato estricto para bloquear intentos de path traversal (ej. "../kiosco_ledger.db").
    if (!SAFE_FILENAME_REGEX.test(fileName)) {
      this.logger.warn('Nombre de imagen inválido descartado al resolver URI', { fileName });
      return null;
    }

    const targetFile = new File(this.getImagesDirectory(), fileName);
    return targetFile.uri;
  }

  public async deleteImage(fileName: string): Promise<void> {
    if (!SAFE_FILENAME_REGEX.test(fileName)) {
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

  private async downloadImageBytesWithTimeout(url: string): Promise<Uint8Array> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new MediaError(
          'NETWORK_DOWNLOAD_ERROR',
          `El servidor respondió con estado HTTP ${response.status} al descargar la imagen.`,
          { url, status: response.status }
        );
      }

      const rawContentType = response.headers.get('content-type') ?? '';
      const normalizedMime = (rawContentType.split(';')[0] ?? '').trim().toLowerCase();
      if (!ALLOWED_IMAGE_MIME_TYPES.has(normalizedMime)) {
        throw new ValidationError('El enlace ingresado no corresponde a una imagen compatible.', {
          url,
          contentType: rawContentType,
        });
      }

      const contentLengthHeader = response.headers.get('content-length');
      if (contentLengthHeader !== null) {
        const declaredBytes = Number(contentLengthHeader);
        if (Number.isFinite(declaredBytes) && declaredBytes > MAX_REMOTE_IMAGE_BYTES) {
          throw new ValidationError('La imagen remota supera el límite permitido de 10 MB.', {
            url,
            declaredBytes,
          });
        }
      }

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_REMOTE_IMAGE_BYTES) {
        throw new ValidationError('El archivo descargado está vacío o supera el límite de 10 MB.', {
          url,
          byteLength: buffer.byteLength,
        });
      }

      return new Uint8Array(buffer);
    } catch (error: unknown) {
      if (error instanceof MediaError || error instanceof ValidationError) {
        this.logger.error(error.message, error);
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError = new MediaError(
          'NETWORK_TIMEOUT_ERROR',
          'Tiempo de espera agotado al descargar la imagen desde internet.',
          { url, timeoutMs: DOWNLOAD_TIMEOUT_MS },
          error
        );
        this.logger.error(timeoutError.message, timeoutError);
        throw timeoutError;
      }

      const netError = new MediaError(
        'NETWORK_DOWNLOAD_ERROR',
        'Error de red al intentar descargar la imagen.',
        { url },
        error
      );
      this.logger.error(netError.message, netError);
      throw netError;
    } finally {
      clearTimeout(timeoutId);
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

  private safeDeleteFile(file: File): void {
    try {
      if (file.exists) {
        file.delete();
      }
    } catch (error: unknown) {
      this.logger.warn('No se pudo eliminar un archivo temporal de imagen', {
        uri: file.uri,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}