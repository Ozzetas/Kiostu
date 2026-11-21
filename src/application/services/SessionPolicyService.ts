import { Logger } from '../../core/logging/Logger';
import { AuthRequirement, SecuritySnapshot } from '../../domain/entities/security';

export class SessionPolicyService {
  private readonly logger = new Logger('SessionPolicyService');

  public evaluateRequirement(
    snapshot: SecuritySnapshot,
    isColdStart: boolean,
    nowMs: number = Date.now()
  ): AuthRequirement {
    if (!snapshot.hasPrimaryPassword) {
      return 'SETUP_REQUIRED';
    }

    // Todo arranque en frío exige contraseña principal independientemente del último timestamp.
    if (isColdStart) {
      return 'PASSWORD_REQUIRED';
    }

    if (snapshot.lastActivityAtMs === null) {
      return 'PASSWORD_REQUIRED';
    }

    // Protección anti-rollback: si el reloj del dispositivo fue atrasado, revoco la ventana biométrica.
    if (nowMs < snapshot.lastActivityAtMs) {
      this.logger.warn('Desfase negativo de reloj detectado; se fuerza contraseña principal', {
        nowMs,
        lastActivityAtMs: snapshot.lastActivityAtMs,
      });
      return 'PASSWORD_REQUIRED';
    }

    const elapsedMs = nowMs - snapshot.lastActivityAtMs;
    if (elapsedMs >= snapshot.policy.sessionTimeoutMs) {
      return 'PASSWORD_REQUIRED';
    }

    return snapshot.policy.biometricEnabled ? 'BIOMETRIC_OR_PASSWORD' : 'PASSWORD_REQUIRED';
  }
}