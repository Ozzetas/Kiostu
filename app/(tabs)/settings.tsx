import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
import { AppError } from '../../src/core/errors/AppError';
import { Logger } from '../../src/core/logging/Logger';
import { DEFAULT_SESSION_TIMEOUT_MS, SecuritySnapshot } from '../../src/domain/entities/security';
import { AgendaPaperBackground } from '../../src/presentation/components/AgendaPaperBackground';
import { ErrorBanner } from '../../src/presentation/components/ErrorBanner';
import { useSecuritySession } from '../../src/presentation/components/SecurityGate';
import { useAppServices } from '../../src/presentation/di/AppServicesProvider';
import { Colors, Radius, Shadows, Spacing, Typography } from '../../src/presentation/theme/tokens';

const logger = new Logger('SettingsScreen');

const TIMEOUT_OPTIONS: readonly { readonly label: string; readonly ms: number }[] = [
  { label: '5 min', ms: DEFAULT_SESSION_TIMEOUT_MS },
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '1 hora', ms: 60 * 60 * 1000 },
];

export default function SettingsScreen() {
  const { services, isReady } = useAppServices();
  const { isUnlocked, lockNow, resetVaultForDev } = useSecuritySession();

  const [snapshot, setSnapshot] = useState<SecuritySnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isUpdatingPolicy, setIsUpdatingPolicy] = useState(false);

  // Estado para crear / actualizar clave de pánico con verificación de clave principal
  const [currentPrimaryForPanic, setCurrentPrimaryForPanic] = useState('');
  const [panicPasswordInput, setPanicPasswordInput] = useState('');
  const [isSavingPanic, setIsSavingPanic] = useState(false);

  // Modal de confirmación con contraseña principal para desactivar clave de pánico
  const [disableModalVisible, setDisableModalVisible] = useState(false);
  const [primaryForDisable, setPrimaryForDisable] = useState('');
  const [disableModalError, setDisableModalError] = useState<string | null>(null);
  const [isDisablingPanic, setIsDisablingPanic] = useState(false);

  const loadSnapshot = useCallback(async (): Promise<void> => {
    if (!isReady || !isUnlocked) {
      return;
    }
    try {
      const current = await services.securityRepository.getSnapshot();
      setSnapshot(current);
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al cargar configuración de seguridad en Ajustes', normalized);
      setErrorMessage(
        error instanceof AppError ? error.message : 'No se pudo leer la configuración de seguridad.'
      );
    }
  }, [services, isReady, isUnlocked]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const handleUpdatePolicy = async (nextBiometric: boolean, nextTimeoutMs: number): Promise<void> => {
    if (isUpdatingPolicy) {
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);
    setIsUpdatingPolicy(true);

    try {
      await services.configureSecurityUseCase.updatePolicy({
        biometricEnabled: nextBiometric,
        sessionTimeoutMs: nextTimeoutMs,
      });
      await loadSnapshot();
      setStatusMessage('Política de seguridad actualizada.');
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al actualizar política de seguridad', normalized);
      setErrorMessage(
        error instanceof AppError ? error.message : 'No se pudo actualizar la política.'
      );
    } finally {
      setIsUpdatingPolicy(false);
    }
  };

  const handleSavePanicPassword = async (): Promise<void> => {
    if (isSavingPanic) {
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);

    if (panicPasswordInput.length === 0) {
      setErrorMessage('Ingresá la nueva clave de borrado rápido que querés configurar.');
      return;
    }

    setIsSavingPanic(true);

    try {
      await services.configureSecurityUseCase.updatePanicPassword(
        currentPrimaryForPanic,
        panicPasswordInput
      );
      setCurrentPrimaryForPanic('');
      setPanicPasswordInput('');
      await loadSnapshot();
      setStatusMessage('Clave de restablecimiento rápido actualizada.');
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al actualizar clave de pánico', normalized);
      setErrorMessage(
        error instanceof AppError ? error.message : 'No se pudo guardar la clave de emergencia.'
      );
    } finally {
      setIsSavingPanic(false);
    }
  };

  const handleOpenDisablePanicModal = (): void => {
    setPrimaryForDisable('');
    setDisableModalError(null);
    setDisableModalVisible(true);
  };

  const handleConfirmDisablePanic = async (): Promise<void> => {
    if (isDisablingPanic) {
      return;
    }

    setDisableModalError(null);
    setIsDisablingPanic(true);

    try {
      await services.configureSecurityUseCase.updatePanicPassword(primaryForDisable, null);
      setPrimaryForDisable('');
      setDisableModalVisible(false);
      await loadSnapshot();
      setStatusMessage('Clave de restablecimiento rápido desactivada.');
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al desactivar clave de pánico', normalized);
      setDisableModalError(
        error instanceof AppError ? error.message : 'No se pudo desactivar la clave secundaria.'
      );
    } finally {
      setIsDisablingPanic(false);
    }
  };

  const handleConfirmDevReset = (): void => {
    Alert.alert(
      'Reiniciar Agenda (Desarrollo)',
      'Se eliminarán las credenciales guardadas en el Keychain para volver a mostrar la tapa inicial de configuración.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Reiniciar',
          style: 'destructive',
          onPress: () => {
            void resetVaultForDev().catch((error: unknown) => {
              const normalized = error instanceof Error ? error : new Error(String(error));
              logger.error('Fallo al reiniciar la bóveda de desarrollo', normalized);
            });
          },
        },
      ]
    );
  };

  return (
    <AgendaPaperBackground>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View>
            <Text style={styles.kicker}>SEGURIDAD · 100% OFFLINE</Text>
            <Text style={styles.title}>Ajustes</Text>
          </View>

          <ErrorBanner message={errorMessage} />

          {statusMessage !== null && (
            <View style={styles.successBanner}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
              <Text style={styles.successText}>{statusMessage}</Text>
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.sectionLabel}>SESIÓN ACTIVA</Text>
            <Pressable
              style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
              onPress={lockNow}
            >
              <View style={styles.actionIconBox}>
                <Ionicons name="lock-closed" size={18} color={Colors.primary} />
              </View>
              <View style={styles.actionTextBlock}>
                <Text style={styles.actionTitle}>Cerrar agenda ahora</Text>
                <Text style={styles.actionSubtitle}>Exige tu clave principal al instante</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </Pressable>
          </View>

          {snapshot !== null && (
            <>
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>POLÍTICA DE ACCESO</Text>

                <View style={styles.switchRow}>
                  <View style={styles.actionTextBlock}>
                    <Text style={styles.actionTitle}>Apertura rápida con Face ID</Text>
                    <Text style={styles.actionSubtitle}>
                      Activo dentro de la ventana de inactividad
                    </Text>
                  </View>
                  <Switch
                    value={snapshot.policy.biometricEnabled}
                    disabled={isUpdatingPolicy}
                    onValueChange={(nextVal) =>
                      void handleUpdatePolicy(nextVal, snapshot.policy.sessionTimeoutMs)
                    }
                    trackColor={{ false: Colors.border, true: Colors.primary }}
                    thumbColor={Colors.white}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.actionTitle}>Pedir clave principal tras inactividad</Text>
                  <View style={styles.chipRow}>
                    {TIMEOUT_OPTIONS.map((option) => {
                      const selected = snapshot.policy.sessionTimeoutMs === option.ms;
                      return (
                        <Pressable
                          key={option.ms}
                          style={[styles.chip, selected && styles.chipSelected]}
                          disabled={isUpdatingPolicy}
                          onPress={() =>
                            void handleUpdatePolicy(snapshot.policy.biometricEnabled, option.ms)
                          }
                        >
                          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </View>

              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.sectionLabel}>PROTOCOLO DE PRIVACIDAD</Text>
                  <View
                    style={[
                      styles.statusChip,
                      snapshot.hasPanicPassword ? styles.statusChipOn : styles.statusChipOff,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusChipText,
                        snapshot.hasPanicPassword
                          ? styles.statusChipTextOn
                          : styles.statusChipTextOff,
                      ]}
                    >
                      {snapshot.hasPanicPassword ? 'ACTIVA' : 'INACTIVA'}
                    </Text>
                  </View>
                </View>

                <Text style={styles.actionSubtitle}>
                  Para definir, cambiar o desactivar la clave de borrado rápido debés confirmar tu
                  contraseña principal actual.
                </Text>

                <View style={styles.fieldGroup}>
                  <Text style={styles.inputLabel}>Contraseña principal actual *</Text>
                  <TextInput
                    style={styles.panicInput}
                    value={currentPrimaryForPanic}
                    onChangeText={setCurrentPrimaryForPanic}
                    placeholder="Ingresá tu clave maestra actual"
                    placeholderTextColor={Colors.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.inputLabel}>
                    {snapshot.hasPanicPassword
                      ? 'Nueva clave de borrado rápido *'
                      : 'Clave de borrado rápido *'}
                  </Text>
                  <View style={styles.panicRow}>
                    <TextInput
                      style={styles.panicInputFlex}
                      value={panicPasswordInput}
                      onChangeText={setPanicPasswordInput}
                      placeholder="Mínimo 4 caracteres (distinta a la principal)"
                      placeholderTextColor={Colors.textMuted}
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Pressable
                      style={styles.panicSaveBtn}
                      onPress={() => void handleSavePanicPassword()}
                      disabled={isSavingPanic}
                    >
                      {isSavingPanic ? (
                        <ActivityIndicator color={Colors.white} size="small" />
                      ) : (
                        <Text style={styles.panicSaveText}>Guardar</Text>
                      )}
                    </Pressable>
                  </View>
                </View>

                {snapshot.hasPanicPassword && (
                  <Pressable
                    style={styles.removePanicBtn}
                    onPress={handleOpenDisablePanicModal}
                  >
                    <Ionicons name="shield-outline" size={16} color={Colors.danger} />
                    <Text style={styles.removePanicText}>Desactivar clave secundaria</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}

          {__DEV__ && (
            <View style={[styles.card, styles.devCard]}>
              <Text style={styles.devLabel}>HERRAMIENTA DE DESARROLLO</Text>
              <Pressable
                style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
                onPress={handleConfirmDevReset}
              >
                <View style={styles.devIconBox}>
                  <Ionicons name="refresh-circle" size={20} color={Colors.danger} />
                </View>
                <View style={styles.actionTextBlock}>
                  <Text style={styles.actionTitle}>Reiniciar configuración inicial</Text>
                  <Text style={styles.actionSubtitle}>
                    Limpia el Keychain para probar el alta de claves desde cero
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.danger} />
              </Pressable>
            </View>
          )}
        </ScrollView>

        {/* Modal de verificación de clave principal antes de quitar la clave de pánico */}
        <Modal
          visible={disableModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setDisableModalVisible(false)}
        >
          <KeyboardAvoidingView
            style={styles.modalBackdrop}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Confirmar identidad</Text>
              <Text style={styles.actionSubtitle}>
                Ingresá tu contraseña principal actual para desactivar la clave de borrado rápido.
              </Text>
              <ErrorBanner message={disableModalError} />
              <TextInput
                style={styles.panicInput}
                value={primaryForDisable}
                onChangeText={setPrimaryForDisable}
                placeholder="Contraseña principal actual"
                placeholderTextColor={Colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
              <View style={styles.modalActions}>
                <Pressable
                  style={styles.modalCancelBtn}
                  onPress={() => setDisableModalVisible(false)}
                  disabled={isDisablingPanic}
                >
                  <Text style={styles.modalCancelText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  style={styles.modalDangerBtn}
                  onPress={() => void handleConfirmDisablePanic()}
                  disabled={isDisablingPanic}
                >
                  {isDisablingPanic ? (
                    <ActivityIndicator color={Colors.white} size="small" />
                  ) : (
                    <Text style={styles.panicSaveText}>Desactivar</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </AgendaPaperBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  container: {
    padding: Spacing.lg,
    gap: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  kicker: {
    fontSize: Typography.micro,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 1.2,
  },
  title: {
    fontSize: Typography.hero,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.6,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.successSoft,
    borderColor: Colors.success,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  successText: {
    flex: 1,
    color: Colors.success,
    fontSize: Typography.caption,
    fontWeight: '700',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  devCard: {
    borderColor: Colors.dangerSoft,
  },
  sectionLabel: {
    fontSize: Typography.micro,
    fontWeight: '800',
    color: Colors.textSecondary,
    letterSpacing: 1,
  },
  devLabel: {
    fontSize: Typography.micro,
    fontWeight: '800',
    color: Colors.danger,
    letterSpacing: 1,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  statusChipOn: {
    backgroundColor: Colors.successSoft,
  },
  statusChipOff: {
    backgroundColor: Colors.surfaceElevated,
  },
  statusChipText: {
    fontSize: 10,
    fontWeight: '800',
  },
  statusChipTextOn: {
    color: Colors.success,
  },
  statusChipTextOff: {
    color: Colors.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
  },
  actionRowPressed: {
    opacity: 0.7,
  },
  actionIconBox: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  devIconBox: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTextBlock: {
    flex: 1,
    gap: 2,
  },
  actionTitle: {
    fontSize: Typography.body,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  actionSubtitle: {
    fontSize: Typography.caption,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  fieldGroup: {
    gap: Spacing.xs,
  },
  inputLabel: {
    fontSize: Typography.caption,
    fontWeight: '600',
    color: Colors.textPrimary,
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
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  chipSelected: {
    backgroundColor: Colors.textPrimary,
    borderColor: Colors.textPrimary,
  },
  chipText: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  chipTextSelected: {
    color: Colors.white,
  },
  panicRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  panicInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
  },
  panicInputFlex: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
  },
  panicSaveBtn: {
    backgroundColor: Colors.textPrimary,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 88,
  },
  panicSaveText: {
    color: Colors.white,
    fontSize: Typography.caption,
    fontWeight: '700',
  },
  removePanicBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: 11,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.dangerSoft,
    backgroundColor: Colors.dangerSoft,
  },
  removePanicText: {
    color: Colors.danger,
    fontSize: Typography.caption,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 11, 10, 0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  modalCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadows.floating,
  },
  modalTitle: {
    fontSize: Typography.subtitle,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
  modalCancelBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
  },
  modalCancelText: {
    fontSize: Typography.body,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  modalDangerBtn: {
    backgroundColor: Colors.danger,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    borderRadius: Radius.md,
    minWidth: 108,
    alignItems: 'center',
  },
});