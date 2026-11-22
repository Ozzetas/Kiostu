import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Logger } from '../src/core/logging/Logger';
import { SecurityGate } from '../src/presentation/components/SecurityGate';
import { AppServicesProvider } from '../src/presentation/di/AppServicesProvider';

const logger = new Logger('RootLayout');

// Retengo la splash screen hasta finalizar la apertura y migración de SQLite.
void SplashScreen.preventAutoHideAsync().catch((error: unknown) => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  logger.warn('No se pudo retener la splash screen automáticamente', {
    reason: normalized.message,
  });
});

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const handleAppReady = useCallback(() => {
    void SplashScreen.hideAsync().catch((error: unknown) => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.warn('No se pudo ocultar la splash screen', { reason: normalized.message });
    });
  }, []);

  return (
    <SafeAreaProvider>
      <AppServicesProvider onReady={handleAppReady}>
        <SecurityGate>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="modal"
              options={{ presentation: 'modal', headerShown: true, title: 'Detalle' }}
            />
            <Stack.Screen name="+not-found" />
          </Stack>
        </SecurityGate>
      </AppServicesProvider>
    </SafeAreaProvider>
  );
}