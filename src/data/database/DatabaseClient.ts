import * as SQLite from 'expo-sqlite';
import { DatabaseError, DatabaseErrorCode } from '../../core/errors/AppError';
import { Logger } from '../../core/logging/Logger';
import { INITIAL_SCHEMA_SQL, SCHEMA_VERSION } from './schema';

export const DB_FILE_NAME = 'kiosco_ledger.db';

export class DatabaseClient {
  private static instance: DatabaseClient | null = null;
  private db: SQLite.SQLiteDatabase | null = null;
  // Comparto la promesa de inicialización para evitar condiciones de carrera si dos módulos solicitan conexión simultáneamente.
  private initPromise: Promise<SQLite.SQLiteDatabase> | null = null;
  private readonly logger = new Logger('DatabaseClient');

  private constructor() {}

  public static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  public async getConnection(): Promise<SQLite.SQLiteDatabase> {
    if (this.db) {
      return this.db;
    }

    if (!this.initPromise) {
      this.initPromise = this.openAndMigrate();
    }

    try {
      return await this.initPromise;
    } catch (error: unknown) {
      this.initPromise = null;
      throw error;
    }
  }

  public async closeConnection(): Promise<void> {
    if (!this.db) {
      return;
    }

    try {
      // Cierro el descriptor de archivo antes de ejecutar un backup o el borrado físico de emergencia.
      await this.db.closeAsync();
      this.db = null;
      this.initPromise = null;
      this.logger.info('Conexión SQLite cerrada correctamente', { dbName: DB_FILE_NAME });
    } catch (error: unknown) {
      const dbError = this.classifySqliteError(error, 'DB_QUERY_ERROR', 'Error al cerrar la conexión SQLite');
      this.logger.error(dbError.message, dbError);
      throw dbError;
    }
  }

  private async openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
    try {
      const database = await SQLite.openDatabaseAsync(DB_FILE_NAME);
      await this.runMigrations(database);
      this.db = database;
      this.logger.info('Conexión SQLite inicializada y migrada', {
        dbName: DB_FILE_NAME,
        schemaVersion: SCHEMA_VERSION,
      });
      return database;
    } catch (error: unknown) {
      const dbError = this.classifySqliteError(
        error,
        'DB_INITIALIZATION_ERROR',
        'Fallo al abrir o migrar la base de datos SQLite'
      );
      this.logger.error(dbError.message, dbError);
      throw dbError;
    }
  }

  private async runMigrations(database: SQLite.SQLiteDatabase): Promise<void> {
    const versionRow = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
    const currentVersion = versionRow?.user_version ?? 0;

    if (currentVersion >= SCHEMA_VERSION) {
      await database.execAsync('PRAGMA foreign_keys = ON;');
      return;
    }

    // Uso PRAGMA user_version dentro de una transacción para garantizar migraciones atómicas e idempotentes.
    await database.withTransactionAsync(async () => {
      if (currentVersion === 0) {
        await database.execAsync(INITIAL_SCHEMA_SQL);
      }
      await database.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    });
  }

  private classifySqliteError(
    error: unknown,
    fallbackCode: DatabaseErrorCode,
    fallbackMessage: string
  ): DatabaseError {
    if (error instanceof DatabaseError) {
      return error;
    }

    const rawMessage = error instanceof Error ? error.message : String(error);

    if (rawMessage.includes('SQLITE_CONSTRAINT')) {
      return new DatabaseError('DB_CONSTRAINT_ERROR', 'Violación de restricción de integridad en SQLite', { rawMessage }, error);
    }
    if (rawMessage.includes('SQLITE_BUSY') || rawMessage.includes('SQLITE_LOCKED')) {
      return new DatabaseError('DB_LOCKED_ERROR', 'Base de datos bloqueada por otra operación concurrente', { rawMessage }, error);
    }
    if (rawMessage.includes('SQLITE_CORRUPT') || rawMessage.includes('file is not a database')) {
      return new DatabaseError('DB_CORRUPT_ERROR', 'El archivo de base de datos está corrupto o es inválido', { rawMessage }, error);
    }

    return new DatabaseError(fallbackCode, fallbackMessage, { dbName: DB_FILE_NAME, rawMessage }, error);
  }
}