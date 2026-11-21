import { z } from 'zod';
import { ValidationError } from '../../core/errors/AppError';
import { createSaltedHash, verifySaltedHash } from '../../core/utils/crypto';
import {
    MAX_SESSION_TIMEOUT_MS,
    MIN_SESSION_TIMEOUT_MS,
    SecurityPolicy,
} from '../../domain/entities/security';
import { ISecurityRepository } from '../../domain/repositories/ISecurityRepository';

const PasswordSchema = z
  .string()
  .min(4, 'La contraseña debe tener al menos 4 caracteres.')
  .max(64, 'La contraseña no puede superar los 64 caracteres.')
  .refine((val) => val.trim().length === val.length, {
    message: 'La contraseña no puede comenzar ni terminar con espacios.',
  });

const PolicySchema = z.object({
  sessionTimeoutMs: z.number().int().min(MIN_SESSION_TIMEOUT_MS).max(MAX_SESSION_TIMEOUT_MS),
  biometricEnabled: z.boolean(),
});

export interface InitialSecuritySetupInput {
  readonly primaryPassword: string;
  readonly panicPassword?: string;
  readonly policy: SecurityPolicy;
}

export class ConfigureSecurityUseCase {
  constructor(private readonly securityRepository: ISecurityRepository) {}

  public async setupInitialSecurity(input: InitialSecuritySetupInput): Promise<void> {
    const primary = this.validatePassword(input.primaryPassword, 'contraseña principal');
    const policy = this.validatePolicy(input.policy);

    let panic: string | undefined;
    if (input.panicPassword !== undefined && input.panicPassword.length > 0) {
      panic = this.validatePassword(input.panicPassword, 'contraseña de emergencia');
      if (primary === panic) {
        throw new ValidationError(
          'La contraseña principal y la de emergencia no pueden ser iguales.'
        );
      }
    }

    const primaryRecord = await createSaltedHash(primary, 'primary');
    await this.securityRepository.savePrimaryCredential(primaryRecord);

    if (panic !== undefined) {
      const panicRecord = await createSaltedHash(panic, 'panic');
      await this.securityRepository.savePanicCredential(panicRecord);
    } else {
      await this.securityRepository.deletePanicCredential();
    }

    await this.securityRepository.savePolicy(policy);
    await this.securityRepository.updateLastActivityAt(Date.now());
  }

  public async updatePanicPassword(newPanicPassword: string | null): Promise<void> {
    if (newPanicPassword === null || newPanicPassword.length === 0) {
      await this.securityRepository.deletePanicCredential();
      return;
    }

    const validatedPanic = this.validatePassword(newPanicPassword, 'contraseña de emergencia');
    const primaryStored = await this.securityRepository.getPrimaryCredential();

    if (!primaryStored) {
      throw new ValidationError(
        'Debe configurar primero una contraseña principal antes de definir una de emergencia.'
      );
    }

    // Verifico contra el hash almacenado para impedir colisión silenciosa entre ambas claves.
    const matchesPrimary = await verifySaltedHash(validatedPanic, primaryStored, 'primary');
    if (matchesPrimary) {
      throw new ValidationError(
        'La contraseña de emergencia no puede coincidir con la contraseña principal.'
      );
    }

    const panicRecord = await createSaltedHash(validatedPanic, 'panic');
    await this.securityRepository.savePanicCredential(panicRecord);
  }

  public async updatePolicy(policy: SecurityPolicy): Promise<void> {
    const validatedPolicy = this.validatePolicy(policy);
    await this.securityRepository.savePolicy(validatedPolicy);
  }

  private validatePassword(raw: string, label: string): string {
    const parsed = PasswordSchema.safeParse(raw);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message ?? `Formato inválido para ${label}.`;
      throw new ValidationError(firstIssue, { field: label });
    }
    return parsed.data;
  }

  private validatePolicy(policy: SecurityPolicy): SecurityPolicy {
    const parsed = PolicySchema.safeParse(policy);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message ?? 'Política de sesión inválida.';
      throw new ValidationError(firstIssue, {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }
    return parsed.data;
  }
}