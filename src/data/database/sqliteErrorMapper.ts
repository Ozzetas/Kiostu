import { AppError, DatabaseError, DatabaseErrorCode } from '../../core/errors/AppError';

export function mapSqliteError(
  error: unknown,
  fallbackCode: DatabaseErrorCode,
  fallbackMessage: string,
  context?: Record<string, unknown>
): AppError {
  // Propago errores de dominio ya clasificados (stock insuficiente, entidad inexistente, validación) sin enmascararlos.
  if (error instanceof AppError) {
    return error;
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  const mergedContext = { ...context, rawMessage };

  if (rawMessage.includes('SQLITE_CONSTRAINT')) {
    return new DatabaseError(
      'DB_CONSTRAINT_ERROR',
      'Violación de restricción de integridad en SQLite',
      mergedContext,
      error
    );
  }

  if (rawMessage.includes('SQLITE_BUSY') || rawMessage.includes('SQLITE_LOCKED')) {
    return new DatabaseError(
      'DB_LOCKED_ERROR',
      'La base de datos está bloqueada por otra operación concurrente',
      mergedContext,
      error
    );
  }

  if (rawMessage.includes('SQLITE_CORRUPT') || rawMessage.includes('file is not a database')) {
    return new DatabaseError(
      'DB_CORRUPT_ERROR',
      'El archivo de base de datos SQLite está corrupto',
      mergedContext,
      error
    );
  }

  return new DatabaseError(fallbackCode, fallbackMessage, mergedContext, error);
}