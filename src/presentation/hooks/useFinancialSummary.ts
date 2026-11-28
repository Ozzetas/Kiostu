import { useCallback, useEffect, useState } from 'react';
import { AppError } from '../../core/errors/AppError';
import { Logger } from '../../core/logging/Logger';
import { FinancialSummary } from '../../domain/entities/types';
import { useSecuritySession } from '../components/SecurityGate';
import { useAppServices } from '../di/AppServicesProvider';

const logger = new Logger('useFinancialSummary');

const EMPTY_SUMMARY: FinancialSummary = {
  pendingDebtCents: 0,
  totalCollectedCents: 0,
  realizedNetProfitCents: 0,
  pendingNetProfitCents: 0,
  totalBilledCents: 0,
  totalCostCents: 0,
};

export interface UseFinancialSummaryState {
  readonly summary: FinancialSummary;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly refresh: () => Promise<void>;
}

export function useFinancialSummary(): UseFinancialSummaryState {
  const { services, isReady, dataRevision } = useAppServices();
  const { isUnlocked } = useSecuritySession();

  const [summary, setSummary] = useState<FinancialSummary>(EMPTY_SUMMARY);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSummary = useCallback(async (): Promise<void> => {
    // Limpio métricas financieras en memoria cuando se cierra la agenda.
    if (!isReady || !isUnlocked) {
      setSummary(EMPTY_SUMMARY);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const result = await services.saleRepository.getFinancialSummary();
      setSummary(result);
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al cargar el resumen financiero', normalized);
      setErrorMessage(
        error instanceof AppError ? error.message : 'No se pudieron calcular las ganancias.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [services, isReady, isUnlocked]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary, dataRevision]);

  return {
    summary,
    isLoading,
    errorMessage,
    refresh: loadSummary,
  };
}