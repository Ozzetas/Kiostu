import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppError } from '../../core/errors/AppError';
import { Logger } from '../../core/logging/Logger';
import {
  AuthOutcome,
  AuthRequirement,
  DEFAULT_SESSION_TIMEOUT_MS,
} from '../../domain/entities/security';
import { useAppServices } from '../di/AppServicesProvider';
import { Colors, Radius, Shadows, Spacing, Typography } from '../theme/tokens';
import { ErrorBanner } from './ErrorBanner';
import { PrivacyOverlay } from './PrivacyOverlay';

const logger = new Logger('SecurityGate');

interface SecuritySessionContextValue {
  readonly isUnlocked: boolean;
  readonly lockNow: () => void;
  readonly resetVaultForDev: () => Promise<void>;
}

const SecuritySessionContext = createContext<SecuritySessionContextValue | null>(null);

export function useSecuritySession(): SecuritySessionContextValue {
  const ctx = useContext(SecuritySessionContext);
  if (ctx === null) {
    throw new Error('useSecuritySession debe utilizarse dentro de SecurityGate.');
  }
  return ctx;
}

interface TimeoutOption {
  readonly label: string;
  readonly ms: number;
}

const TIMEOUT_OPTIONS: readonly TimeoutOption[] = [
  { label: '5 min', ms: DEFAULT_SESSION_TIMEOUT_MS },
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '1 hora', ms: 60 * 60 * 1000 },
];

type FailedAuthReason = Extract<AuthOutcome, { status: 'FAILED' }>['reason'];

// Normalizo el estado crudo de AppState para garantizar seguridad de tipos frente a valores nulos en RN 0.88+.
function normalizeAppState(rawState: string | null | undefined): AppStateStatus {
  if (
    rawState === 'active' ||
    rawState === 'background' ||
    rawState === 'inactive' ||
    rawState === 'extension' ||
    rawState === 'unknown'
  ) {
    return rawState;
  }
  return 'unknown';
}

function mapAuthFailureToMessage(reason: FailedAuthReason): string {
  switch (reason) {
    case 'INVALID_PASSWORD':
      return 'Contraseña incorrecta.';
    case 'PASSWORD_REQUIRED_BY_POLICY':
      return 'Expiró la ventana de sesión. Ingresá tu clave principal para abrir la agenda.';
    case 'BIOMETRIC_CANCELLED':
      return 'Usá tu clave para abrir la agenda.';
    case 'BIOMETRIC_UNAVAILABLE':
      return 'Face ID no disponible en este momento. Ingresá tu clave.';
    case 'BIOMETRIC_FAILED':
      return 'No se pudo reconocer tu rostro. Reintentá o ingresá tu clave.';
    case 'NOT_CONFIGURED':
      return 'Debés configurar una clave principal primero.';
  }
}

function AgendaBookFrame({ children }: { readonly children: React.ReactNode }) {
  return (
    <View style={styles.bookOuter}>
      {/* Lomo metálico izquierdo con bisagras LED inspirado en una agenda cerrada */}
      <View style={styles.bookSpine}>
        <View style={styles.spineHinge}>
          <View style={styles.spineLed} />
        </View>
        <View style={styles.spineGroove} />
        <View style={styles.spineHinge}>
          <View style={styles.spineLed} />
        </View>
        <View style={styles.spineGroove} />
        <View style={styles.spineHinge}>
          <View style={styles.spineLed} />
        </View>
      </View>

      {/* Tapa frontal de la agenda */}
      <View style={styles.bookCover}>
        <View style={styles.coverTopStrip}>
          <Text style={styles.coverMicroBrand}>SMART LEDGER</Text>
          <View style={styles.offlineBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.offlineBadgeText}>100% OFFLINE</Text>
          </View>
        </View>

        {children}

        <View style={styles.coverFooter}>
          <View style={styles.circuitLine} />
          <Text style={styles.coverFooterText}>FINANZAS & CAPITAL · SOLO EN ESTE DISPOSITIVO</Text>
        </View>
      </View>

      {/* Pestaña lateral derecha simulando el cierre de la agenda */}
      <View style={styles.bookClasp}>
        <View style={styles.claspLed} />
      </View>
    </View>
  );
}

