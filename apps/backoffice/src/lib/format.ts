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
