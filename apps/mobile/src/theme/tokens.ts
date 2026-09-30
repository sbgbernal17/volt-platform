/**
 * Tokens de la app Volt: el manual de marca (docs/marca/tokens.json) más las propuestas del handoff
 * de UI/UX de la app (ADR 0025): ámbar de ocupado, cifra XL, radio de hoja y tiempos de movimiento.
 * Tema oscuro; el claro existe en el manual pero la app se diseña en oscuro.
 */
import type { TextStyle } from 'react-native';

export const colors = {
  // Marca
  brand: '#EF4136', // logotipo, anillo de progreso, pestaña activa, marcador seleccionado, enlaces
  primary: '#DC2626', // botón primario y botón Cargar
  primaryPressed: '#B91C1C',
  deep: '#991B1B', // tramo medio del degradado de Cuenta
  link: '#EF4136',
  onPrimary: '#FFFFFF',
  // Superficies
  bg: '#000000',
  surface: '#171717', // tarjetas, hojas, diálogos
  field: '#262626', // campos
  line: '#262626', // divisores
  control: '#FFFFFF', // borde de campos y botón secundario
  borderSoft: '#404040', // chips y botones redondos sobre el mapa
  black: '#0B0B0B', // barra de pestañas, marcadores
  handle: '#525252', // asa de la hoja, bordes de marcador
  // Texto
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280', // cifras desactualizadas, deshabilitado
  // Estados (siempre con palabra e ícono)
  success: '#22C55E',
  successSoft: '#193123',
  info: '#3B82F6',
  infoSoft: '#1C2838',
  warning: '#F59E0B',
  warningSoft: '#33260F',
  danger: '#F87171',
  dangerSoft: '#351918',
  focus: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.62)',
  dialogScrim: 'rgba(0,0,0,0.75)',
  ringTrack: '#262626',
  ringStale: '#525252',
  map: {
    bg: '#0E0E0F',
    roads: '#2A2A2B',
    minorRoads: '#1B1B1C',
    water: '#0C1620',
    park: '#0F1711',
  },
} as const;

/** Espaciado en múltiplos de 4; `xl` es el margen lateral de formularios (30) y `list` el de listas. */
export const spacing = {
  xs: 4,
  sm: 8,
  ms: 12,
  md: 16,
  ml: 20,
  lg: 24,
  xl: 30,
  xxl: 32,
  section: 48,
  hero: 64,
  list: 20,
  float: 16,
} as const;

export const radius = { control: 6, card: 12, sheet: 20, circle: 9999 } as const;

export const size = {
  button: 52,
  touch: 48,
  iconButton: 48,
  chargeButton: 60,
  tabBar: 84,
  chip: 36,
  badge: 28,
  icon: 24,
} as const;

/** Duraciones (ms, ease-out); se anulan con "Reducir movimiento". */
export const motion = { fast: 120, base: 220, slow: 400 } as const;

/** Barlow Semi Condensed para titulares y Roboto para texto; si no cargan, la fuente del sistema. */
export const fonts = {
  title: 'BarlowSemiCondensed_700Bold',
  titleMedium: 'BarlowSemiCondensed_600SemiBold',
  titleRegular: 'BarlowSemiCondensed_500Medium',
  titleHeavy: 'BarlowSemiCondensed_800ExtraBold',
  campaign: 'BarlowSemiCondensed_800ExtraBold_Italic',
  body: 'Roboto_400Regular',
  bodyMedium: 'Roboto_500Medium',
  bodyBold: 'Roboto_700Bold',
} as const;

/** Escala tipográfica del handoff (sección 2). Las cifras en vivo llevan `tabular-nums`. */
export const text = {
  titularL: { fontFamily: fonts.campaign, fontSize: 48, lineHeight: 48 },
  datoXL: { fontFamily: fonts.title, fontSize: 72, lineHeight: 72, fontVariant: ['tabular-nums'] },
  titulo1: { fontFamily: fonts.title, fontSize: 32, lineHeight: 36 },
  titulo2: { fontFamily: fonts.title, fontSize: 24, lineHeight: 28 },
  titulo3: { fontFamily: fonts.titleMedium, fontSize: 20, lineHeight: 24 },
  dato: { fontFamily: fonts.bodyBold, fontSize: 28, lineHeight: 34, fontVariant: ['tabular-nums'] },
  cuerpoL: { fontFamily: fonts.body, fontSize: 18, lineHeight: 28 },
  cuerpo: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  cuerpoS: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  etiqueta: { fontFamily: fonts.bodyMedium, fontSize: 14, lineHeight: 20 },
  boton: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: 0.32,
    textTransform: 'uppercase',
  },
  nota: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 },
  tab: { fontFamily: fonts.bodyMedium, fontSize: 12, lineHeight: 16 },
} as const satisfies Record<string, TextStyle>;

export const headerGradient = [colors.primary, colors.deep, colors.bg] as const;

export type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'danger';

export const toneColors: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: colors.textSecondary, bg: colors.field },
  success: { fg: colors.success, bg: colors.successSoft },
  info: { fg: colors.info, bg: colors.infoSoft },
  warning: { fg: colors.warning, bg: colors.warningSoft },
  danger: { fg: colors.danger, bg: colors.dangerSoft },
};

/**
 * Cómo se ve un conector para el conductor (handoff, sección 4): disponible (verde), ocupado por
 * otra persona (ámbar), fuera de servicio (gris con borde), sin datos en vivo (borde punteado).
 * El rojo de marca nunca indica un estado.
 */
export type ConnectorVisual = 'available' | 'occupied' | 'charging' | 'out' | 'nodata' | 'fault';

export function connectorVisual(status: string | null | undefined): ConnectorVisual {
  switch (status) {
    case 'Available':
      return 'available';
    case 'Preparing':
    case 'Charging':
    case 'SuspendedEV':
    case 'SuspendedEVSE':
    case 'Finishing':
    case 'Reserved':
    case 'Occupied':
      return 'occupied';
    case 'Unavailable':
    case 'Faulted':
      return 'out';
    default:
      return 'nodata';
  }
}

/** Tono de insignia para un estado OCPP (compatibilidad con las pantallas anteriores). */
export function connectorTone(status: string | null | undefined): Tone {
  switch (connectorVisual(status)) {
    case 'available':
      return 'success';
    case 'occupied':
      return 'warning';
    case 'charging':
      return 'info';
    case 'fault':
      return 'danger';
    default:
      return 'neutral';
  }
}
