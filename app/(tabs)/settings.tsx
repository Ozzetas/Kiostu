import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Logger } from '../../src/core/logging/Logger';
import { useSecuritySession } from '../../src/presentation/components/SecurityGate';
import { Colors, Radius, Shadows, Spacing, Typography } from '../../src/presentation/theme/tokens';

const logger = new Logger('SettingsScreen');

export default function SettingsScreen() {
  const { lockNow, resetVaultForDev } = useSecuritySession();

  const handleConfirmDevReset = (): void => {
    Alert.alert(
      'Reiniciar Bóveda (Desarrollo)',
      'Se eliminarán las credenciales guardadas en el Keychain para volver a mostrar la pantalla inicial "Blindá tu Kiosco". Tus productos de SQLite no se borran.',
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
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View>
          <Text style={styles.kicker}>SEGURIDAD Y SISTEMA</Text>
          <Text style={styles.title}>Ajustes</Text>
        </View>

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
              <Text style={styles.actionTitle}>Bloquear Kiosco ahora</Text>
              <Text style={styles.actionSubtitle}>Exige tu clave o Face ID al instante</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </Pressable>
        </View>

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
                <Text style={styles.actionTitle}>Volver a "Blindá tu Kiosco"</Text>
                <Text style={styles.actionSubtitle}>
                  Limpia el Keychain para probar el alta de claves desde cero
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.danger} />
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    padding: Spacing.lg,
    gap: Spacing.lg,
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
    backgroundColor: Colors.surface,
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
  },
});