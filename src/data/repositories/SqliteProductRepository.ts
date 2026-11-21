import * as Crypto from 'expo-crypto';
import {
    EntityNotFoundError,
    InsufficientStockError,
    ValidationError,
} from '../../core/errors/AppError';
import { Logger } from '../../core/logging/Logger';
import {
    Category,
    Product,
    StockMovement,
    StockMovementType,
    UnitType,
} from '../../domain/entities/types';
import {
    AdjustStockPersistenceInput,
    CreateCategoryInput,
    CreateProductInput,
    IProductRepository,
    UpdateProductInput,
} from '../../domain/repositories/IProductRepository';
import { DatabaseClient } from '../database/DatabaseClient';
import { mapSqliteError } from '../database/sqliteErrorMapper';

interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly sort_order: number;
  readonly created_at: string;
}

interface ProductRow {
  readonly id: string;
  readonly category_id: string | null;
  readonly name: string;
  readonly unit_type: UnitType;
  readonly unit_price_cents: number;
  readonly price_base_qty: number;
  readonly stock_qty: number;
  readonly min_stock_alert: number;
  readonly image_uri: string | null;
  readonly is_active: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface StockMovementRow {
  readonly id: string;
  readonly product_id: string;
  readonly movement_type: StockMovementType;
  readonly delta_qty: number;
  readonly reference_sale_id: string | null;
  readonly reason: string | null;
  readonly created_at: string;
}

export class SqliteProductRepository implements IProductRepository {
  private readonly logger = new Logger('SqliteProductRepository');

  constructor(private readonly databaseClient: DatabaseClient) {}

