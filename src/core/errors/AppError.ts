export type ErrorCode =
  | 'DB_INITIALIZATION_ERROR'
  | 'DB_QUERY_ERROR'
  | 'DB_TRANSACTION_ERROR'
  | 'DB_CONSTRAINT_ERROR'
  | 'DB_LOCKED_ERROR'
  | 'DB_CORRUPT_ERROR'
  | 'VALIDATION_ERROR'
  | 'INSUFFICIENT_STOCK'
  | 'ENTITY_NOT_FOUND'
  | 'ARITHMETIC_OVERFLOW_ERROR'
  | 'FILE_SYSTEM_ERROR'
  | 'SECURITY_STORAGE_ERROR'
  | 'BIOMETRIC_AUTH_ERROR'
  | 'EMERGENCY_WIPE_ERROR'
  | 'CRYPTO_OPERATION_ERROR'
  | 'MEDIA_PERMISSION_DENIED'
  | 'MEDIA_PROCESSING_ERROR';

export abstract class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly context?: Record<string, unknown>;
  public readonly originalError?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    context?: Record<string, unknown>,
    originalError?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    this.originalError = originalError;
    // Restauro la cadena de prototipos para que instanceof funcione tras transpilar a ES5/ES6.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type DatabaseErrorCode = Extract<
  ErrorCode,
  | 'DB_INITIALIZATION_ERROR'
  | 'DB_QUERY_ERROR'
  | 'DB_TRANSACTION_ERROR'
  | 'DB_CONSTRAINT_ERROR'
  | 'DB_LOCKED_ERROR'
  | 'DB_CORRUPT_ERROR'
>;

export class DatabaseError extends AppError {
  constructor(
    code: DatabaseErrorCode,
    message: string,
    context?: Record<string, unknown>,
    originalError?: unknown
  ) {
    super(code, message, context, originalError);
  }
}

export type SecurityErrorCode = Extract<
  ErrorCode,
  | 'SECURITY_STORAGE_ERROR'
  | 'BIOMETRIC_AUTH_ERROR'
  | 'EMERGENCY_WIPE_ERROR'
  | 'CRYPTO_OPERATION_ERROR'
>;

export class SecurityError extends AppError {
  constructor(
    code: SecurityErrorCode,
    message: string,
    context?: Record<string, unknown>,
    originalError?: unknown
  ) {
    super(code, message, context, originalError);
  }
}

export type MediaErrorCode = Extract<
  ErrorCode,
  'MEDIA_PERMISSION_DENIED' | 'MEDIA_PROCESSING_ERROR'
>;

export class MediaError extends AppError {
  constructor(
    code: MediaErrorCode,
    message: string,
    context?: Record<string, unknown>,
    originalError?: unknown
  ) {
    super(code, message, context, originalError);
  }
}

export class FileSystemError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, originalError?: unknown) {
    super('FILE_SYSTEM_ERROR', message, context, originalError);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, context);
  }
}

export class ArithmeticOverflowError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('ARITHMETIC_OVERFLOW_ERROR', message, context);
  }
}

export class InsufficientStockError extends AppError {
  constructor(productName: string, availableQty: number, requestedQty: number) {
    super('INSUFFICIENT_STOCK', `Stock insuficiente para ${productName}`, {
      productName,
      availableQty,
      requestedQty,
    });
  }
}

export class EntityNotFoundError extends AppError {
  constructor(entity: string, id: string) {
    super('ENTITY_NOT_FOUND', `${entity} no encontrado`, { entity, id });
  }
}