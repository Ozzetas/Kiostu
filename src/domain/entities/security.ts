export const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos por defecto
export const MIN_SESSION_TIMEOUT_MS = 60 * 1000; // 1 minuto
export const MAX_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 horas

export type AuthRequirement =
  | 'SETUP_REQUIRED'
  | 'PASSWORD_REQUIRED'
  | 'BIOMETRIC_OR_PASSWORD'
  | 'UNLOCKED';

export type BiometricAttemptStatus = 'SUCCESS' | 'CANCELLED' | 'UNAVAILABLE' | 'FAILED';

export interface CredentialHashRecord {
  readonly saltHex: string;
  readonly hashHex: string;
}

export interface SecurityPolicy {
  readonly sessionTimeoutMs: number;
  readonly biometricEnabled: boolean;
}

export interface SecuritySnapshot {
  readonly hasPrimaryPassword: boolean;
  readonly hasPanicPassword: boolean;
  readonly policy: SecurityPolicy;
  readonly lastActivityAtMs: number | null;
}

export type AuthOutcome =
  | { readonly status: 'AUTHENTICATED'; readonly method: 'PASSWORD' | 'BIOMETRIC' }
  | { readonly status: 'PANIC_WIPED' }
  | {
      readonly status: 'FAILED';
      readonly reason:
        | 'INVALID_PASSWORD'
        | 'PASSWORD_REQUIRED_BY_POLICY'
        | 'BIOMETRIC_CANCELLED'
        | 'BIOMETRIC_UNAVAILABLE'
        | 'BIOMETRIC_FAILED'
        | 'NOT_CONFIGURED';
    };