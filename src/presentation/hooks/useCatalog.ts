import { useCallback, useEffect, useState } from 'react';
import { AppError } from '../../core/errors/AppError';
import { Logger } from '../../core/logging/Logger';
import { Category, Product } from '../../domain/entities/types';
import { useSecuritySession } from '../components/SecurityGate';
import { useAppServices } from '../di/AppServicesProvider';

const logger = new Logger('useCatalog');

export interface UseCatalogState {
  readonly categories: readonly Category[];
  readonly products: readonly Product[];
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly refresh: () => Promise<void>;
}

export function useCatalog(selectedCategoryId: string | null): UseCatalogState {
  const { services, isReady, dataRevision } = useAppServices();
  const { isUnlocked } = useSecuritySession();

  const [categories, setCategories] = useState<readonly Category[]>([]);
  const [products, setProducts] = useState<readonly Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadCatalog = useCallback(async (): Promise<void> => {
    // Bloqueo cualquier lectura de SQLite y limpio la memoria si la bóveda está bloqueada.
    if (!isReady || !isUnlocked) {
      setCategories([]);
      setProducts([]);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [loadedCategories, loadedProducts] = await Promise.all([
        services.productRepository.listCategories(),
        services.productRepository.listActiveProducts(selectedCategoryId ?? undefined),
      ]);

      setCategories(loadedCategories);
      setProducts(loadedProducts);
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al cargar el catálogo desde SQLite', normalized, { selectedCategoryId });
      setErrorMessage(
        error instanceof AppError
          ? error.message
          : 'No se pudo cargar el inventario local.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [services, isReady, isUnlocked, selectedCategoryId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog, dataRevision]);

  return {
    categories,
    products,
    isLoading,
    errorMessage,
    refresh: loadCatalog,
  };
}