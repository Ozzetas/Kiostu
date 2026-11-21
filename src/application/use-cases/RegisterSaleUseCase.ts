import { z } from 'zod';
import { ArithmeticOverflowError, ValidationError } from '../../core/errors/AppError';
import { SaleWithItems } from '../../domain/entities/types';
import { ISaleRepository, SaleLineInput } from '../../domain/repositories/ISaleRepository';

const RegisterSaleSchema = z.object({
  customerId: z.string().trim().min(1).nullable(),
  paymentType: z.enum(['CASH', 'CREDIT', 'MIXED']),
  paidCents: z.number().int().min(0, 'El monto abonado no puede ser negativo.').default(0),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1, 'El ID del producto es obligatorio.'),
        quantity: z
          .number()
          .int('La cantidad debe ser un entero (unidades o gramos).')
          .positive('La cantidad debe ser mayor a cero.'),
      })
    )
    .min(1, 'La venta debe contener al menos un producto.'),
});

export type RegisterSaleInput = z.input<typeof RegisterSaleSchema>;

export class RegisterSaleUseCase {
  constructor(private readonly saleRepository: ISaleRepository) {}

  public async execute(rawInput: RegisterSaleInput): Promise<SaleWithItems> {
    const parsed = RegisterSaleSchema.safeParse(rawInput);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message ?? 'Datos de venta inválidos.';
      throw new ValidationError(firstIssue, {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }

    const { customerId, paymentType, paidCents, items } = parsed.data;

    if (paymentType !== 'CASH' && customerId === null) {
      throw new ValidationError('Toda venta fiada o mixta debe asignarse a un cliente registrado.');
    }

    const consolidatedItems = this.mergeDuplicateProducts(items);

    return this.saleRepository.createSaleAtomic({
      customerId,
      paymentType,
      paidCents,
      items: consolidatedItems,
    });
  }

  private mergeDuplicateProducts(items: readonly SaleLineInput[]): SaleLineInput[] {
    // Agrupo líneas repetidas del mismo producto para validar stock acumulado en una sola operación.
    const quantityByProduct = new Map<string, number>();

    for (const item of items) {
      const accumulated = (quantityByProduct.get(item.productId) ?? 0) + item.quantity;
      if (!Number.isSafeInteger(accumulated)) {
        throw new ArithmeticOverflowError('La cantidad acumulada excede el límite entero seguro.', {
          productId: item.productId,
        });
      }
      quantityByProduct.set(item.productId, accumulated);
    }

    return Array.from(quantityByProduct.entries(), ([productId, quantity]) => ({
      productId,
      quantity,
    }));
  }
}