import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
import { SecurityError } from '../../core/errors/AppError';
import { Logger } from '../../core/logging/Logger';
import {
  CredentialHashRecord,
  DEFAULT_SESSION_TIMEOUT_MS,
  MAX_SESSION_TIMEOUT_MS,
  MIN_SESSION_TIMEOUT_MS,
  SecurityPolicy,
  SecuritySnapshot,
} from '../../domain/entities/security';
import { ISecurityRepository } from '../../domain/repositories/ISecurityRepository';

const KEY_PRIMARY_CREDENTIAL = 'kiosco.sec.primary_credential';
const KEY_PANIC_CREDENTIAL = 'kiosco.sec.panic_credential';
const KEY_SECURITY_POLICY = 'kiosco.sec.policy';
const KEY_LAST_ACTIVITY_MS = 'kiosco.sec.last_activity_ms';

// Restrinjo las claves a este dispositivo físico para impedir su extracción en backups de iCloud/iTunes.
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const CredentialRecordSchema = z.object({
  saltHex: z.string().min(16),
  hashHex: z.string().length(64),
});

const SecurityPolicySchema = z.object({
  sessionTimeoutMs: z.number().int().min(MIN_SESSION_TIMEOUT_MS).max(MAX_SESSION_TIMEOUT_MS),
  biometricEnabled: z.boolean(),
});

const DEFAULT_POLICY: SecurityPolicy = {
  sessionTimeoutMs: DEFAULT_SESSION_TIMEOUT_MS,
  biometricEnabled: true,
};

export class KeychainCredentialStore implements ISecurityRepository {
  private readonly logger = new Logger('KeychainCredentialStore');

  public async getSnapshot(): Promise<SecuritySnapshot> {
    const [primary, panic, policy, lastActivityAtMs] = await Promise.all([
      this.getPrimaryCredential(),
      this.getPanicCredential(),
      this.getPolicy(),
      this.getLastActivityAt(),
    ]);

    return {
      hasPrimaryPassword: primary !== null,
      hasPanicPassword: panic !== null,
      policy,
      lastActivityAtMs,
    };
  }

  public async getPrimaryCredential(): Promise<CredentialHashRecord | null> {
    return this.readValidatedJson(KEY_PRIMARY_CREDENTIAL, CredentialRecordSchema);
  }

  public async getPanicCredential(): Promise<CredentialHashRecord | null> {
    return this.readValidatedJson(KEY_PANIC_CREDENTIAL, CredentialRecordSchema);
  }

  public async savePrimaryCredential(record: CredentialHashRecord): Promise<void> {
    await this.writeKey(KEY_PRIMARY_CREDENTIAL, JSON.stringify(record));
  }

  public async savePanicCredential(record: CredentialHashRecord): Promise<void> {
    await this.writeKey(KEY_PANIC_CREDENTIAL, JSON.stringify(record));
  }

  public async deletePanicCredential(): Promise<void> {
    await this.deleteKey(KEY_PANIC_CREDENTIAL);
  }

  public async savePolicy(policy: SecurityPolicy): Promise<void> {
    const parsed = SecurityPolicySchema.safeParse(policy);
    if (!parsed.success) {
      throw new SecurityError('SECURITY_STORAGE_ERROR', 'Política de seguridad inválida al guardar', {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }
    await this.writeKey(KEY_SECURITY_POLICY, JSON.stringify(parsed.data));
  }

  public async updateLastActivityAt(timestampMs: number): Promise<void> {
    if (!Number.isSafeInteger(timestampMs) || timestampMs <= 0) {
      throw new SecurityError('SECURITY_STORAGE_ERROR', 'Timestamp de actividad inválido', {
        timestampMs,
      });
    }
    await this.writeKey(KEY_LAST_ACTIVITY_MS, String(timestampMs));
  }

  public async clearLastActivityAt(): Promise<void> {
    await this.deleteKey(KEY_LAST_ACTIVITY_MS);
  }

  public async clearAllCredentials(): Promise<void> {
    await Promise.all([
      this.deleteKey(KEY_PRIMARY_CREDENTIAL),
      this.deleteKey(KEY_PANIC_CREDENTIAL),
      this.deleteKey(KEY_SECURITY_POLICY),
      this.deleteKey(KEY_LAST_ACTIVITY_MS),
    ]);
    this.logger.info('Todas las credenciales del Keychain fueron eliminadas');
  }

  private async getPolicy(): Promise<SecurityPolicy> {
    const stored = await this.readValidatedJson(KEY_SECURITY_POLICY, SecurityPolicySchema);
    return stored ?? DEFAULT_POLICY;
  }

  private async getLastActivityAt(): Promise<number | null> {
    const raw = await this.readKey(KEY_LAST_ACTIVITY_MS);
    if (raw === null) {
      return null;
    }

    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      this.logger.warn('Timestamp corrupto detectado en Keychain; se forzará re-autenticación', {
        key: KEY_LAST_ACTIVITY_MS,
      });
      return null;
    }

    return parsed;
  }

  private async readValidatedJson<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
    const raw = await this.readKey(key);
    if (raw === null) {
      return null;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error: unknown) {
      const secError = new SecurityError(
        'SECURITY_STORAGE_ERROR',
        'Registro JSON corrupto en Keychain',
        { key },
        error
      );
      this.logger.error(secError.message, secError);
      throw secError;
    }

    const validated = schema.safeParse(parsedJson);
    if (!validated.success) {
      const secError = new SecurityError(
        'SECURITY_STORAGE_ERROR',
        'Esquema de seguridad inválido en Keychain',
        { key, issues: validated.error.issues.map((issue) => issue.message) }
      );
      this.logger.error(secError.message, secError);
      throw secError;
    }

    return validated.data;
  }

  private async readKey(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS);
    } catch (error: unknown) {
      const secError = new SecurityError(
        'SECURITY_STORAGE_ERROR',
        'Fallo al leer clave en almacenamiento seguro',
        { key },
        error
      );
      this.logger.error(secError.message, secError);
      throw secError;
    }
  }

  private async writeKey(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS);
    } catch (error: unknown) {
      const secError = new SecurityError(
        'SECURITY_STORAGE_ERROR',
        'Fallo al escribir clave en almacenamiento seguro',
        { key },
        error
      );
      this.logger.error(secError.message, secError);
      throw secError;
    }
  }

  private async deleteKey(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS);
    } catch (error: unknown) {
      const secError = new SecurityError(
        'SECURITY_STORAGE_ERROR',
        'Fallo al eliminar clave en almacenamiento seguro',
        { key },
        error
      );
      this.logger.error(secError.message, secError);
      throw secError;
    }
  }
}