interface SecurityGateProps {
  readonly children: React.ReactNode;
}

export function SecurityGate({ children }: SecurityGateProps) {
  const { services, isReady, notifyDataChanged } = useAppServices();

  const [requirement, setRequirement] = useState<AuthRequirement | null>(null);
  const [showPrivacyOverlay, setShowPrivacyOverlay] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [unlockPassword, setUnlockPassword] = useState('');
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);

  const [setupPrimary, setSetupPrimary] = useState('');
  const [setupPrimaryConfirm, setSetupPrimaryConfirm] = useState('');
  const [setupPanic, setSetupPanic] = useState('');
  const [showSetupPasswords, setShowSetupPasswords] = useState(false);
  const [setupBiometricEnabled, setSetupBiometricEnabled] = useState(true);
  const [setupTimeoutMs, setSetupTimeoutMs] = useState<number>(DEFAULT_SESSION_TIMEOUT_MS);

  const requirementRef = useRef<AuthRequirement | null>(null);
  const appStateRef = useRef<AppStateStatus>(normalizeAppState(AppState.currentState));
  const isBiometricPromptActiveRef = useRef(false);

  useEffect(() => {
    requirementRef.current = requirement;
  }, [requirement]);

  const attemptBiometricUnlock = useCallback(async (): Promise<void> => {
    if (isBiometricPromptActiveRef.current) {
      return;
    }

    isBiometricPromptActiveRef.current = true;
    setErrorMessage(null);
    setIsBusy(true);

    try {
      const outcome = await services.authenticateUserUseCase.authenticateWithBiometrics(false);
      if (outcome.status === 'AUTHENTICATED') {
        setUnlockPassword('');
        setRequirement('UNLOCKED');
        return;
      }

      if (outcome.status === 'FAILED') {
        if (outcome.reason === 'PASSWORD_REQUIRED_BY_POLICY') {
          setRequirement('PASSWORD_REQUIRED');
        }
        setErrorMessage(mapAuthFailureToMessage(outcome.reason));
      }
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Fallo inesperado durante el desbloqueo biométrico', normalized);
      setErrorMessage('Error al verificar biometría. Ingresá tu clave.');
    } finally {
      isBiometricPromptActiveRef.current = false;
      setIsBusy(false);
    }
  }, [services]);

  const evaluateAccess = useCallback(
    async (isColdStart: boolean): Promise<void> => {
      try {
        const nextRequirement =
          await services.authenticateUserUseCase.getRequiredAuthMethod(isColdStart);
        setRequirement(nextRequirement);
        setErrorMessage(null);

        if (nextRequirement === 'BIOMETRIC_OR_PASSWORD') {
          await attemptBiometricUnlock();
        }
      } catch (error: unknown) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        logger.error('Error al evaluar política de autenticación', normalized);
        setRequirement('PASSWORD_REQUIRED');
        setErrorMessage('Error al leer la configuración de seguridad.');
      }
    },
    [services, attemptBiometricUnlock]
  );

  // Espero a que SQLite termine de inicializarse antes de evaluar credenciales.
  useEffect(() => {
    if (!isReady) {
      return;
    }
    void evaluateAccess(true);
  }, [isReady, evaluateAccess]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (rawNextState: AppStateStatus) => {
      const nextState = normalizeAppState(rawNextState);
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState !== 'active') {
        if (!isBiometricPromptActiveRef.current) {
          setShowPrivacyOverlay(true);
        }

        if (nextState === 'background' && requirementRef.current === 'UNLOCKED') {
          void services.authenticateUserUseCase.recordUserActivity().catch((error: unknown) => {
            const normalized = error instanceof Error ? error : new Error(String(error));
            logger.error('No se pudo actualizar el timestamp de actividad al minimizar', normalized);
          });
          setUnlockPassword('');
          setRequirement('PASSWORD_REQUIRED');
        }
        return;
      }

      setShowPrivacyOverlay(false);

      if (previousState === 'background' && requirementRef.current !== 'SETUP_REQUIRED') {
        void evaluateAccess(false);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [services, evaluateAccess]);

  const lockNow = useCallback(() => {
    setUnlockPassword('');
    setErrorMessage(null);
    setRequirement('PASSWORD_REQUIRED');
  }, []);

  const resetVaultForDev = useCallback(async (): Promise<void> => {
    // Bloqueo cualquier ejecución fuera de desarrollo para proteger builds de producción.
    if (!__DEV__) {
      return;
    }
    await services.securityRepository.clearAllCredentials();
    setUnlockPassword('');
    setSetupPrimary('');
    setSetupPrimaryConfirm('');
    setSetupPanic('');
    setErrorMessage(null);
    setRequirement('SETUP_REQUIRED');
  }, [services]);

  const handleConfirmDevReset = useCallback((): void => {
    if (!__DEV__ || isBusy) {
      return;
    }

    Alert.alert(
      'Reiniciar Agenda (DEV)',
      'Se eliminarán las contraseñas del Keychain para volver a configurar la tapa inicial. Los datos de SQLite se conservan.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Reiniciar claves',
          style: 'destructive',
          onPress: () => {
            setIsBusy(true);
            void resetVaultForDev()
              .catch((error: unknown) => {
                const normalized = error instanceof Error ? error : new Error(String(error));
                logger.error('Fallo al reiniciar la bóveda desde pantalla de bloqueo', normalized);
                setErrorMessage(
                  error instanceof AppError
                    ? error.message
                    : 'No se pudo limpiar el Keychain de desarrollo.'
                );
              })
              .finally(() => {
                setIsBusy(false);
              });
          },
        },
      ]
    );
  }, [isBusy, resetVaultForDev]);

  const handlePasswordSubmit = async (): Promise<void> => {
    if (isBusy) {
      return;
    }

    setErrorMessage(null);
    setIsBusy(true);

    try {
      const outcome =
        await services.authenticateUserUseCase.authenticateWithPassword(unlockPassword);
      setUnlockPassword('');

      if (outcome.status === 'AUTHENTICATED') {
        setRequirement('UNLOCKED');
        return;
      }

      if (outcome.status === 'PANIC_WIPED') {
        notifyDataChanged();
        setRequirement('UNLOCKED');
        return;
      }

      setErrorMessage(mapAuthFailureToMessage(outcome.reason));
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error crítico al autenticar con contraseña', normalized);
      setErrorMessage(
        error instanceof AppError ? error.message : 'No se pudo completar la verificación.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleInitialSetupSubmit = async (): Promise<void> => {
    if (isBusy) {
      return;
    }

    setErrorMessage(null);

    if (setupPrimary !== setupPrimaryConfirm) {
      setErrorMessage('La confirmación de la contraseña principal no coincide.');
      return;
    }

    setIsBusy(true);

    try {
      await services.configureSecurityUseCase.setupInitialSecurity({
        primaryPassword: setupPrimary,
        panicPassword: setupPanic.length > 0 ? setupPanic : undefined,
        policy: {
          sessionTimeoutMs: setupTimeoutMs,
          biometricEnabled: setupBiometricEnabled,
        },
      });

      setSetupPrimary('');
      setSetupPrimaryConfirm('');
      setSetupPanic('');
      setRequirement('UNLOCKED');
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al guardar la configuración inicial de seguridad', normalized);
      setErrorMessage(
        error instanceof AppError ? error.message : 'No se pudo guardar la configuración.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const isUnlocked = requirement === 'UNLOCKED';
  const canUseBiometrics = requirement === 'BIOMETRIC_OR_PASSWORD';

  const sessionContextValue = useMemo<SecuritySessionContextValue>(
    () => ({
      isUnlocked,
      lockNow,
      resetVaultForDev,
    }),
    [isUnlocked, lockNow, resetVaultForDev]
  );

  return (
    <SecuritySessionContext.Provider value={sessionContextValue}>
      <View style={styles.rootFlex}>
        <StatusBar style={isUnlocked ? 'dark' : 'light'} />
        {/* Mantengo el Stack de Expo Router siempre montado; las pantallas restringen consultas vía isUnlocked. */}
        {children}

        {requirement === null && (
          <View style={[StyleSheet.absoluteFill, styles.gateOverlay]} pointerEvents="auto">
            <SafeAreaView style={styles.centeredVault}>
              <ActivityIndicator size="large" color={Colors.primaryLight} />
            </SafeAreaView>
          </View>
        )}

        {requirement === 'SETUP_REQUIRED' && (
          <View style={[StyleSheet.absoluteFill, styles.gateOverlay]} pointerEvents="auto">
            <SafeAreaView style={styles.vaultSafeArea}>
              <KeyboardAvoidingView
                style={styles.rootFlex}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              >
                <ScrollView
                  contentContainerStyle={styles.scrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <AgendaBookFrame>
                    <View style={styles.coverHeader}>
                      <Text style={styles.agendaTitle}>AGENDA</Text>
                      <View style={styles.usdShield}>
                        <Text style={styles.usdShieldText}>USD$</Text>
                      </View>
                      <Text style={styles.subtitle}>
                        Sellá tu agenda local. Tus productos y cuentas viven exclusivamente en este
                        teléfono.
                      </Text>
                    </View>

                    <ErrorBanner message={errorMessage} variant="dark" />

                    <View style={styles.sectionHeaderRow}>
                      <Text style={styles.kicker}>CERRADURA PRINCIPAL</Text>
                      <Pressable
                        onPress={() => setShowSetupPasswords((prev) => !prev)}
                        hitSlop={10}
                        style={styles.toggleVisibilityBtn}
                      >
                        <Ionicons
                          name={showSetupPasswords ? 'eye-off-outline' : 'eye-outline'}
                          size={16}
                          color={Colors.vaultTextSecondary}
                        />
                        <Text style={styles.toggleVisibilityText}>
                          {showSetupPasswords ? 'Ocultar' : 'Mostrar'}
                        </Text>
                      </Pressable>
                    </View>

                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Contraseña principal *</Text>
                      <TextInput
                        style={styles.vaultInput}
                        value={setupPrimary}
                        onChangeText={setSetupPrimary}
                        placeholder="Mínimo 4 caracteres"
                        placeholderTextColor={Colors.vaultTextMuted}
                        secureTextEntry={!showSetupPasswords}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>

                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Confirmar contraseña *</Text>
                      <TextInput
                        style={styles.vaultInput}
                        value={setupPrimaryConfirm}
                        onChangeText={setSetupPrimaryConfirm}
                        placeholder="Repetí tu clave maestra"
                        placeholderTextColor={Colors.vaultTextMuted}
                        secureTextEntry={!showSetupPasswords}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.fieldGroup}>
                      <Text style={styles.kicker}>PROTOCOLO DE PRIVACIDAD</Text>
                      <Text style={styles.label}>Clave de borrado rápido (opcional)</Text>
                      <Text style={styles.helperText}>
                        Distinta a la principal. Al ingresarla, limpia todas las hojas en silencio.
                      </Text>
                      <TextInput
                        style={styles.vaultInput}
                        value={setupPanic}
                        onChangeText={setSetupPanic}
                        placeholder="Opcional · dejar vacío para omitir"
                        placeholderTextColor={Colors.vaultTextMuted}
                        secureTextEntry={!showSetupPasswords}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.switchRow}>
                      <View style={styles.switchTextBlock}>
                        <Text style={styles.label}>Apertura ágil con Face ID</Text>
                        <Text style={styles.helperText}>Dentro de tu ventana de sesión</Text>
                      </View>
                      <Switch
                        value={setupBiometricEnabled}
                        onValueChange={setSetupBiometricEnabled}
                        trackColor={{
                          false: Colors.vaultSurfaceElevated,
                          true: Colors.primaryLight,
                        }}
                        thumbColor={Colors.white}
                      />
                    </View>

                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Pedir clave tras inactividad</Text>
                      <View style={styles.chipRow}>
                        {TIMEOUT_OPTIONS.map((option) => {
                          const selected = setupTimeoutMs === option.ms;
                          return (
                            <Pressable
                              key={option.ms}
                              style={[styles.chip, selected && styles.chipSelected]}
                              onPress={() => setSetupTimeoutMs(option.ms)}
                            >
                              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                                {option.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>

                    <Pressable
                      style={({ pressed }) => [
                        styles.primaryButton,
                        (pressed || isBusy) && styles.primaryButtonPressed,
                      ]}
                      onPress={() => void handleInitialSetupSubmit()}
                      disabled={isBusy}
                    >
                      {isBusy ? (
                        <ActivityIndicator color={Colors.white} />
                      ) : (
                        <>
                          <Text style={styles.primaryButtonText}>Sellar y abrir agenda</Text>
                          <Ionicons name="book-outline" size={18} color={Colors.white} />
                        </>
                      )}
                    </Pressable>
                  </AgendaBookFrame>
                </ScrollView>
              </KeyboardAvoidingView>
            </SafeAreaView>
          </View>
        )}

        {(requirement === 'PASSWORD_REQUIRED' || requirement === 'BIOMETRIC_OR_PASSWORD') && (
          <View style={[StyleSheet.absoluteFill, styles.gateOverlay]} pointerEvents="auto">
            <SafeAreaView style={styles.vaultSafeArea}>
              <KeyboardAvoidingView
                style={styles.rootFlex}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              >
                <ScrollView
                  contentContainerStyle={styles.lockScrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <AgendaBookFrame>
                    <View style={styles.coverHeader}>
                      <Text style={styles.agendaTitle}>AGENDA</Text>
                      <View style={styles.emblemOuter}>
                        <View style={styles.emblemInner}>
                          <Text style={styles.emblemUsdText}>USD$</Text>
                        </View>
                      </View>
                      <Text style={styles.subtitle}>
                        {canUseBiometrics
                          ? 'Usá Face ID o tu clave para abrir las hojas.'
                          : 'Agenda cerrada. Ingresá tu clave para abrirla.'}
                      </Text>
                    </View>

                    <ErrorBanner message={errorMessage} variant="dark" />

                    <View style={styles.fieldGroup}>
                      <Text style={styles.kicker}>CLAVE DE APERTURA</Text>
                      <View style={styles.passwordInputWrapper}>
                        <TextInput
                          style={styles.passwordInputField}
                          value={unlockPassword}
                          onChangeText={setUnlockPassword}
                          placeholder="Ingresá tu contraseña"
                          placeholderTextColor={Colors.vaultTextMuted}
                          secureTextEntry={!showUnlockPassword}
                          autoCapitalize="none"
                          autoCorrect={false}
                          returnKeyType="done"
                          onSubmitEditing={() => void handlePasswordSubmit()}
                        />
                        <Pressable
                          onPress={() => setShowUnlockPassword((prev) => !prev)}
                          hitSlop={10}
                          style={styles.eyeIconButton}
                        >
                          <Ionicons
                            name={showUnlockPassword ? 'eye-off-outline' : 'eye-outline'}
                            size={20}
                            color={Colors.vaultTextSecondary}
                          />
                        </Pressable>
                      </View>
                    </View>

                    <Pressable
                      style={({ pressed }) => [
                        styles.primaryButton,
                        (pressed || isBusy) && styles.primaryButtonPressed,
                      ]}
                      onPress={() => void handlePasswordSubmit()}
                      disabled={isBusy}
                    >
                      {isBusy ? (
                        <ActivityIndicator color={Colors.white} />
                      ) : (
                        <>
                          <Text style={styles.primaryButtonText}>Abrir agenda</Text>
                          <Ionicons name="book-outline" size={18} color={Colors.white} />
                        </>
                      )}
                    </Pressable>

                    {canUseBiometrics && (
                      <Pressable
                        style={({ pressed }) => [
                          styles.biometricButton,
                          pressed && styles.biometricButtonPressed,
                        ]}
                        onPress={() => void attemptBiometricUnlock()}
                        disabled={isBusy}
                      >
                        <Ionicons name="scan-outline" size={20} color={Colors.primaryLight} />
                        <Text style={styles.biometricButtonText}>Abrir con Face ID</Text>
                      </Pressable>
                    )}

                    {/* Expongo el reset desde el bloqueo únicamente en desarrollo para destrabar pruebas locales. */}
                    {__DEV__ && (
                      <Pressable
                        style={({ pressed }) => [
                          styles.devResetButton,
                          pressed && styles.devResetButtonPressed,
                        ]}
                        onPress={handleConfirmDevReset}
                        disabled={isBusy}
                      >
                        <Ionicons name="refresh-circle-outline" size={18} color="#FCA5A5" />
                        <Text style={styles.devResetButtonText}>
                          Reiniciar claves (Solo DEV)
                        </Text>
                      </Pressable>
                    )}
                  </AgendaBookFrame>
                </ScrollView>
              </KeyboardAvoidingView>
            </SafeAreaView>
          </View>
        )}

        <PrivacyOverlay visible={showPrivacyOverlay} />
      </View>
    </SecuritySessionContext.Provider>
  );
}

const styles = StyleSheet.create({
  rootFlex: {
    flex: 1,
  },
  gateOverlay: {
    backgroundColor: Colors.vaultBackground,
    zIndex: 9998,
  },
  vaultSafeArea: {
    flex: 1,
    backgroundColor: Colors.vaultBackground,
  },
  centeredVault: {
    flex: 1,
    backgroundColor: Colors.vaultBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.lg,
    justifyContent: 'center',
  },
  lockScrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xl,
    justifyContent: 'center',
  },
  bookOuter: {
    flexDirection: 'row',
    alignItems: 'stretch',
    position: 'relative',
    ...Shadows.floating,
  },
  bookSpine: {
    width: 24,
    backgroundColor: Colors.spineDark,
    borderTopLeftRadius: Radius.xl,
    borderBottomLeftRadius: Radius.xl,
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: Colors.spineMetal,
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  spineHinge: {
    width: 14,
    height: 36,
    borderRadius: Radius.sm,
    backgroundColor: Colors.vaultSurfaceElevated,
    borderWidth: 1,
    borderColor: Colors.spineMetal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spineLed: {
    width: 4,
    height: 18,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryLight,
  },
  spineGroove: {
    width: 12,
    height: 1,
    backgroundColor: Colors.vaultBorderHighlight,
  },
  bookCover: {
    flex: 1,
    backgroundColor: Colors.vaultSurface,
    borderTopRightRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  bookClasp: {
    position: 'absolute',
    right: -4,
    top: '44%',
    width: 10,
    height: 48,
    borderTopRightRadius: Radius.sm,
    borderBottomRightRadius: Radius.sm,
    backgroundColor: Colors.vaultSurfaceElevated,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  claspLed: {
    width: 3,
    height: 20,
    borderRadius: Radius.full,
    backgroundColor: Colors.gold,
  },
  coverTopStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.vaultBorder,
  },
  coverMicroBrand: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.gold,
    letterSpacing: 1.8,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.vaultBackground,
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryLight,
  },
  offlineBadgeText: {
    color: Colors.vaultTextSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.9,
  },
  coverHeader: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  agendaTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: Colors.vaultTextPrimary,
    letterSpacing: 5,
    textAlign: 'center',
  },
  usdShield: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.goldSoft,
    borderWidth: 1,
    borderColor: Colors.gold,
  },
  usdShieldText: {
    color: Colors.gold,
    fontSize: Typography.body,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  emblemOuter: {
    width: 92,
    height: 92,
    borderRadius: Radius.xl,
    backgroundColor: Colors.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.primaryLight,
    marginVertical: Spacing.xs,
    ...Shadows.glowPrimary,
  },
  emblemInner: {
    width: 70,
    height: 70,
    borderRadius: Radius.lg,
    backgroundColor: Colors.vaultBackground,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.gold,
  },
  emblemUsdText: {
    fontSize: Typography.subtitle,
    fontWeight: '900',
    color: Colors.gold,
    letterSpacing: 0.8,
  },
  subtitle: {
    fontSize: Typography.caption,
    color: Colors.vaultTextSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kicker: {
    fontSize: Typography.micro,
    fontWeight: '700',
    color: Colors.primaryLight,
    letterSpacing: 1.2,
  },
  toggleVisibilityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  toggleVisibilityText: {
    fontSize: Typography.caption,
    color: Colors.vaultTextSecondary,
    fontWeight: '600',
  },
  fieldGroup: {
    gap: Spacing.xs,
  },
  label: {
    fontSize: Typography.caption,
    fontWeight: '600',
    color: Colors.vaultTextPrimary,
  },
  helperText: {
    fontSize: Typography.micro,
    color: Colors.vaultTextSecondary,
    lineHeight: 16,
  },
  vaultInput: {
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 13,
    fontSize: Typography.body,
    color: Colors.vaultTextPrimary,
    backgroundColor: Colors.vaultBackground,
  },
  passwordInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
    borderRadius: Radius.md,
    backgroundColor: Colors.vaultBackground,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.sm,
  },
  passwordInputField: {
    flex: 1,
    paddingVertical: 13,
    fontSize: Typography.body,
    color: Colors.vaultTextPrimary,
  },
  eyeIconButton: {
    padding: Spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.vaultBorder,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  switchTextBlock: {
    flex: 1,
    gap: 2,
  },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  chip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
    alignItems: 'center',
    backgroundColor: Colors.vaultBackground,
  },
  chipSelected: {
    backgroundColor: Colors.primaryGlow,
    borderColor: Colors.primaryLight,
  },
  chipText: {
    fontSize: Typography.caption,
    fontWeight: '600',
    color: Colors.vaultTextSecondary,
  },
  chipTextSelected: {
    color: Colors.vaultTextPrimary,
    fontWeight: '700',
  },
  primaryButton: {
    flexDirection: 'row',
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: 52,
    marginTop: Spacing.xs,
    ...Shadows.glowPrimary,
  },
  primaryButtonPressed: {
    backgroundColor: Colors.primaryPressed,
  },
  primaryButtonText: {
    color: Colors.white,
    fontSize: Typography.body,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  biometricButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
    backgroundColor: Colors.vaultBackground,
    paddingVertical: 14,
    minHeight: 52,
  },
  biometricButtonPressed: {
    backgroundColor: Colors.vaultSurfaceElevated,
  },
  biometricButtonText: {
    color: Colors.vaultTextPrimary,
    fontSize: Typography.body,
    fontWeight: '600',
  },
  devResetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.dangerVaultBorder,
    backgroundColor: Colors.dangerVaultBg,
    paddingVertical: 12,
    minHeight: 46,
  },
  devResetButtonPressed: {
    opacity: 0.75,
  },
  devResetButtonText: {
    color: '#FCA5A5',
    fontSize: Typography.caption,
    fontWeight: '700',
  },
  coverFooter: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
    alignItems: 'center',
  },
  circuitLine: {
    width: '100%',
    height: 1,
    backgroundColor: Colors.vaultBorder,
  },
  coverFooterText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.vaultTextMuted,
    letterSpacing: 1.2,
  },
});