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
      return 'Expiró la ventana de sesión. Ingresá tu contraseña principal.';
    case 'BIOMETRIC_CANCELLED':
      return 'Usá tu contraseña para continuar.';
    case 'BIOMETRIC_UNAVAILABLE':
      return 'Face ID no disponible en este momento. Ingresá tu contraseña.';
    case 'BIOMETRIC_FAILED':
      return 'No se pudo reconocer tu rostro. Reintentá o ingresá tu contraseña.';
    case 'NOT_CONFIGURED':
      return 'Debés configurar una contraseña principal primero.';
  }
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
      setErrorMessage('Error al verificar biometría. Ingresá tu contraseña.');
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
      'Reiniciar Bóveda (DEV)',
      'Se eliminarán las contraseñas del Keychain para volver a configurar "Blindá tu Kiosco". Los datos de SQLite se conservan.',
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
                  <View style={styles.headerBlock}>
                    <View style={styles.badgePill}>
                      <View style={styles.liveDot} />
                      <Text style={styles.badgeText}>100% LOCAL · SIN NUBE</Text>
                    </View>
                    <Text style={styles.heroTitle}>Blindá tu Kiosco</Text>
                    <Text style={styles.subtitle}>
                      Creá tu clave maestra local. Tu inventario y cuentas quedan cifrados en este
                      iPhone.
                    </Text>
                  </View>

                  <View style={styles.vaultCard}>
                    <ErrorBanner message={errorMessage} variant="dark" />

                    <View style={styles.sectionHeaderRow}>
                      <Text style={styles.kicker}>ACCESO PRINCIPAL</Text>
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
                      <Text style={styles.label}>Clave de restablecimiento rápido (opcional)</Text>
                      <Text style={styles.helperText}>
                        Debe ser distinta a la principal. Al ingresarla, limpia todos los registros
                        en el acto sin alertas.
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
                        <Text style={styles.label}>Desbloqueo ágil con Face ID</Text>
                        <Text style={styles.helperText}>
                          Disponible dentro de tu ventana de sesión
                        </Text>
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
                      <Text style={styles.label}>Exigir clave maestra tras inactividad</Text>
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
                          <Text style={styles.primaryButtonText}>Activar Bóveda</Text>
                          <Ionicons name="arrow-forward" size={18} color={Colors.white} />
                        </>
                      )}
                    </Pressable>
                  </View>
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
                  <View style={styles.headerBlock}>
                    <View style={styles.emblemOuter}>
                      <View style={styles.emblemInner}>
                        <Ionicons
                          name={canUseBiometrics ? 'scan-outline' : 'lock-closed'}
                          size={30}
                          color={Colors.primaryLight}
                        />
                      </View>
                    </View>
                    <Text style={styles.heroTitle}>Kiosco</Text>
                    <Text style={styles.subtitle}>
                      {canUseBiometrics
                        ? 'Verificá tu identidad con Face ID o ingresá tu clave.'
                        : 'Sesión bloqueada. Ingresá tu clave principal para continuar.'}
                    </Text>
                  </View>

                  <View style={styles.vaultCard}>
                    <ErrorBanner message={errorMessage} variant="dark" />

                    <View style={styles.fieldGroup}>
                      <Text style={styles.kicker}>CREDENCIAL DE ACCESO</Text>
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
                          <Text style={styles.primaryButtonText}>Desbloquear</Text>
                          <Ionicons name="lock-open-outline" size={18} color={Colors.white} />
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
                        <Text style={styles.biometricButtonText}>Desbloquear con Face ID</Text>
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
                          Reiniciar bóveda (Solo DEV)
                        </Text>
                      </Pressable>
                    )}
                  </View>
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
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl,
    justifyContent: 'center',
    gap: Spacing.xl,
  },
  lockScrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl,
    justifyContent: 'center',
    gap: Spacing.xl,
  },
  headerBlock: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.vaultSurface,
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    marginBottom: Spacing.xs,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: Radius.full,
    backgroundColor: Colors.success,
  },
  badgeText: {
    color: Colors.vaultTextSecondary,
    fontSize: Typography.micro,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  emblemOuter: {
    width: 80,
    height: 80,
    borderRadius: Radius.xl,
    backgroundColor: Colors.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.35)',
    marginBottom: Spacing.xs,
    ...Shadows.glowPrimary,
  },
  emblemInner: {
    width: 58,
    height: 58,
    borderRadius: Radius.lg,
    backgroundColor: Colors.vaultSurface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
  },
  heroTitle: {
    fontSize: Typography.hero,
    fontWeight: '800',
    color: Colors.vaultTextPrimary,
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: Typography.body,
    color: Colors.vaultTextSecondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
  vaultCard: {
    backgroundColor: Colors.vaultSurface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.vaultBorder,
    ...Shadows.floating,
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
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
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
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.sm,
  },
  passwordInputField: {
    flex: 1,
    paddingVertical: 14,
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
});