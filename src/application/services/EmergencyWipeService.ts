import { Directory, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { FileSystemError, SecurityError } from '../../core/errors/AppError';
import { Logger } from '../../core/logging/Logger';
import { DatabaseClient, DB_FILE_NAME } from '../../data/database/DatabaseClient';
import { ISecurityRepository } from '../../domain/repositories/ISecurityRepository';

export const PRODUCT_IMAGES_DIR_NAME = 'product_images';
export const BACKUP_STAGING_DIR_NAME = 'backup_staging';

export class EmergencyWipeService {
  private readonly logger = new Logger('EmergencyWipeService');

  constructor(
    private readonly databaseClient: DatabaseClient,
    private readonly securityRepository: ISecurityRepository
  ) {}

  public async executeSilentWipe(): Promise<void> {
    try {
      // 1. Cierro el descriptor activo de SQLite y elimino físicamente .db, -wal y -shm del disco.
      await this.databaseClient.closeConnection();
      await SQLite.deleteDatabaseAsync(DB_FILE_NAME);

      // 2. Elimino las carpetas locales de imágenes de productos y temporales de backup.
      this.removeDirectoryIfExists(new Directory(Paths.document, PRODUCT_IMAGES_DIR_NAME));
      this.removeDirectoryIfExists(new Directory(Paths.cache, BACKUP_STAGING_DIR_NAME));

      // 3. Elimino la credencial de pánico para no dejar evidencia de configuración de emergencia.
      await this.securityRepository.deletePanicCredential();

      // 4. Re-inicializo un esquema vacío limpio y marco actividad para abrir la app sin carteles delatores.
      await this.databaseClient.getConnection();
      await this.securityRepository.updateLastActivityAt(Date.now());

      this.logger.info('Restablecimiento de emergencia completado');
    } catch (error: unknown) {
      if (error instanceof SecurityError || error instanceof FileSystemError) {
        throw error;
      }

      const wipeError = new SecurityError(
        'EMERGENCY_WIPE_ERROR',
        'Fallo crítico durante el borrado físico de emergencia',
        undefined,
        error
      );
      this.logger.error(wipeError.message, wipeError);
      throw wipeError;
    }
  }

  private removeDirectoryIfExists(directory: Directory): void {
    try {
      if (directory.exists) {
        directory.delete();
      }
    } catch (error: unknown) {
      const fsError = new FileSystemError(
        'No se pudo eliminar el directorio local durante el restablecimiento',
        { uri: directory.uri },
        error
      );
      this.logger.error(fsError.message, fsError);
      throw fsError;
    }
  }
}