  public async listCategories(): Promise<Category[]> {
    try {
      const db = await this.databaseClient.getConnection();
      const rows = await db.getAllAsync<CategoryRow>(
        'SELECT id, name, sort_order, created_at FROM categories ORDER BY sort_order ASC, name ASC;'
      );
      return rows.map((row) => this.mapCategory(row));
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al listar categorías');
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async createCategory(input: CreateCategoryInput): Promise<Category> {
    const id = Crypto.randomUUID();
    const now = new Date().toISOString();
    const sortOrder = input.sortOrder ?? 0;

    try {
      const db = await this.databaseClient.getConnection();
      await db.runAsync(
        'INSERT INTO categories (id, name, sort_order, created_at) VALUES (?, ?, ?, ?);',
        [id, input.name.trim(), sortOrder, now]
      );

      return { id, name: input.name.trim(), sortOrder, createdAt: now };
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al crear categoría', {
        name: input.name,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async deleteCategory(categoryId: string): Promise<void> {
    try {
      const db = await this.databaseClient.getConnection();
      const result = await db.runAsync('DELETE FROM categories WHERE id = ?;', [categoryId]);
      if (result.changes === 0) {
        throw new EntityNotFoundError('Category', categoryId);
      }
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al eliminar categoría', {
        categoryId,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async listActiveProducts(categoryId?: string): Promise<Product[]> {
    try {
      const db = await this.databaseClient.getConnection();
      const rows =
        categoryId !== undefined
          ? await db.getAllAsync<ProductRow>(
              'SELECT * FROM products WHERE is_active = 1 AND category_id = ? ORDER BY name ASC;',
              [categoryId]
            )
          : await db.getAllAsync<ProductRow>(
              'SELECT * FROM products WHERE is_active = 1 ORDER BY name ASC;'
            );

      return rows.map((row) => this.mapProduct(row));
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al listar productos activos', {
        categoryId,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async findById(productId: string): Promise<Product | null> {
    try {
      const db = await this.databaseClient.getConnection();
      const row = await db.getFirstAsync<ProductRow>('SELECT * FROM products WHERE id = ?;', [
        productId,
      ]);
      return row ? this.mapProduct(row) : null;
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al buscar producto por ID', {
        productId,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async createProduct(input: CreateProductInput): Promise<Product> {
    const id = Crypto.randomUUID();
    const now = new Date().toISOString();
    const cleanName = input.name.trim();

    if (cleanName.length === 0) {
      throw new ValidationError('El nombre del producto no puede estar vacío.');
    }

    try {
      const db = await this.databaseClient.getConnection();
      // Inserto producto y su movimiento de stock inicial en una misma transacción para mantener trazabilidad contable.
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync(
          `INSERT INTO products (
            id, category_id, name, unit_type, unit_price_cents,
            price_base_qty, stock_qty, min_stock_alert, image_uri,
            is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?);`,
          [
            id,
            input.categoryId,
            cleanName,
            input.unitType,
            input.unitPriceCents,
            input.priceBaseQty,
            input.initialStockQty,
            input.minStockAlert,
            input.imageUri,
            now,
            now,
          ]
        );

        if (input.initialStockQty > 0) {
          await txn.runAsync(
            `INSERT INTO stock_movements (
              id, product_id, movement_type, delta_qty, reference_sale_id, reason, created_at
            ) VALUES (?, ?, 'IN_PURCHASE', ?, NULL, ?, ?);`,
            [Crypto.randomUUID(), id, input.initialStockQty, 'Stock inicial', now]
          );
        }
      });

      return {
        id,
        categoryId: input.categoryId,
        name: cleanName,
        unitType: input.unitType,
        unitPriceCents: input.unitPriceCents,
        priceBaseQty: input.priceBaseQty,
        stockQty: input.initialStockQty,
        minStockAlert: input.minStockAlert,
        imageUri: input.imageUri,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_TRANSACTION_ERROR', 'Error al crear producto', {
        name: cleanName,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async updateProduct(productId: string, input: UpdateProductInput): Promise<Product> {
    try {
      const db = await this.databaseClient.getConnection();
      let updatedProduct: Product | null = null;

      await db.withExclusiveTransactionAsync(async (txn) => {
        const current = await txn.getFirstAsync<ProductRow>(
          'SELECT * FROM products WHERE id = ? AND is_active = 1;',
          [productId]
        );

        if (!current) {
          throw new EntityNotFoundError('Product', productId);
        }

        const now = new Date().toISOString();
        const nextCategoryId = input.categoryId !== undefined ? input.categoryId : current.category_id;
        const nextName = input.name !== undefined ? input.name.trim() : current.name;
        const nextUnitPrice = input.unitPriceCents ?? current.unit_price_cents;
        const nextPriceBase = input.priceBaseQty ?? current.price_base_qty;
        const nextMinAlert = input.minStockAlert ?? current.min_stock_alert;
        const nextImageUri = input.imageUri !== undefined ? input.imageUri : current.image_uri;

        if (nextName.length === 0) {
          throw new ValidationError('El nombre del producto no puede estar vacío.');
        }

        await txn.runAsync(
          `UPDATE products
           SET category_id = ?, name = ?, unit_price_cents = ?, price_base_qty = ?,
               min_stock_alert = ?, image_uri = ?, updated_at = ?
           WHERE id = ?;`,
          [
            nextCategoryId,
            nextName,
            nextUnitPrice,
            nextPriceBase,
            nextMinAlert,
            nextImageUri,
            now,
            productId,
          ]
        );

        updatedProduct = {
          id: current.id,
          categoryId: nextCategoryId,
          name: nextName,
          unitType: current.unit_type,
          unitPriceCents: nextUnitPrice,
          priceBaseQty: nextPriceBase,
          stockQty: current.stock_qty,
          minStockAlert: nextMinAlert,
          imageUri: nextImageUri,
          isActive: true,
          createdAt: current.created_at,
          updatedAt: now,
        };
      });

      if (!updatedProduct) {
        throw new EntityNotFoundError('Product', productId);
      }

      return updatedProduct;
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_TRANSACTION_ERROR', 'Error al actualizar producto', {
        productId,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async softDeleteProduct(productId: string): Promise<void> {
    try {
      const db = await this.databaseClient.getConnection();
      const now = new Date().toISOString();
      // Uso borrado lógico para no romper referencias históricas en sale_items y stock_movements.
      const result = await db.runAsync(
        'UPDATE products SET is_active = 0, updated_at = ? WHERE id = ? AND is_active = 1;',
        [now, productId]
      );

      if (result.changes === 0) {
        throw new EntityNotFoundError('Product', productId);
      }
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al desactivar producto', {
        productId,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async adjustStockAtomic(input: AdjustStockPersistenceInput): Promise<Product> {
    try {
      const db = await this.databaseClient.getConnection();
      let adjustedProduct: Product | null = null;

      await db.withExclusiveTransactionAsync(async (txn) => {
        const current = await txn.getFirstAsync<ProductRow>(
          'SELECT * FROM products WHERE id = ? AND is_active = 1;',
          [input.productId]
        );

        if (!current) {
          throw new EntityNotFoundError('Product', input.productId);
        }

        const nextStockQty = current.stock_qty + input.deltaQty;
        if (nextStockQty < 0) {
          throw new InsufficientStockError(
            current.name,
            current.stock_qty,
            Math.abs(input.deltaQty)
          );
        }

        const now = new Date().toISOString();
        await txn.runAsync('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?;', [
          nextStockQty,
          now,
          input.productId,
        ]);

        await txn.runAsync(
          `INSERT INTO stock_movements (
            id, product_id, movement_type, delta_qty, reference_sale_id, reason, created_at
          ) VALUES (?, ?, ?, ?, NULL, ?, ?);`,
          [
            Crypto.randomUUID(),
            input.productId,
            input.movementType,
            input.deltaQty,
            input.reason,
            now,
          ]
        );

        adjustedProduct = {
          ...this.mapProduct(current),
          stockQty: nextStockQty,
          updatedAt: now,
        };
      });

      if (!adjustedProduct) {
        throw new EntityNotFoundError('Product', input.productId);
      }

      return adjustedProduct;
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_TRANSACTION_ERROR', 'Error al ajustar stock', {
        productId: input.productId,
        deltaQty: input.deltaQty,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async listStockMovements(productId: string, limit: number = 50): Promise<StockMovement[]> {
    try {
      const db = await this.databaseClient.getConnection();
      const rows = await db.getAllAsync<StockMovementRow>(
        `SELECT id, product_id, movement_type, delta_qty, reference_sale_id, reason, created_at
         FROM stock_movements
         WHERE product_id = ?
         ORDER BY created_at DESC
         LIMIT ?;`,
        [productId, limit]
      );

      return rows.map((row) => ({
        id: row.id,
        productId: row.product_id,
        movementType: row.movement_type,
        deltaQty: row.delta_qty,
        referenceSaleId: row.reference_sale_id,
        reason: row.reason,
        createdAt: row.created_at,
      }));
    } catch (error: unknown) {
      const mapped = mapSqliteError(
        error,
        'DB_QUERY_ERROR',
        'Error al listar movimientos de stock',
        { productId }
      );
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  private mapCategory(row: CategoryRow): Category {
    return {
      id: row.id,
      name: row.name,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
    };
  }

  private mapProduct(row: ProductRow): Product {
    return {
      id: row.id,
      categoryId: row.category_id,
      name: row.name,
      unitType: row.unit_type,
      unitPriceCents: row.unit_price_cents,
      priceBaseQty: row.price_base_qty,
      stockQty: row.stock_qty,
      minStockAlert: row.min_stock_alert,
      imageUri: row.image_uri,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}