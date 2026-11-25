import {
  BiometricAttemptStatus,
  CredentialHashRecord,
  SecurityPolicy,
  SecuritySnapshot,
} from '../entities/security';

export interface ISecurityRepository {
  getSnapshot(): Promise<SecuritySnapshot>;
  getPrimaryCredential(): Promise<CredentialHashRecord | null>;
  getPanicCredential(): Promise<CredentialHashRecord | null>;
  savePrimaryCredential(record: CredentialHashRecord): Promise<void>;
  savePanicCredential(record: CredentialHashRecord): Promise<void>;
  deletePanicCredential(): Promise<void>;
  savePolicy(policy: SecurityPolicy): Promise<void>;
  updateLastActivityAt(timestampMs: number): Promise<void>;
  clearLastActivityAt(): Promise<void>;
  clearAllCredentials(): Promise<void>;
}

export interface IBiometricAuthenticator {
  isAvailable(): Promise<boolean>;
  authenticate(promptMessage: string): Promise<BiometricAttemptStatus>;
}