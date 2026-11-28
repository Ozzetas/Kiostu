import * as SQLite from 'expo-sqlite';
import { Logger } from '../../core/logging/Logger';
import {
  CONNECTION_PRAGMAS_SQL,
  INITIAL_SCHEMA_SQL,
  MIGRATION_V1_TO_V2_SQL,
  MIGRATION_V2_TO_V3_SQL,
  SCHEMA_VERSION,
} from './schema';
import { mapSqliteError } from './sqliteErrorMapper';

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
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al cerrar la conexión SQLite', {
        dbName: DB_FILE_NAME,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  private async openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
    try {
      const database = await SQLite.openDatabaseAsync(DB_FILE_NAME);
      // Configuro WAL, foreign_keys y busy_timeout fuera de transacción antes de ejecutar migraciones DDL.
      await database.execAsync(CONNECTION_PRAGMAS_SQL);
      await this.runMigrations(database);

      this.db = database;
      this.logger.info('Conexión SQLite inicializada y migrada', {
        dbName: DB_FILE_NAME,
        schemaVersion: SCHEMA_VERSION,
      });
      return database;
    } catch (error: unknown) {
      const mapped = mapSqliteError(
        error,
        'DB_INITIALIZATION_ERROR',
        'Fallo al abrir o migrar la base de datos SQLite',
        { dbName: DB_FILE_NAME }
      );
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  private async runMigrations(database: SQLite.SQLiteDatabase): Promise<void> {
    const versionRow = await database.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version;'
    );
    const currentVersion = versionRow?.user_version ?? 0;

    if (currentVersion >= SCHEMA_VERSION) {
      return;
    }

    // Uso transacción exclusiva y user_version para asegurar migraciones atómicas e idempotentes.
    await database.withExclusiveTransactionAsync(async (txn) => {
      if (currentVersion === 0) {
        await txn.execAsync(INITIAL_SCHEMA_SQL);
      } else {
        if (currentVersion < 2) {
          await txn.execAsync(MIGRATION_V1_TO_V2_SQL);
        }
        if (currentVersion < 3) {
          await txn.execAsync(MIGRATION_V2_TO_V3_SQL);
        }
      }
      await txn.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    });
  }
}