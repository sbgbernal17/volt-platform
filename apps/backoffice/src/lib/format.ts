/** Formato de importes, energía, fechas y duraciones para las pantallas (es/en). */
export type Locale = 'es' | 'en';

const LOCALE_TAG: Record<Locale, string> = { es: 'es-CO', en: 'en-US' };

/** Importe en unidad mínima (texto o número) con la moneda; COP no tiene decimales. */
export function money(
  minor: string | number | bigint | null | undefined,
  currency = 'COP',
  locale: Locale = 'es',
): string {
  if (minor === null || minor === undefined || minor === '') return '—';
  const exponent = currency === 'COP' ? 0 : 2;
  const value = Number(minor) / 10 ** exponent;
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    style: 'currency',
    currency,
    maximumFractionDigits: exponent,
    minimumFractionDigits: exponent,
  }).format(value);
}

/** Importe en unidades mayores como texto decimal (`"1350"`, `"0.45"`), como llega en las tarifas. */
export function moneyMajor(
  value: string | null | undefined,
  currency = 'COP',
  locale: Locale = 'es',
): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const exponent = currency === 'COP' ? 0 : 2;
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    style: 'currency',
    currency,
    maximumFractionDigits: Math.max(exponent, value.includes('.') ? 2 : 0),
    minimumFractionDigits: exponent,
  }).format(number);
}

export function energyKwh(
  wh: string | number | bigint | null | undefined,
  locale: Locale = 'es',
): string {
  if (wh === null || wh === undefined) return '—';
  return `${new Intl.NumberFormat(LOCALE_TAG[locale], { maximumFractionDigits: 2 }).format(Number(wh) / 1000)} kWh`;
}

export function powerKw(w: number | null | undefined, locale: Locale = 'es'): string {
  if (w === null || w === undefined) return '—';
  return `${new Intl.NumberFormat(LOCALE_TAG[locale], { maximumFractionDigits: 1 }).format(w / 1000)} kW`;
}

/** Nombre comercial del estándar de conector (OCPI `ConnectorType`) tal como lo conoce el conductor. */
const STANDARD_LABELS: Record<string, string> = {
  IEC_62196_T2_COMBO: 'CCS2',
  IEC_62196_T1_COMBO: 'CCS1',
  CHADEMO: 'CHAdeMO',
  GBT_DC: 'GB/T',
  GBT_AC: 'GB/T AC',
  IEC_62196_T2: 'Tipo 2',
  IEC_62196_T1: 'Tipo 1',
  TESLA_S: 'Tesla',
  DOMESTIC_B: 'Toma doméstica',
};

export function connectorStandard(
  standard: string | null | undefined,
  locale: Locale = 'es',
): string {
  if (!standard) return '—';
  const label = STANDARD_LABELS[standard] ?? standard.replace(/_/g, ' ');
  return locale === 'en'
    ? label.replace('Tipo', 'Type').replace('Toma doméstica', 'Domestic')
    : label;
}

export function powerTypeLabel(type: string | null | undefined, locale: Locale = 'es'): string {
  switch (type) {
    case 'DC':
      return 'DC';
    case 'AC_3_PHASE':
      return locale === 'en' ? 'AC three-phase' : 'AC trifásica';
    case 'AC_1_PHASE':
      return locale === 'en' ? 'AC single-phase' : 'AC monofásica';
    default:
      return type ? type.replace(/_/g, ' ') : '—';
  }
}

export interface ConnectorLike {
  standard: string;
  power_type?: string | null | undefined;
  max_power_w: number | null;
  /** Potencia del gabinete (W) y reparto, cuando la fila los trae (listas de cargadores). */
  charger_max_power_w?: number | null | undefined;
  power_shared?: boolean | undefined;
}

/** Misma regla que `isPowerShared` en @volt/csms (ADR 0026). */
export function isPowerShared(
  cabinetMaxW: number | null | undefined,
  connectorsMaxW: readonly (number | null | undefined)[],
): boolean {
  if (cabinetMaxW === null || cabinetMaxW === undefined || connectorsMaxW.length < 2) return false;
  const demand = connectorsMaxW.reduce<number>((sum, w) => sum + (w ?? cabinetMaxW), 0);
  return cabinetMaxW < demand;
}

/** Potencia del gabinete en palabras: `hasta 180 kW · compartida entre conectores` o `180 kW`. */
export function powerSummary(
  cabinetMaxW: number | null | undefined,
  connectors: readonly ConnectorLike[] | null | undefined,
  locale: Locale = 'es',
): string {
  if (!cabinetMaxW) return '—';
  const shared =
    connectors?.some((c) => c.power_shared === true) ||
    isPowerShared(
      cabinetMaxW,
      (connectors ?? []).map((c) => c.max_power_w),
    );
  const kw = powerKw(cabinetMaxW, locale);
  if (!shared) return kw;
  return locale === 'en'
    ? `up to ${kw} · shared between connectors`
    : `hasta ${kw} · compartida entre conectores`;
}

/**
 * Resumen de los conectores de un cargador: `2 × CCS2 · hasta 180 kW · compartida entre conectores`
 * cuando se conoce el gabinete; si no, `2 × CCS2 · 180 kW` con la potencia mayor por conector.
 */
export function connectorSummary(
  connectors: readonly ConnectorLike[] | null | undefined,
  locale: Locale = 'es',
): string {
  if (!connectors || connectors.length === 0) return '—';
  const counts = new Map<string, number>();
  for (const connector of connectors) {
    const label = connectorStandard(connector.standard, locale);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([label, n]) => (n > 1 ? `${n} × ${label}` : label));
  const cabinet = connectors.find((c) => c.charger_max_power_w != null)?.charger_max_power_w;
  if (cabinet) return `${parts.join(' + ')} · ${powerSummary(cabinet, connectors, locale)}`;
  const maxW = Math.max(...connectors.map((c) => c.max_power_w ?? 0));
  return `${parts.join(' + ')}${maxW > 0 ? ` · ${powerKw(maxW, locale)}` : ''}`;
}

export function dateTime(value: string | Date | null | undefined, locale: Locale = 'es'): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Bogota',
  }).format(date);
}

export function relativeTime(
  value: string | Date | null | undefined,
  locale: Locale = 'es',
  now = new Date(),
): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffS = Math.round((date.getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(LOCALE_TAG[locale], { numeric: 'auto' });
  const abs = Math.abs(diffS);
  if (abs < 60) return rtf.format(diffS, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffS / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffS / 3600), 'hour');
  return rtf.format(Math.round(diffS / 86_400), 'day');
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

export function percent(value: number | null | undefined, locale: Locale = 'es'): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(value);
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '—';
}
