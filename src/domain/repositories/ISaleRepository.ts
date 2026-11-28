import {
  CustomerPayment,
  FinancialSummary,
  PaymentType,
  SaleTier,
  SaleWithItems,
} from '../entities/types';

export interface SaleLineInput {
  readonly productId: string;
  readonly quantity: number;
  readonly saleTier?: SaleTier;
}

export interface CreateSaleTransactionInput {
  readonly customerId: string | null;
  readonly paymentType: PaymentType;
  readonly paidCents: number;
  readonly items: readonly SaleLineInput[];
}

export interface ISaleRepository {
  createSaleAtomic(input: CreateSaleTransactionInput): Promise<SaleWithItems>;
  paySaleAtomic(saleId: string, notes: string | null): Promise<CustomerPayment>;
  voidSaleAtomic(saleId: string, reason: string | null): Promise<void>;
  listSalesByCustomer(customerId: string): Promise<SaleWithItems[]>;
  listRecentSales(limit?: number): Promise<SaleWithItems[]>;
  getFinancialSummary(): Promise<FinancialSummary>;
}