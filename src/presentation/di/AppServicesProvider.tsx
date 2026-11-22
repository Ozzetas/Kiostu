import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppError } from '../../core/errors/AppError';
import { Logger } from '../../core/logging/Logger';
import { Colors, Radius, Spacing, Typography } from '../theme/tokens';
import { AppServices, getAppServices } from './ServiceContainer';

const logger = new Logger('AppServicesProvider');

interface AppServicesContextValue {
  readonly services: AppServices;
  readonly dataRevision: number;
  readonly notifyDataChanged: () => void;
}

const AppServicesContext = createContext<AppServicesContextValue | null>(null);

interface AppServicesProviderProps {
  readonly onReady?: () => void;
  readonly children: React.ReactNode;
}

export function AppServicesProvider({ onReady, children }: AppServicesProviderProps) {
  const services = useMemo(() => getAppServices(), []);
  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  // Incremento este contador tras cada mutación, wipe o restore para invalidar caches locales en pantallas.
  const [dataRevision, setDataRevision] = useState(0);

  const notifyDataChanged = useCallback(() => {
    setDataRevision((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function bootstrapDatabase(): Promise<void> {
      setInitError(null);
      try {
        await services.databaseClient.getConnection();
        if (isMounted) {
          setIsReady(true);
          onReady?.();
        }
      } catch (error: unknown) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        logger.error('Error crítico al inicializar la base de datos local', normalized);

        if (isMounted) {
          const userMessage =
            error instanceof AppError
              ? error.message
              : 'No se pudo inicializar el almacenamiento local del dispositivo.';
          setInitError(userMessage);
          onReady?.();
        }
      }
    }

    void bootstrapDatabase();

    return () => {
      isMounted = false;
    };
  }, [services, retryCount, onReady]);

  const contextValue = useMemo<AppServicesContextValue>(
    () => ({
      services,
      dataRevision,
      notifyDataChanged,
    }),
    [services, dataRevision, notifyDataChanged]
  );

  if (initError !== null) {
    return (
      <SafeAreaView style={styles.centeredContainer}>
        <Text style={styles.errorTitle}>Error de almacenamiento local</Text>
        <Text style={styles.errorDetail}>{initError}</Text>
        <Pressable
          style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
          onPress={() => setRetryCount((prev) => prev + 1)}
        >
          <Text style={styles.retryButtonText}>Reintentar inicialización</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!isReady) {
    return (
      <SafeAreaView style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Preparando almacenamiento local...</Text>
      </SafeAreaView>
    );
  }

  return (
    <AppServicesContext.Provider value={contextValue}>{children}</AppServicesContext.Provider>
  );
}

export function useAppServices(): AppServicesContextValue {
  const context = useContext(AppServicesContext);
  if (context === null) {
    throw new Error('useAppServices debe utilizarse dentro de AppServicesProvider.');
  }
  return context;
}

const styles = StyleSheet.create({
  centeredContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  loadingText: {
    fontSize: Typography.body,
    color: Colors.textSecondary,
  },
  errorTitle: {
    fontSize: Typography.subtitle,
    fontWeight: '700',
    color: Colors.danger,
    textAlign: 'center',
  },
  errorDetail: {
    fontSize: Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
  },
  retryButtonPressed: {
    backgroundColor: Colors.primaryPressed,
  },
  retryButtonText: {
    color: Colors.white,
    fontSize: Typography.body,
    fontWeight: '600',
  },
});