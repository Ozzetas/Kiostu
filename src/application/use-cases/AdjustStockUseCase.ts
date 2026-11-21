import { z } from 'zod';
import { ValidationError } from '../../core/errors/AppError';
import { Product } from '../../domain/entities/types';
import { IProductRepository } from '../../domain/repositories/IProductRepository';

const AdjustStockSchema = z.object({
  productId: z.string().trim().min(1, 'El ID del producto es obligatorio.'),
  deltaQty: z
    .number()
    .int('La cantidad debe ser un número entero.')
    .refine((val) => val !== 0, { message: 'El ajuste de stock no puede ser cero.' }),
  movementType: z.enum(['IN_PURCHASE', 'ADJUSTMENT']),
  reason: z.string().trim().max(200, 'El motivo no puede superar los 200 caracteres.').optional(),
});

export type AdjustStockInput = z.infer<typeof AdjustStockSchema>;

export class AdjustStockUseCase {
  constructor(private readonly productRepository: IProductRepository) {}

  public async execute(rawInput: AdjustStockInput): Promise<Product> {
    const parsed = AdjustStockSchema.safeParse(rawInput);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message ?? 'Datos de ajuste de stock inválidos.';
      throw new ValidationError(firstIssue, {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }

    const { productId, deltaQty, movementType, reason } = parsed.data;

    if (movementType === 'IN_PURCHASE' && deltaQty < 0) {
      throw new ValidationError('Un ingreso por compra debe tener una cantidad positiva.');
    }

    return this.productRepository.adjustStockAtomic({
      productId,
      deltaQty,
      movementType,
      reason: reason && reason.length > 0 ? reason : null,
    });
  }
}