import { z } from 'zod';
import { ValidationError } from '../../core/errors/AppError';
import { CustomerPayment } from '../../domain/entities/types';
import { ICustomerRepository } from '../../domain/repositories/ICustomerRepository';

const RecordPaymentSchema = z.object({
  customerId: z.string().trim().min(1, 'Debe seleccionar un cliente.'),
  amountCents: z
    .number()
    .int('El monto debe expresarse en centavos enteros.')
    .positive('El monto del pago debe ser mayor a cero.'),
  notes: z.string().trim().max(200, 'La nota no puede superar los 200 caracteres.').optional(),
});

export type RecordPaymentInput = z.infer<typeof RecordPaymentSchema>;

export class RecordPaymentUseCase {
  constructor(private readonly customerRepository: ICustomerRepository) {}

  public async execute(rawInput: RecordPaymentInput): Promise<CustomerPayment> {
    const parsed = RecordPaymentSchema.safeParse(rawInput);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message ?? 'Datos de pago inválidos.';
      throw new ValidationError(firstIssue, {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }

    const { customerId, amountCents, notes } = parsed.data;

    return this.customerRepository.recordPaymentAtomic({
      customerId,
      amountCents,
      notes: notes && notes.length > 0 ? notes : null,
    });
  }
}