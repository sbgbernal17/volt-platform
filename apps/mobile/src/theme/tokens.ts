/** Tokens del manual de marca VOLT (docs/marca/tokens.json) en su tema oscuro, el de la app. */
export const colors = {
  bg: '#000000',
  surface: '#171717',
  field: '#262626',
  line: '#262626',
  control: '#FFFFFF',
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  brand: '#EF4136',
  primary: '#DC2626',
  primaryPressed: '#B91C1C',
  deep: '#991B1B',
  link: '#EF4136',
  danger: '#F87171',
  dangerSoft: '#351918',
  success: '#22C55E',
  successSoft: '#193123',
  info: '#3B82F6',
  infoSoft: '#1C2838',
  warning: '#F59E0B',
  warningSoft: '#3B2A0A',
  black: '#0B0B0B',
  onPrimary: '#FFFFFF',
} as const;

export const radius = { control: 6, card: 12 } as const;
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 30 } as const;

/** Barlow Semi Condensed para títulos y Roboto para texto; si no cargan, la fuente del sistema. */
export const fonts = {
  title: 'BarlowSemiCondensed_700Bold',
  titleMedium: 'BarlowSemiCondensed_600SemiBold',
  campaign: 'BarlowSemiCondensed_800ExtraBold_Italic',
  body: 'Roboto_400Regular',
  bodyMedium: 'Roboto_500Medium',
} as const;

export const headerGradient = [colors.primary, colors.deep, colors.bg] as const;

export type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'danger';

export const toneColors: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: colors.textSecondary, bg: colors.field },
  success: { fg: colors.success, bg: colors.successSoft },
  info: { fg: colors.info, bg: colors.infoSoft },
  warning: { fg: colors.warning, bg: colors.warningSoft },
  danger: { fg: colors.danger, bg: colors.dangerSoft },
};

/** Tono visual del estado OCPP de un conector (siempre acompañado de la palabra, nunca solo color). */
export function connectorTone(status: string | null | undefined): Tone {
  switch (status) {
    case 'Available':
      return 'success';
    case 'Preparing':
    case 'Charging':
    case 'SuspendedEV':
    case 'SuspendedEVSE':
    case 'Finishing':
    case 'Reserved':
      return 'info';
    case 'Unavailable':
    case 'Faulted':
      return 'danger';
    default:
      return 'neutral';
  }
}
