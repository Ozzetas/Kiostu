import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Shadows, Spacing, Typography } from '../theme/tokens';

interface PrivacyOverlayProps {
  readonly visible: boolean;
}

export function PrivacyOverlay({ visible }: PrivacyOverlayProps) {
  if (!visible) {
    return null;
  }

  // Uso StyleSheet.absoluteFill en el array de estilos por compatibilidad estricta con RN 0.88+.
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="auto">
      <View style={styles.emblemOuter}>
        <View style={styles.emblemInner}>
          <Text style={styles.currencyMark}>USD$</Text>
        </View>
      </View>
      <Text style={styles.brand}>AGENDA</Text>
      <View style={styles.pill}>
        <Ionicons name="lock-closed" size={12} color={Colors.primaryLight} />
        <Text style={styles.pillText}>AGENDA CERRADA · 100% LOCAL</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: Colors.overlayDark,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    zIndex: 9999,
  },
  emblemOuter: {
    width: 96,
    height: 96,
    borderRadius: Radius.xl,
    backgroundColor: Colors.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.primaryLight,
    ...Shadows.glowPrimary,
  },
  emblemInner: {
    width: 72,
    height: 72,
    borderRadius: Radius.lg,
    backgroundColor: Colors.vaultSurface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.gold,
  },
  currencyMark: {
    color: Colors.gold,
    fontSize: Typography.subtitle,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  brand: {
    color: Colors.vaultTextPrimary,
    fontSize: Typography.title,
    fontWeight: '800',
    letterSpacing: 5,
    marginTop: Spacing.xs,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.vaultSurface,
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  pillText: {
    color: Colors.vaultTextSecondary,
    fontSize: Typography.micro,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
});