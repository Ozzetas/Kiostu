import { useCallback, useEffect, useState } from 'react';
import { AppError } from '../../core/errors/AppError';
import { Logger } from '../../core/logging/Logger';
import { Customer, CustomerBalance } from '../../domain/entities/types';
import { useSecuritySession } from '../components/SecurityGate';
import { useAppServices } from '../di/AppServicesProvider';

const logger = new Logger('useCustomers');

export interface CustomerWithBalance {
  readonly customer: Customer;
  readonly balance: CustomerBalance;
}

export interface UseCustomersState {
  readonly items: readonly CustomerWithBalance[];
  readonly totalDebtCents: number;
  readonly debtorsCount: number;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly refresh: () => Promise<void>;
}

export function useCustomers(): UseCustomersState {
  const { services, isReady, dataRevision } = useAppServices();
  const { isUnlocked } = useSecuritySession();

  const [items, setItems] = useState<readonly CustomerWithBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadCustomers = useCallback(async (): Promise<void> => {
    // Limpio datos sensibles de clientes en memoria si la bóveda se bloquea.
    if (!isReady || !isUnlocked) {
      setItems([]);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [customers, balances] = await Promise.all([
        services.customerRepository.listActiveCustomers(),
        services.customerRepository.listBalances(false),
      ]);

      const balanceById = new Map<string, CustomerBalance>(
        balances.map((entry) => [entry.customerId, entry])
      );

      const merged: CustomerWithBalance[] = customers.map((customer) => ({
        customer,
        balance: balanceById.get(customer.id) ?? {
          customerId: customer.id,
          fullName: customer.fullName,
          totalCreditedCents: 0,
          totalPaidCents: 0,
          currentDebtCents: 0,
        },
      }));

      // Priorizo deudores arriba por monto descendente y luego orden alfabético.
      merged.sort((a, b) => {
        if (b.balance.currentDebtCents !== a.balance.currentDebtCents) {
          return b.balance.currentDebtCents - a.balance.currentDebtCents;
        }
        return a.customer.fullName.localeCompare(b.customer.fullName);
      });

      setItems(merged);
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al cargar clientes y saldos desde SQLite', normalized);
      setErrorMessage(
        error instanceof AppError ? error.message : 'No se pudo cargar la agenda de clientes.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [services, isReady, isUnlocked]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers, dataRevision]);

  const totalDebtCents = items.reduce((acc, entry) => acc + entry.balance.currentDebtCents, 0);
  const debtorsCount = items.filter((entry) => entry.balance.currentDebtCents > 0).length;

  return {
    items,
    totalDebtCents,
    debtorsCount,
    isLoading,
    errorMessage,
    refresh: loadCustomers,
  };
}