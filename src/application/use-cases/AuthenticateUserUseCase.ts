import { verifySaltedHash } from '../../core/utils/crypto';
import { AuthOutcome, AuthRequirement } from '../../domain/entities/security';
import {
    IBiometricAuthenticator,
    ISecurityRepository,
} from '../../domain/repositories/ISecurityRepository';
import { EmergencyWipeService } from '../services/EmergencyWipeService';
import { SessionPolicyService } from '../services/SessionPolicyService';

export class AuthenticateUserUseCase {
  constructor(
    private readonly securityRepository: ISecurityRepository,
    private readonly biometricAuth: IBiometricAuthenticator,
    private readonly sessionPolicy: SessionPolicyService,
    private readonly emergencyWipe: EmergencyWipeService
  ) {}

  public async getRequiredAuthMethod(isColdStart: boolean): Promise<AuthRequirement> {
    const snapshot = await this.securityRepository.getSnapshot();
    return this.sessionPolicy.evaluateRequirement(snapshot, isColdStart);
  }

  public async authenticateWithBiometrics(isColdStart: boolean): Promise<AuthOutcome> {
    const requirement = await this.getRequiredAuthMethod(isColdStart);

    // Impido omitir la política de 5 minutos o arranque en frío invocando biometría directamente.
    if (requirement !== 'BIOMETRIC_OR_PASSWORD') {
      return {
        status: 'FAILED',
        reason: requirement === 'SETUP_REQUIRED' ? 'NOT_CONFIGURED' : 'PASSWORD_REQUIRED_BY_POLICY',
      };
    }

    const biometricResult = await this.biometricAuth.authenticate('Desbloquear Kiosco');

    switch (biometricResult) {
      case 'SUCCESS':
        await this.securityRepository.updateLastActivityAt(Date.now());
        return { status: 'AUTHENTICATED', method: 'BIOMETRIC' };
      case 'CANCELLED':
        return { status: 'FAILED', reason: 'BIOMETRIC_CANCELLED' };
      case 'UNAVAILABLE':
        return { status: 'FAILED', reason: 'BIOMETRIC_UNAVAILABLE' };
      case 'FAILED':
        return { status: 'FAILED', reason: 'BIOMETRIC_FAILED' };
    }
  }

  public async authenticateWithPassword(rawPassword: string): Promise<AuthOutcome> {
    if (rawPassword.length === 0) {
      return { status: 'FAILED', reason: 'INVALID_PASSWORD' };
    }

    const primaryStored = await this.securityRepository.getPrimaryCredential();
    if (!primaryStored) {
      return { status: 'FAILED', reason: 'NOT_CONFIGURED' };
    }

    const matchesPrimary = await verifySaltedHash(rawPassword, primaryStored, 'primary');
    if (matchesPrimary) {
      await this.securityRepository.updateLastActivityAt(Date.now());
      return { status: 'AUTHENTICATED', method: 'PASSWORD' };
    }

    const panicStored = await this.securityRepository.getPanicCredential();
    if (panicStored !== null) {
      const matchesPanic = await verifySaltedHash(rawPassword, panicStored, 'panic');
      if (matchesPanic) {
        await this.emergencyWipe.executeSilentWipe();
        return { status: 'PANIC_WIPED' };
      }
    }

    return { status: 'FAILED', reason: 'INVALID_PASSWORD' };
  }

  public async recordUserActivity(): Promise<void> {
    await this.securityRepository.updateLastActivityAt(Date.now());
  }
}