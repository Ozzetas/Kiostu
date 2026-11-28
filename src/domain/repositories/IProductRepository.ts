import { Category, Product, StockMovement, UnitType } from '../entities/types';

export interface CreateCategoryInput {
  readonly name: string;
  readonly sortOrder?: number;
}

export interface CreateProductInput {
  readonly categoryId: string | null;
  readonly name: string;
  readonly unitType: UnitType;
  readonly costPriceCents?: number;
  readonly wholesalePriceCents?: number;
  readonly unitPriceCents: number;
  readonly priceBaseQty: number;
  readonly initialStockQty: number;
  readonly minStockAlert: number;
  readonly imageUri: string | null;
}

export interface UpdateProductInput {
  readonly categoryId?: string | null;
  readonly name?: string;
  readonly costPriceCents?: number;
  readonly wholesalePriceCents?: number;
  readonly unitPriceCents?: number;
  readonly priceBaseQty?: number;
  readonly minStockAlert?: number;
  readonly imageUri?: string | null;
}

export interface AdjustStockPersistenceInput {
  readonly productId: string;
  readonly deltaQty: number;
  readonly movementType: 'IN_PURCHASE' | 'ADJUSTMENT';
  readonly reason: string | null;
}

export interface IProductRepository {
  listCategories(): Promise<Category[]>;
  createCategory(input: CreateCategoryInput): Promise<Category>;
  deleteCategory(categoryId: string): Promise<void>;
  listActiveProducts(categoryId?: string): Promise<Product[]>;
  findById(productId: string): Promise<Product | null>;
  createProduct(input: CreateProductInput): Promise<Product>;
  updateProduct(productId: string, input: UpdateProductInput): Promise<Product>;
  softDeleteProduct(productId: string): Promise<void>;
  adjustStockAtomic(input: AdjustStockPersistenceInput): Promise<Product>;
  listStockMovements(productId: string, limit?: number): Promise<StockMovement[]>;
}