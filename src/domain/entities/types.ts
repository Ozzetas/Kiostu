export type UnitType = 'UNIT' | 'GRAM';
export type PaymentType = 'CASH' | 'CREDIT' | 'MIXED';
export type SaleStatus = 'COMPLETED' | 'VOIDED';
export type SaleTier = 'RETAIL' | 'WHOLESALE';
export type StockMovementType = 'IN_PURCHASE' | 'OUT_SALE' | 'ADJUSTMENT' | 'VOID_RETURN';

export interface Category {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly createdAt: string;
}

export interface Product {
  readonly id: string;
  readonly categoryId: string | null;
  readonly name: string;
  readonly unitType: UnitType;
  readonly costPriceCents: number;
  readonly wholesalePriceCents: number;
  readonly unitPriceCents: number; // Precio de venta al minoreo
  readonly priceBaseQty: number;
  readonly stockQty: number;
  readonly minStockAlert: number;
  readonly imageUri: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Customer {
  readonly id: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly notes: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Sale {
  readonly id: string;
  readonly customerId: string | null;
  readonly paymentType: PaymentType;
  readonly totalCents: number;
  readonly paidCents: number;
  readonly status: SaleStatus;
  readonly createdAt: string;
}

export interface SaleItem {
  readonly id: string;
  readonly saleId: string;
  readonly productId: string;
  readonly productNameSnapshot: string;
  readonly unitTypeSnapshot: UnitType;
  readonly saleTier: SaleTier;
  readonly quantity: number;
  readonly unitPriceSnapshotCents: number;
  readonly unitCostSnapshotCents: number;
  readonly priceBaseQtySnapshot: number;
  readonly subtotalCents: number;
  readonly costSubtotalCents: number;
}

export interface SaleWithItems extends Sale {
  readonly items: readonly SaleItem[];
  readonly directPaidCents: number;
}

export interface CustomerPayment {
  readonly id: string;
  readonly customerId: string;
  readonly referenceSaleId: string | null;
  readonly amountCents: number;
  readonly notes: string | null;
  readonly createdAt: string;
}

export interface CustomerBalance {
  readonly customerId: string;
  readonly fullName: string;
  readonly totalCreditedCents: number;
  readonly totalPaidCents: number;
  readonly currentDebtCents: number;
}

export interface StockMovement {
  readonly id: string;
  readonly productId: string;
  readonly movementType: StockMovementType;
  readonly deltaQty: number;
  readonly referenceSaleId: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface FinancialSummary {
  readonly pendingDebtCents: number;
  readonly totalCollectedCents: number;
  readonly realizedNetProfitCents: number;
  readonly pendingNetProfitCents: number;
  readonly totalBilledCents: number;
  readonly totalCostCents: number;
}