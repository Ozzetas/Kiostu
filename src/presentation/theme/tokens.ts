import { ViewStyle } from 'react-native';

export const Colors = {
  // Superficies de hoja de agenda (interior luminoso con renglones)
  background: '#FAF8F2',
  paperBackground: '#FAF8F2',
  paperLine: '#DCE4EE',
  paperMarginLine: '#EBB9B9',
  surface: '#FFFFFF',
  surfaceElevated: '#F1EFE7',
  border: '#DDD8CB',
  borderSubtle: '#ECE8DD',

  // Superficies de tapa cerrada (Agenda Futurista Carbono + LED Esmeralda + Oro)
  vaultBackground: '#070B0A',
  vaultSurface: '#101715',
  vaultSurfaceElevated: '#1A2421',
  vaultBorder: '#1E2D28',
  vaultBorderHighlight: '#2C423B',
  vaultTextPrimary: '#F8FAFC',
  vaultTextSecondary: '#9FB3AC',
  vaultTextMuted: '#637871',
  spineDark: '#0C1210',
  spineMetal: '#33453F',

  // Tipografía operativa (tinta oscura sobre papel)
  textPrimary: '#111816',
  textSecondary: '#4B5954',
  textMuted: '#899691',

  // Acentos de marca: Esmeralda Ledger + Dorado USD$
  primary: '#059669',
  primaryLight: '#10B981',
  primaryPressed: '#047857',
  primarySoft: '#ECFDF5',
  primaryGlow: 'rgba(16, 185, 129, 0.18)',
  gold: '#D4AF37',
  goldSoft: 'rgba(212, 175, 55, 0.16)',

  // Estados semánticos
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  dangerVaultBg: 'rgba(239, 68, 68, 0.14)',
  dangerVaultBorder: 'rgba(239, 68, 68, 0.45)',
  success: '#059669',
  successSoft: '#ECFDF5',
  warning: '#D97706',
  warningSoft: '#FFFBEB',

  overlayDark: '#070B0A',
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
    shadowColor: '#070B0A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  floating: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 10,
  },
  glowPrimary: {
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.34,
    shadowRadius: 16,
    elevation: 6,
  },
};