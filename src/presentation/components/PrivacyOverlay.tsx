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

  return (
    // Uso StyleSheet.absoluteFill en el array de estilos por compatibilidad estricta con RN 0.88+.
    <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="auto">
      <View style={styles.emblemOuter}>
        <View style={styles.emblemInner}>
          <Ionicons name="shield-half" size={34} color={Colors.primaryLight} />
        </View>
      </View>
      <Text style={styles.brand}>KIOSCO</Text>
      <View style={styles.pill}>
        <Ionicons name="lock-closed" size={12} color={Colors.vaultTextSecondary} />
        <Text style={styles.pillText}>SESIÓN PROTEGIDA</Text>
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
    width: 88,
    height: 88,
    borderRadius: Radius.xl,
    backgroundColor: Colors.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.35)',
    ...Shadows.glowPrimary,
  },
  emblemInner: {
    width: 64,
    height: 64,
    borderRadius: Radius.lg,
    backgroundColor: Colors.vaultSurface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
  },
  brand: {
    color: Colors.vaultTextPrimary,
    fontSize: Typography.title,
    fontWeight: '800',
    letterSpacing: 4,
    marginTop: Spacing.xs,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.vaultSurface,
    borderWidth: 1,
    borderColor: Colors.vaultBorder,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  pillText: {
    color: Colors.vaultTextSecondary,
    fontSize: Typography.micro,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
});