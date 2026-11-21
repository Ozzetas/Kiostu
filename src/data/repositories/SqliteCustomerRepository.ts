import * as Crypto from 'expo-crypto';
import { EntityNotFoundError, ValidationError } from '../../core/errors/AppError';
import { Logger } from '../../core/logging/Logger';
import { Customer, CustomerBalance, CustomerPayment } from '../../domain/entities/types';
import {
    CreateCustomerInput,
    ICustomerRepository,
    RecordPaymentPersistenceInput,
    UpdateCustomerInput,
} from '../../domain/repositories/ICustomerRepository';
import { DatabaseClient } from '../database/DatabaseClient';
import { mapSqliteError } from '../database/sqliteErrorMapper';

interface CustomerRow {
  readonly id: string;
  readonly full_name: string;
  readonly phone: string | null;
  readonly notes: string | null;
  readonly is_active: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface CustomerBalanceRow {
  readonly customer_id: string;
  readonly full_name: string;
  readonly total_credited_cents: number;
  readonly total_paid_cents: number;
  readonly current_debt_cents: number;
}

interface CustomerPaymentRow {
  readonly id: string;
  readonly customer_id: string;
  readonly amount_cents: number;
  readonly notes: string | null;
  readonly created_at: string;
}

export class SqliteCustomerRepository implements ICustomerRepository {
  private readonly logger = new Logger('SqliteCustomerRepository');

  constructor(private readonly databaseClient: DatabaseClient) {}

