import { AppError } from '../errors/AppError';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

interface StructuredLogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly module: string;
  readonly message: string;
  readonly context?: Record<string, unknown>;
  readonly errorCode?: string;
  readonly stack?: string;
}

export class Logger {
  private readonly moduleName: string;

  constructor(moduleName: string) {
    this.moduleName = moduleName;
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.emit('INFO', message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.emit('WARN', message, context);
  }

  public error(message: string, error: AppError | Error, context?: Record<string, unknown>): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      module: this.moduleName,
      message,
      context: {
        ...context,
        ...(error instanceof AppError ? error.context : {}),
      },
      errorCode: error instanceof AppError ? error.code : 'UNHANDLED_SYSTEM_ERROR',
      // Expongo el stack trace únicamente en entorno de desarrollo para evitar fuga de detalles en producción.
      stack: __DEV__ ? error.stack : undefined,
    };

    console.error(JSON.stringify(entry));
  }

  private emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.moduleName,
      message,
      context,
    };

    if (level === 'WARN') {
      console.warn(JSON.stringify(entry));
      return;
    }

    console.log(JSON.stringify(entry));
  }
}