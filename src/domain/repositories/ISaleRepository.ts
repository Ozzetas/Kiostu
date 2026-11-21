import { PaymentType, SaleWithItems } from '../entities/types';

export interface SaleLineInput {
  readonly productId: string;
  readonly quantity: number;
}

export interface CreateSaleTransactionInput {
  readonly customerId: string | null;
  readonly paymentType: PaymentType;
  readonly paidCents: number;
  readonly items: readonly SaleLineInput[];
}

export interface ISaleRepository {
  createSaleAtomic(input: CreateSaleTransactionInput): Promise<SaleWithItems>;
  voidSaleAtomic(saleId: string, reason: string | null): Promise<void>;
  listSalesByCustomer(customerId: string): Promise<SaleWithItems[]>;
  listRecentSales(limit?: number): Promise<SaleWithItems[]>;
}