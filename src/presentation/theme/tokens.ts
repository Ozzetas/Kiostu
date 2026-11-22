import { ViewStyle } from 'react-native';

export const Colors = {
  // Superficies modo operativo (POS luminoso)
  background: '#F4F5F7',
  surface: '#FFFFFF',
  surfaceElevated: '#EEF0F4',
  border: '#E4E4E7',
  borderSubtle: '#F1F5F9',

  // Superficies modo bóveda (Seguridad / Lock Screen / Privacy Overlay)
  vaultBackground: '#09090B',
  vaultSurface: '#18181B',
  vaultSurfaceElevated: '#27272A',
  vaultBorder: '#27272A',
  vaultBorderHighlight: '#3F3F46',
  vaultTextPrimary: '#FAFAFA',
  vaultTextSecondary: '#A1A1AA',
  vaultTextMuted: '#71717A',

  // Tipografía operativa
  textPrimary: '#09090B',
  textSecondary: '#52525B',
  textMuted: '#A1A1AA',

  // Acentos de marca 2026 (Índigo Eléctrico + Esmeralda)
  primary: '#4F46E5',
  primaryLight: '#6366F1',
  primaryPressed: '#4338CA',
  primarySoft: '#EEF2FF',
  primaryGlow: 'rgba(99, 102, 241, 0.16)',

  // Estados semánticos
  danger: '#EF4444',
  dangerSoft: '#FEF2F2',
  dangerVaultBg: 'rgba(239, 68, 68, 0.14)',
  dangerVaultBorder: 'rgba(239, 68, 68, 0.45)',
  success: '#10B981',
  successSoft: '#ECFDF5',
  warning: '#F59E0B',
  warningSoft: '#FFFBEB',

  overlayDark: '#09090B',
  white: '#FFFFFF',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 24,
  full: 9999,
} as const;

export const Typography = {
  hero: 28,
  title: 24,
  subtitle: 18,
  body: 15,
  caption: 13,
  micro: 11,
} as const;

export const Shadows: Record<'card' | 'floating' | 'glowPrimary', ViewStyle> = {
  card: {
    shadowColor: '#09090B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  floating: {
    shadowColor: '#09090B',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
  },
  glowPrimary: {
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
};