export const SCHEMA_VERSION = 3;

// Ejecuto los PRAGMA a nivel conexión y fuera de cualquier transacción porque SQLite rechaza cambiar a WAL dentro de una transacción.
export const CONNECTION_PRAGMAS_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`;

export const INITIAL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY NOT NULL,
    category_id TEXT NULL,
    name TEXT NOT NULL,
    unit_type TEXT NOT NULL CHECK (unit_type IN ('UNIT', 'GRAM')),
    cost_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_price_cents >= 0),
    wholesale_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (wholesale_price_cents >= 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    -- Base de cálculo: 1 para UNIT; 1, 100 o 1000 (1 kg) para GRAM.
    price_base_qty INTEGER NOT NULL DEFAULT 1 CHECK (price_base_qty > 0),
    stock_qty INTEGER NOT NULL DEFAULT 0,
    min_stock_alert INTEGER NOT NULL DEFAULT 0 CHECK (min_stock_alert >= 0),
    image_uri TEXT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT NULL,
    notes TEXT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY NOT NULL,
    customer_id TEXT NULL,
    payment_type TEXT NOT NULL CHECK (payment_type IN ('CASH', 'CREDIT', 'MIXED')),
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    paid_cents INTEGER NOT NULL CHECK (paid_cents >= 0 AND paid_cents <= total_cents),
    status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'VOIDED')),
    created_at TEXT NOT NULL,
    -- Garantizo a nivel motor que toda operación fiada o mixta referencie a un cliente.
    CHECK (payment_type = 'CASH' OR customer_id IS NOT NULL),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY NOT NULL,
    sale_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    -- Congelo nombre, modalidad, precio y costo al momento de la venta para preservar integridad contable histórica.
    product_name_snapshot TEXT NOT NULL,
    unit_type_snapshot TEXT NOT NULL CHECK (unit_type_snapshot IN ('UNIT', 'GRAM')),
    sale_tier TEXT NOT NULL DEFAULT 'RETAIL' CHECK (sale_tier IN ('RETAIL', 'WHOLESALE')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_snapshot_cents INTEGER NOT NULL CHECK (unit_price_snapshot_cents >= 0),
    unit_cost_snapshot_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_snapshot_cents >= 0),
    price_base_qty_snapshot INTEGER NOT NULL CHECK (price_base_qty_snapshot > 0),
    subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
    cost_subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_subtotal_cents >= 0),
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS customer_payments (
    id TEXT PRIMARY KEY NOT NULL,
    customer_id TEXT NOT NULL,
    reference_sale_id TEXT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    notes TEXT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    FOREIGN KEY (reference_sale_id) REFERENCES sales(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY NOT NULL,
    product_id TEXT NOT NULL,
    movement_type TEXT NOT NULL CHECK (
      movement_type IN ('IN_PURCHASE', 'OUT_SALE', 'ADJUSTMENT', 'VOID_RETURN')
    ),
    delta_qty INTEGER NOT NULL,
    reference_sale_id TEXT NULL,
    reason TEXT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    FOREIGN KEY (reference_sale_id) REFERENCES sales(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_products_active_category ON products(is_active, category_id);
  CREATE INDEX IF NOT EXISTS idx_sales_customer_status ON sales(customer_id, status);
  CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
  CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_id ON customer_payments(customer_id);
  CREATE INDEX IF NOT EXISTS idx_customer_payments_sale_id ON customer_payments(reference_sale_id);
  CREATE INDEX IF NOT EXISTS idx_stock_movements_product_date ON stock_movements(product_id, created_at DESC);

  -- Uso subconsultas pre-agregadas para evitar producto cartesiano entre ventas y pagos al sumar saldos.
  CREATE VIEW IF NOT EXISTS v_customer_balances AS
  SELECT
    c.id AS customer_id,
    c.full_name,
    COALESCE(s.total_credited_cents, 0) AS total_credited_cents,
    COALESCE(p.total_paid_cents, 0) AS total_paid_cents,
    COALESCE(s.total_credited_cents, 0) - COALESCE(p.total_paid_cents, 0) AS current_debt_cents
  FROM customers c
  LEFT JOIN (
    SELECT
      customer_id,
      SUM(total_cents - paid_cents) AS total_credited_cents
    FROM sales
    WHERE status = 'COMPLETED' AND customer_id IS NOT NULL
    GROUP BY customer_id
  ) s ON s.customer_id = c.id
  LEFT JOIN (
    SELECT
      customer_id,
      SUM(amount_cents) AS total_paid_cents
    FROM customer_payments
    GROUP BY customer_id
  ) p ON p.customer_id = c.id
  WHERE c.is_active = 1;
`;

// Migración incremental v1 -> v2 para dispositivos que ya tienen productos y ventas cargadas.
export const MIGRATION_V1_TO_V2_SQL = `
  ALTER TABLE products ADD COLUMN cost_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_price_cents >= 0);
  ALTER TABLE products ADD COLUMN wholesale_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (wholesale_price_cents >= 0);
  UPDATE products SET wholesale_price_cents = unit_price_cents WHERE wholesale_price_cents = 0;

  ALTER TABLE sale_items ADD COLUMN sale_tier TEXT NOT NULL DEFAULT 'RETAIL' CHECK (sale_tier IN ('RETAIL', 'WHOLESALE'));
  ALTER TABLE sale_items ADD COLUMN unit_cost_snapshot_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_snapshot_cents >= 0);
  ALTER TABLE sale_items ADD COLUMN cost_subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_subtotal_cents >= 0);
`;

// Migración incremental v2 -> v3 para vincular pagos puntuales a una venta fiada específica.
export const MIGRATION_V2_TO_V3_SQL = `
  ALTER TABLE customer_payments ADD COLUMN reference_sale_id TEXT NULL REFERENCES sales(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_customer_payments_sale_id ON customer_payments(reference_sale_id);
`;