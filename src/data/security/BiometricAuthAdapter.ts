import * as LocalAuthentication from 'expo-local-authentication';
import { SecurityError } from '../../core/errors/AppError';
import { Logger } from '../../core/logging/Logger';
import { BiometricAttemptStatus } from '../../domain/entities/security';
import { IBiometricAuthenticator } from '../../domain/repositories/ISecurityRepository';

const CANCELLATION_ERRORS = new Set<string>([
  'user_cancel',
  'system_cancel',
  'app_cancel',
  'user_fallback',
]);

const UNAVAILABLE_ERRORS = new Set<string>([
  'not_available',
  'not_enrolled',
  'passcode_not_set',
  'lockout',
]);

export class BiometricAuthAdapter implements IBiometricAuthenticator {
  private readonly logger = new Logger('BiometricAuthAdapter');

  public async isAvailable(): Promise<boolean> {
    try {
      const [hasHardware, isEnrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      return hasHardware && isEnrolled;
    } catch (error: unknown) {
      const secError = new SecurityError(
        'BIOMETRIC_AUTH_ERROR',
        'Error al consultar disponibilidad de hardware biométrico',
        undefined,
        error
      );
      this.logger.error(secError.message, secError);
      return false;
    }
  }

  public async authenticate(promptMessage: string): Promise<BiometricAttemptStatus> {
    const available = await this.isAvailable();
    if (!available) {
      return 'UNAVAILABLE';
    }

    try {
      // Deshabilito el fallback del código del sistema para obligar a usar nuestra pantalla de contraseña.
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        cancelLabel: 'Usar contraseña',
        disableDeviceFallback: true,
      });

      if (result.success) {
        return 'SUCCESS';
      }

      if (CANCELLATION_ERRORS.has(result.error)) {
        return 'CANCELLED';
      }

      if (UNAVAILABLE_ERRORS.has(result.error)) {
        this.logger.warn('Biometría no disponible durante el intento de autenticación', {
          errorCode: result.error,
        });
        return 'UNAVAILABLE';
      }

      this.logger.warn('Autenticación biométrica rechazada', { errorCode: result.error });
      return 'FAILED';
    } catch (error: unknown) {
      const secError = new SecurityError(
        'BIOMETRIC_AUTH_ERROR',
        'Excepción nativa al invocar autenticación biométrica',
        undefined,
        error
      );
      this.logger.error(secError.message, secError);
      return 'FAILED';
    }
  }
}