import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../theme/tokens';

interface ErrorBannerProps {
  readonly message: string | null;
  readonly variant?: 'light' | 'dark';
}

export function ErrorBanner({ message, variant = 'light' }: ErrorBannerProps) {
  if (message === null || message.trim().length === 0) {
    return null;
  }

  const isDark = variant === 'dark';

  return (
    <View
      style={[styles.container, isDark ? styles.containerDark : styles.containerLight]}
      accessibilityRole="alert"
    >
      <Ionicons name="alert-circle" size={18} color={Colors.danger} />
      <Text style={[styles.text, isDark ? styles.textDark : styles.textLight]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  containerLight: {
    backgroundColor: Colors.dangerSoft,
    borderColor: Colors.danger,
  },
  containerDark: {
    backgroundColor: Colors.dangerVaultBg,
    borderColor: Colors.dangerVaultBorder,
  },
  text: {
    flex: 1,
    fontSize: Typography.caption,
    fontWeight: '600',
    lineHeight: 18,
  },
  textLight: {
    color: Colors.danger,
  },
  textDark: {
    color: '#FCA5A5',
  },
});