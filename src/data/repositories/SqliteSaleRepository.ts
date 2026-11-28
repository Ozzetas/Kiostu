import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import {
  ArithmeticOverflowError,
  DatabaseError,
  EntityNotFoundError,
  InsufficientStockError,
  ValidationError,
} from '../../core/errors/AppError';
import { Logger } from '../../core/logging/Logger';
import { calculateLineSubtotalCents } from '../../core/utils/money';
import {
  CustomerPayment,
  FinancialSummary,
  PaymentType,
  SaleItem,
  SaleStatus,
  SaleTier,
  SaleWithItems,
  UnitType,
} from '../../domain/entities/types';
import {
  CreateSaleTransactionInput,
  ISaleRepository,
} from '../../domain/repositories/ISaleRepository';
import { DatabaseClient } from '../database/DatabaseClient';
import { mapSqliteError } from '../database/sqliteErrorMapper';

interface ProductSnapshotRow {
  readonly id: string;
  readonly name: string;
  readonly unit_type: UnitType;
  readonly cost_price_cents: number;
  readonly wholesale_price_cents: number;
  readonly unit_price_cents: number;
  readonly price_base_qty: number;
  readonly stock_qty: number;
}

interface SaleRow {
  readonly id: string;
  readonly customer_id: string | null;
  readonly payment_type: PaymentType;
  readonly total_cents: number;
  readonly paid_cents: number;
  readonly status: SaleStatus;
  readonly created_at: string;
}

interface SaleItemRow {
  readonly id: string;
  readonly sale_id: string;
  readonly product_id: string;
  readonly product_name_snapshot: string;
  readonly unit_type_snapshot: UnitType;
  readonly sale_tier: SaleTier;
  readonly quantity: number;
  readonly unit_price_snapshot_cents: number;
  readonly unit_cost_snapshot_cents: number;
  readonly price_base_qty_snapshot: number;
  readonly subtotal_cents: number;
  readonly cost_subtotal_cents: number;
}

interface SalesByCustomerGroupRow {
  readonly customer_id: string | null;
  readonly billed_cents: number;
  readonly upfront_paid_cents: number;
  readonly cost_cents: number;
}

interface PaymentsByCustomerRow {
  readonly customer_id: string;
  readonly payments_cents: number;
}

interface DirectPaidBySaleRow {
  readonly reference_sale_id: string;
  readonly total_direct_paid: number;
}

export class SqliteSaleRepository implements ISaleRepository {
  private readonly logger = new Logger('SqliteSaleRepository');

  constructor(private readonly databaseClient: DatabaseClient) {}