  public async listActiveCustomers(): Promise<Customer[]> {
    try {
      const db = await this.databaseClient.getConnection();
      const rows = await db.getAllAsync<CustomerRow>(
        'SELECT * FROM customers WHERE is_active = 1 ORDER BY full_name ASC;'
      );
      return rows.map((row) => this.mapCustomer(row));
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al listar clientes activos');
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async listBalances(onlyWithDebt: boolean = false): Promise<CustomerBalance[]> {
    try {
      const db = await this.databaseClient.getConnection();
      const sql = onlyWithDebt
        ? 'SELECT * FROM v_customer_balances WHERE current_debt_cents > 0 ORDER BY current_debt_cents DESC, full_name ASC;'
        : 'SELECT * FROM v_customer_balances ORDER BY current_debt_cents DESC, full_name ASC;';

      const rows = await db.getAllAsync<CustomerBalanceRow>(sql);
      return rows.map((row) => this.mapBalance(row));
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al consultar saldos de clientes');
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async findById(customerId: string): Promise<Customer | null> {
    try {
      const db = await this.databaseClient.getConnection();
      const row = await db.getFirstAsync<CustomerRow>('SELECT * FROM customers WHERE id = ?;', [
        customerId,
      ]);
      return row ? this.mapCustomer(row) : null;
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al buscar cliente por ID', {
        customerId,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async getBalanceByCustomerId(customerId: string): Promise<CustomerBalance | null> {
    try {
      const db = await this.databaseClient.getConnection();
      const row = await db.getFirstAsync<CustomerBalanceRow>(
        'SELECT * FROM v_customer_balances WHERE customer_id = ?;',
        [customerId]
      );
      return row ? this.mapBalance(row) : null;
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al consultar saldo del cliente', {
        customerId,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    const cleanName = input.fullName.trim();
    if (cleanName.length === 0) {
      throw new ValidationError('El nombre del cliente no puede estar vacío.');
    }

    const id = Crypto.randomUUID();
    const now = new Date().toISOString();
    const cleanPhone = input.phone?.trim() || null;
    const cleanNotes = input.notes?.trim() || null;

    try {
      const db = await this.databaseClient.getConnection();
      await db.runAsync(
        `INSERT INTO customers (id, full_name, phone, notes, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?);`,
        [id, cleanName, cleanPhone, cleanNotes, now, now]
      );

      return {
        id,
        fullName: cleanName,
        phone: cleanPhone,
        notes: cleanNotes,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al registrar cliente', {
        fullName: cleanName,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async updateCustomer(customerId: string, input: UpdateCustomerInput): Promise<Customer> {
    try {
      const db = await this.databaseClient.getConnection();
      let updated: Customer | null = null;

      await db.withExclusiveTransactionAsync(async (txn) => {
        const current = await txn.getFirstAsync<CustomerRow>(
          'SELECT * FROM customers WHERE id = ? AND is_active = 1;',
          [customerId]
        );

        if (!current) {
          throw new EntityNotFoundError('Customer', customerId);
        }

        const now = new Date().toISOString();
        const nextName = input.fullName !== undefined ? input.fullName.trim() : current.full_name;
        const nextPhone = input.phone !== undefined ? input.phone?.trim() || null : current.phone;
        const nextNotes = input.notes !== undefined ? input.notes?.trim() || null : current.notes;

        if (nextName.length === 0) {
          throw new ValidationError('El nombre del cliente no puede estar vacío.');
        }

        await txn.runAsync(
          'UPDATE customers SET full_name = ?, phone = ?, notes = ?, updated_at = ? WHERE id = ?;',
          [nextName, nextPhone, nextNotes, now, customerId]
        );

        updated = {
          id: current.id,
          fullName: nextName,
          phone: nextPhone,
          notes: nextNotes,
          isActive: true,
          createdAt: current.created_at,
          updatedAt: now,
        };
      });

      if (!updated) {
        throw new EntityNotFoundError('Customer', customerId);
      }

      return updated;
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_TRANSACTION_ERROR', 'Error al actualizar cliente', {
        customerId,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async softDeleteCustomer(customerId: string): Promise<void> {
    try {
      const db = await this.databaseClient.getConnection();

      await db.withExclusiveTransactionAsync(async (txn) => {
        const balance = await txn.getFirstAsync<CustomerBalanceRow>(
          'SELECT * FROM v_customer_balances WHERE customer_id = ?;',
          [customerId]
        );

        if (!balance) {
          throw new EntityNotFoundError('Customer', customerId);
        }

        // Impido ocultar clientes con deuda activa para evitar pérdida silenciosa de cuentas por cobrar.
        if (balance.current_debt_cents > 0) {
          throw new ValidationError(
            'No se puede eliminar un cliente que todavía registra deuda pendiente.',
            { customerId, currentDebtCents: balance.current_debt_cents }
          );
        }

        await txn.runAsync('UPDATE customers SET is_active = 0, updated_at = ? WHERE id = ?;', [
          new Date().toISOString(),
          customerId,
        ]);
      });
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_TRANSACTION_ERROR', 'Error al desactivar cliente', {
        customerId,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async recordPaymentAtomic(input: RecordPaymentPersistenceInput): Promise<CustomerPayment> {
    try {
      const db = await this.databaseClient.getConnection();
      let payment: CustomerPayment | null = null;

      await db.withExclusiveTransactionAsync(async (txn) => {
        const balance = await txn.getFirstAsync<CustomerBalanceRow>(
          'SELECT * FROM v_customer_balances WHERE customer_id = ?;',
          [input.customerId]
        );

        if (!balance) {
          throw new EntityNotFoundError('Customer', input.customerId);
        }

        if (balance.current_debt_cents <= 0) {
          throw new ValidationError('El cliente no tiene deuda pendiente para cancelar.', {
            customerId: input.customerId,
          });
        }

        // Valido el límite de deuda dentro de la transacción exclusiva para evitar sobrepagos por doble toque.
        if (input.amountCents > balance.current_debt_cents) {
          throw new ValidationError('El monto abonado supera la deuda actual del cliente.', {
            customerId: input.customerId,
            amountCents: input.amountCents,
            currentDebtCents: balance.current_debt_cents,
          });
        }

        const id = Crypto.randomUUID();
        const now = new Date().toISOString();

        await txn.runAsync(
          `INSERT INTO customer_payments (id, customer_id, amount_cents, notes, created_at)
           VALUES (?, ?, ?, ?, ?);`,
          [id, input.customerId, input.amountCents, input.notes, now]
        );

        payment = {
          id,
          customerId: input.customerId,
          amountCents: input.amountCents,
          notes: input.notes,
          createdAt: now,
        };
      });

      if (!payment) {
        throw new EntityNotFoundError('Customer', input.customerId);
      }

      return payment;
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_TRANSACTION_ERROR', 'Error al registrar pago', {
        customerId: input.customerId,
        amountCents: input.amountCents,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  public async listPaymentsByCustomer(customerId: string): Promise<CustomerPayment[]> {
    try {
      const db = await this.databaseClient.getConnection();
      const rows = await db.getAllAsync<CustomerPaymentRow>(
        `SELECT id, customer_id, amount_cents, notes, created_at
         FROM customer_payments
         WHERE customer_id = ?
         ORDER BY created_at DESC;`,
        [customerId]
      );

      return rows.map((row) => ({
        id: row.id,
        customerId: row.customer_id,
        amountCents: row.amount_cents,
        notes: row.notes,
        createdAt: row.created_at,
      }));
    } catch (error: unknown) {
      const mapped = mapSqliteError(error, 'DB_QUERY_ERROR', 'Error al listar pagos del cliente', {
        customerId,
      });
      this.logger.error(mapped.message, mapped);
      throw mapped;
    }
  }

  private mapCustomer(row: CustomerRow): Customer {
    return {
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      notes: row.notes,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapBalance(row: CustomerBalanceRow): CustomerBalance {
    return {
      customerId: row.customer_id,
      fullName: row.full_name,
      totalCreditedCents: row.total_credited_cents,
      totalPaidCents: row.total_paid_cents,
      currentDebtCents: row.current_debt_cents,
    };
  }
}