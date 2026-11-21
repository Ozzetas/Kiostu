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
    PaymentType,
    SaleItem,
    SaleStatus,
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
  readonly quantity: number;
  readonly unit_price_snapshot_cents: number;
  readonly price_base_qty_snapshot: number;
  readonly subtotal_cents: number;
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
            `SELECT id, name, unit_type, unit_price_cents, price_base_qty, stock_qty
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

          // Calculo y congelo el precio proporcional exacto en centavos al instante de la operación.
          const subtotalCents = calculateLineSubtotalCents(
            product.unit_price_cents,
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
            quantity: line.quantity,
            unitPriceSnapshotCents: product.unit_price_cents,
            priceBaseQtySnapshot: product.price_base_qty,
            subtotalCents,
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
              quantity, unit_price_snapshot_cents, price_base_qty_snapshot, subtotal_cents
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              item.id,
              item.saleId,
              item.productId,
              item.productNameSnapshot,
              item.unitTypeSnapshot,
              item.quantity,
              item.unitPriceSnapshotCents,
              item.priceBaseQtySnapshot,
              item.subtotalCents,
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

  private async hydrateSalesWithItems(
    db: SQLite.SQLiteDatabase,
    sales: readonly SaleRow[]
  ): Promise<SaleWithItems[]> {
    if (sales.length === 0) {
      return [];
    }

    // Resuelvo los detalles en una única consulta IN (...) para evitar el problema de consultas N+1.
    const saleIds = sales.map((sale) => sale.id);
    const placeholders = saleIds.map(() => '?').join(', ');
    const itemRows = await db.getAllAsync<SaleItemRow>(
      `SELECT * FROM sale_items WHERE sale_id IN (${placeholders});`,
      saleIds
    );

    const itemsBySaleId = new Map<string, SaleItem[]>();
    for (const row of itemRows) {
      const mappedItem: SaleItem = {
        id: row.id,
        saleId: row.sale_id,
        productId: row.product_id,
        productNameSnapshot: row.product_name_snapshot,
        unitTypeSnapshot: row.unit_type_snapshot,
        quantity: row.quantity,
        unitPriceSnapshotCents: row.unit_price_snapshot_cents,
        priceBaseQtySnapshot: row.price_base_qty_snapshot,
        subtotalCents: row.subtotal_cents,
      };

      const group = itemsBySaleId.get(mappedItem.saleId);
      if (group) {
        group.push(mappedItem);
      } else {
        itemsBySaleId.set(mappedItem.saleId, [mappedItem]);
      }
    }

    return sales.map((sale) => ({
      id: sale.id,
      customerId: sale.customer_id,
      paymentType: sale.payment_type,
      totalCents: sale.total_cents,
      paidCents: sale.paid_cents,
      status: sale.status,
      createdAt: sale.created_at,
      items: itemsBySaleId.get(sale.id) ?? [],
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
        'En un pago mixto el adelanto debe ser mayor a $0 y menor al total de la venta.',
        { totalCents, requestedPaidCents }
      );
    }

    return requestedPaidCents;
  }
}