  public async createSaleAtomic(input: CreateSaleTransactionInput): Promise<SaleWithItems> {
    try {
      const db = await this.databaseClient.getConnection();
      let createdSale: SaleWithItems | null = null;

      await db.withExclusiveTransactionAsync(async (txn) => {
        if (input.customerId !== null) {
          const customer = await txn.getFirstAsync<{ id: string }>(
            'SELECT id FROM customers WHERE id = ? AND is_active = 1;',
            [input.customerId]
          );
          if (!customer) {
            throw new EntityNotFoundError('Customer', input.customerId);
          }
        }

        const saleId = Crypto.randomUUID();
        const now = new Date().toISOString();
        const preparedItems: SaleItem[] = [];
        let totalCents = 0;

        for (const line of input.items) {
          const product = await txn.getFirstAsync<ProductSnapshotRow>(
            `SELECT id, name, unit_type, cost_price_cents, wholesale_price_cents,
                    unit_price_cents, price_base_qty, stock_qty
             FROM products
             WHERE id = ? AND is_active = 1;`,
            [line.productId]
          );

          if (!product) {
            throw new EntityNotFoundError('Product', line.productId);
          }

          if (product.stock_qty < line.quantity) {
            throw new InsufficientStockError(product.name, product.stock_qty, line.quantity);
          }

          const saleTier: SaleTier = line.saleTier ?? 'RETAIL';
          const effectiveUnitPriceCents =
            saleTier === 'WHOLESALE' ? product.wholesale_price_cents : product.unit_price_cents;

          // Congelo tanto el precio de venta (minoreo/mayoreo) como el costo proporcional real al instante de la venta.
          const subtotalCents = calculateLineSubtotalCents(
            effectiveUnitPriceCents,
            product.price_base_qty,
            line.quantity
          );
          const costSubtotalCents = calculateLineSubtotalCents(
            product.cost_price_cents,
            product.price_base_qty,
            line.quantity
          );

          totalCents += subtotalCents;
          if (!Number.isSafeInteger(totalCents)) {
            throw new ArithmeticOverflowError('El total de la venta excede el límite seguro.');
          }

          preparedItems.push({
            id: Crypto.randomUUID(),
            saleId,
            productId: product.id,
            productNameSnapshot: product.name,
            unitTypeSnapshot: product.unit_type,
            saleTier,
            quantity: line.quantity,
            unitPriceSnapshotCents: effectiveUnitPriceCents,
            unitCostSnapshotCents: product.cost_price_cents,
            priceBaseQtySnapshot: product.price_base_qty,
            subtotalCents,
            costSubtotalCents,
          });
        }

        const normalizedPaidCents = this.resolvePaidCents(
          input.paymentType,
          totalCents,
          input.paidCents
        );

        await txn.runAsync(
          `INSERT INTO sales (id, customer_id, payment_type, total_cents, paid_cents, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?);`,
          [saleId, input.customerId, input.paymentType, totalCents, normalizedPaidCents, now]
        );

        for (const item of preparedItems) {
          await txn.runAsync(
            `INSERT INTO sale_items (
              id, sale_id, product_id, product_name_snapshot, unit_type_snapshot,
              sale_tier, quantity, unit_price_snapshot_cents, unit_cost_snapshot_cents,
              price_base_qty_snapshot, subtotal_cents, cost_subtotal_cents
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              item.id,
              item.saleId,
              item.productId,
              item.productNameSnapshot,
              item.unitTypeSnapshot,
              item.saleTier,
              item.quantity,
              item.unitPriceSnapshotCents,
              item.unitCostSnapshotCents,
              item.priceBaseQtySnapshot,
              item.subtotalCents,
              item.costSubtotalCents,
            ]
          );

          // Doble guarda en el UPDATE para garantizar a nivel SQL que el stock nunca quede negativo.
          const stockUpdate = await txn.runAsync(
            `UPDATE products
             SET stock_qty = stock_qty - ?, updated_at = ?
             WHERE id = ? AND stock_qty >= ?;`,
            [item.quantity, now, item.productId, item.quantity]
          );

          if (stockUpdate.changes !== 1) {
            throw new InsufficientStockError(item.productNameSnapshot, 0, item.quantity);
          }

          await txn.runAsync(
            `INSERT INTO stock_movements (
              id, product_id, movement_type, delta_qty, reference_sale_id, reason, created_at
            ) VALUES (?, ?, 'OUT_SALE', ?, ?, ?, ?);`,
            [
              Crypto.randomUUID(),
              item.productId,
              -item.quantity,
              saleId,
              input.paymentType === 'CASH' ? 'Venta contado' : 'Venta fiada',
              now,
            ]
          );
        }

        createdSale = {
          id: saleId,
          customerId: input.customerId,
          paymentType: input.paymentType,
          totalCents,
          paidCents: normalizedPaidCents,
          status: 'COMPLETED',
          createdAt: now,
          items: preparedItems,
          directPaidCents: 0,
        };
      });

      if (!createdSale) {
        throw new DatabaseError('DB_TRANSACTION_ERROR', 'La venta no produjo resultado tras el commit');
      }

      return createdSale;
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_TRANSACTION_ERROR', 'Error al registrar venta atómica', {
        customerId: input.customerId,
        paymentType: input.paymentType,
        itemCount: input.items.length,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async paySaleAtomic(saleId: string, notes: string | null): Promise<CustomerPayment> {
    try {
      const db = await this.databaseClient.getConnection();
      let createdPayment: CustomerPayment | null = null;

      await db.withExclusiveTransactionAsync(async (txn) => {
        const sale = await txn.getFirstAsync<SaleRow>('SELECT * FROM sales WHERE id = ?;', [saleId]);
        if (!sale) {
          throw new EntityNotFoundError('Sale', saleId);
        }

        if (sale.status === 'VOIDED') {
          throw new ValidationError('No se puede cobrar una venta anulada.', { saleId });
        }

        if (sale.customer_id === null) {
          throw new ValidationError('Esta venta fue al contado y no tiene deuda pendiente.', {
            saleId,
          });
        }

        const directPaidRow = await txn.getFirstAsync<{ total_direct_paid: number | null }>(
          'SELECT SUM(amount_cents) AS total_direct_paid FROM customer_payments WHERE reference_sale_id = ?;',
          [saleId]
        );
        const alreadyDirectPaid = directPaidRow?.total_direct_paid ?? 0;
        const saleRemainingCents = sale.total_cents - sale.paid_cents - alreadyDirectPaid;

        if (saleRemainingCents <= 0) {
          throw new ValidationError('Esta venta ya se encuentra pagada.', { saleId });
        }

        const balance = await txn.getFirstAsync<{ current_debt_cents: number }>(
          'SELECT current_debt_cents FROM v_customer_balances WHERE customer_id = ?;',
          [sale.customer_id]
        );

        if (!balance || balance.current_debt_cents <= 0) {
          throw new ValidationError('El cliente ya no tiene deuda pendiente.', {
            customerId: sale.customer_id,
          });
        }

        // Impido sobrepagar si el cliente ya había hecho pagos parciales generales por fuera de este ítem.
        if (saleRemainingCents > balance.current_debt_cents) {
          throw new ValidationError(
            'El saldo pendiente del cliente es menor al monto de esta venta debido a pagos parciales previos. Usá "Saldar deuda total".',
            {
              saleId,
              saleRemainingCents,
              currentDebtCents: balance.current_debt_cents,
            }
          );
        }

        const paymentId = Crypto.randomUUID();
        const now = new Date().toISOString();
        const cleanNotes = notes?.trim() || null;

        await txn.runAsync(
          `INSERT INTO customer_payments (id, customer_id, reference_sale_id, amount_cents, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?);`,
          [paymentId, sale.customer_id, saleId, saleRemainingCents, cleanNotes, now]
        );

        createdPayment = {
          id: paymentId,
          customerId: sale.customer_id,
          referenceSaleId: saleId,
          amountCents: saleRemainingCents,
          notes: cleanNotes,
          createdAt: now,
        };
      });

      if (!createdPayment) {
        throw new DatabaseError('DB_TRANSACTION_ERROR', 'No se pudo confirmar el pago de la venta');
      }

      return createdPayment;
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_TRANSACTION_ERROR', 'Error al pagar venta puntual', {
        saleId,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async voidSaleAtomic(saleId: string, reason: string | null): Promise<void> {
    try {
      const db = await this.databaseClient.getConnection();

      await db.withExclusiveTransactionAsync(async (txn) => {
        const sale = await txn.getFirstAsync<SaleRow>('SELECT * FROM sales WHERE id = ?;', [saleId]);
        if (!sale) {
          throw new EntityNotFoundError('Sale', saleId);
        }

        if (sale.status === 'VOIDED') {
          throw new ValidationError('La venta ya fue anulada previamente.', { saleId });
        }

        const linkedPayRow = await txn.getFirstAsync<{ count_paid: number }>(
          'SELECT COUNT(*) AS count_paid FROM customer_payments WHERE reference_sale_id = ?;',
          [saleId]
        );
        if ((linkedPayRow?.count_paid ?? 0) > 0) {
          throw new ValidationError(
            'No se puede anular una venta fiada que ya fue cobrada individualmente.',
            { saleId }
          );
        }

        const items = await txn.getAllAsync<SaleItemRow>(
          'SELECT * FROM sale_items WHERE sale_id = ?;',
          [saleId]
        );

        const now = new Date().toISOString();
        await txn.runAsync("UPDATE sales SET status = 'VOIDED' WHERE id = ?;", [saleId]);

        for (const item of items) {
          await txn.runAsync(
            'UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?;',
            [item.quantity, now, item.product_id]
          );

          await txn.runAsync(
            `INSERT INTO stock_movements (
              id, product_id, movement_type, delta_qty, reference_sale_id, reason, created_at
            ) VALUES (?, ?, 'VOID_RETURN', ?, ?, ?, ?);`,
            [
              Crypto.randomUUID(),
              item.product_id,
              item.quantity,
              saleId,
              reason ?? 'Anulación de venta',
              now,
            ]
          );
        }
      });
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_TRANSACTION_ERROR', 'Error al anular venta', {
        saleId,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async listSalesByCustomer(customerId: string): Promise<SaleWithItems[]> {
    try {
      const db = await this.databaseClient.getConnection();
      const sales = await db.getAllAsync<SaleRow>(
        'SELECT * FROM sales WHERE customer_id = ? ORDER BY created_at DESC;',
        [customerId]
      );
      return await this.hydrateSalesWithItems(db, sales);
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al listar ventas del cliente', {
        customerId,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async listRecentSales(limit: number = 50): Promise<SaleWithItems[]> {
    try {
      const db = await this.databaseClient.getConnection();
      const sales = await db.getAllAsync<SaleRow>(
        'SELECT * FROM sales ORDER BY created_at DESC LIMIT ?;',
        [limit]
      );
      return await this.hydrateSalesWithItems(db, sales);
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al listar ventas recientes', {
        limit,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async getFinancialSummary(): Promise<FinancialSummary> {
    try {
      const db = await this.databaseClient.getConnection();

      const [debtRow, salesGroups, paymentRows] = await Promise.all([
        db.getFirstAsync<{ total_debt_cents: number | null }>(
          'SELECT SUM(current_debt_cents) AS total_debt_cents FROM v_customer_balances;'
        ),
        db.getAllAsync<SalesByCustomerGroupRow>(
          `SELECT
             s.customer_id,
             SUM(s.total_cents) AS billed_cents,
             SUM(s.paid_cents) AS upfront_paid_cents,
             SUM(COALESCE(si.cost_cents, 0)) AS cost_cents
           FROM sales s
           LEFT JOIN (
             SELECT sale_id, SUM(cost_subtotal_cents) AS cost_cents
             FROM sale_items
             GROUP BY sale_id
           ) si ON si.sale_id = s.id
           WHERE s.status = 'COMPLETED'
           GROUP BY s.customer_id;`
        ),
        db.getAllAsync<PaymentsByCustomerRow>(
          `SELECT customer_id, SUM(amount_cents) AS payments_cents
           FROM customer_payments
           GROUP BY customer_id;`
        ),
      ]);

      const paymentsByCustomer = new Map<string, number>(
        paymentRows.map((row) => [row.customer_id, row.payments_cents])
      );

      let totalBilledCents = 0;
      let totalCostCents = 0;
      let totalCollectedCents = 0;
      let realizedNetProfitCents = 0;
      let pendingNetProfitCents = 0;

      for (const group of salesGroups) {
        totalBilledCents += group.billed_cents;
        totalCostCents += group.cost_cents;

        const customerPayments =
          group.customer_id !== null ? (paymentsByCustomer.get(group.customer_id) ?? 0) : 0;
        const collectedForGroup = Math.min(
          group.billed_cents,
          group.upfront_paid_cents + customerPayments
        );

        totalCollectedCents += collectedForGroup;

        if (group.billed_cents > 0) {
          // Prorrateo la ganancia neta de cuentas corrientes según el porcentaje efectivamente cobrado.
          const totalProfitForGroup = group.billed_cents - group.cost_cents;
          const paidRatio = Math.min(1, Math.max(0, collectedForGroup / group.billed_cents));
          const realizedForGroup = Math.round(totalProfitForGroup * paidRatio);
          realizedNetProfitCents += realizedForGroup;
          pendingNetProfitCents += totalProfitForGroup - realizedForGroup;
        }
      }

      return {
        pendingDebtCents: Math.max(0, debtRow?.total_debt_cents ?? 0),
        totalCollectedCents,
        realizedNetProfitCents,
        pendingNetProfitCents,
        totalBilledCents,
        totalCostCents,
      };
    } catch (error: unknown) {
      const mapped = mapSqliteError(
        error,
        'DB_QUERY_ERROR',
        'Error al calcular el resumen financiero de caja y ganancias'
      );
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  private async hydrateSalesWithItems(
    db: SQLite.SQLiteDatabase,
    sales: readonly SaleRow[]
  ): Promise<SaleWithItems[]> {
    if (sales.length === 0) {
      return [];
    }

    // Resuelvo ítems y pagos puntuales en dos consultas batch IN (...) para evitar el problema N+1.
    const saleIds = sales.map((sale) => sale.id);
    const placeholders = saleIds.map(() => '?').join(', ');

    const [itemRows, directPaymentRows] = await Promise.all([
      db.getAllAsync<SaleItemRow>(
        `SELECT * FROM sale_items WHERE sale_id IN (${placeholders});`,
        saleIds
      ),
      db.getAllAsync<DirectPaidBySaleRow>(
        `SELECT reference_sale_id, SUM(amount_cents) AS total_direct_paid
         FROM customer_payments
         WHERE reference_sale_id IN (${placeholders})
         GROUP BY reference_sale_id;`,
        saleIds
      ),
    ]);

    const itemsBySaleId = new Map<string, SaleItem[]>();
    for (const row of itemRows) {
      const mappedItem: SaleItem = {
        id: row.id,
        saleId: row.sale_id,
        productId: row.product_id,
        productNameSnapshot: row.product_name_snapshot,
        unitTypeSnapshot: row.unit_type_snapshot,
        saleTier: row.sale_tier,
        quantity: row.quantity,
        unitPriceSnapshotCents: row.unit_price_snapshot_cents,
        unitCostSnapshotCents: row.unit_cost_snapshot_cents,
        priceBaseQtySnapshot: row.price_base_qty_snapshot,
        subtotalCents: row.subtotal_cents,
        costSubtotalCents: row.cost_subtotal_cents,
      };
      const group = itemsBySaleId.get(mappedItem.saleId);
      if (group) {
        group.push(mappedItem);
      } else {
        itemsBySaleId.set(mappedItem.saleId, [mappedItem]);
      }
    }

    const directPaidBySaleId = new Map<string, number>(
      directPaymentRows.map((row) => [row.reference_sale_id, row.total_direct_paid])
    );

    return sales.map((sale) => ({
      id: sale.id,
      customerId: sale.customer_id,
      paymentType: sale.payment_type,
      totalCents: sale.total_cents,
      paidCents: sale.paid_cents,
      status: sale.status,
      createdAt: sale.created_at,
      items: itemsBySaleId.get(sale.id) ?? [],
      directPaidCents: directPaidBySaleId.get(sale.id) ?? 0,
    }));
  }

  private resolvePaidCents(
    paymentType: PaymentType,
    totalCents: number,
    requestedPaidCents: number
  ): number {
    if (paymentType === 'CASH') {
      return totalCents;
    }
    if (paymentType === 'CREDIT') {
      return 0;
    }

    if (requestedPaidCents <= 0 || requestedPaidCents >= totalCents) {
      throw new ValidationError(
        'En un pago mixto el adelanto debe ser mayor a USD$ 0 y menor al total de la venta.',
        { totalCents, requestedPaidCents }
      );
    }
    return requestedPaidCents;
  }
}