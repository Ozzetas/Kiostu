import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../../src/presentation/theme/tokens';

export default function CustomersScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        <Text style={styles.kicker}>CUENTAS CORRIENTES</Text>
        <Text style={styles.title}>Fiados</Text>

        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Ionicons name="people-outline" size={28} color={Colors.primary} />
          </View>
          <Text style={styles.cardTitle}>Módulo de Clientes y Pagos</Text>
          <Text style={styles.cardSubtitle}>
            La agenda de deudores, detalle de productos con precio congelado y pagos parciales se
            conecta en la Fase 5B.2.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    padding: Spacing.lg,
    gap: Spacing.md,
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
    marginTop: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: Radius.full,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: Typography.subtitle,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  cardSubtitle: {
    fontSize: Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});