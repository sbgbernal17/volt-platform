/**
 * Formatos del manual de marca (iguales en español e inglés): `$ 35.000`, `22,4 kWh`, `48 kW`,
 * `3:20 p. m.`, `1 h 05 min`. Funciones puras, sin dependencias de React Native.
 */
const EXPONENTS: Record<string, number> = { COP: 0, USD: 2, EUR: 2 };

function group(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Importe que entrega la API (`"48240"` o `"12.50"`) o en unidad mínima (bigint) → `$ 48.240`. */
export function formatMoney(
  value: string | number | bigint | null | undefined,
  currency = 'COP',
): string {
  if (value === null || value === undefined || value === '') return '—';
  const prefix = currency === 'COP' ? '$ ' : `${currency} `;
  if (typeof value === 'bigint') {
    const exponent = EXPONENTS[currency] ?? 2;
    const negative = value < 0n;
    const digits = (negative ? -value : value).toString().padStart(exponent + 1, '0');
    const integer = exponent > 0 ? digits.slice(0, -exponent) : digits;
    const fraction = exponent > 0 ? digits.slice(-exponent) : '';
    return `${negative ? '-' : ''}${prefix}${group(integer)}${fraction ? `,${fraction}` : ''}`;
  }
  const text =
    typeof value === 'number' ? value.toFixed(EXPONENTS[currency] ?? 2) : String(value).trim();
  const negative = text.startsWith('-');
  const [integer = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const cleanFraction = fraction.replace(/0+$/, '');
  return `${negative ? '-' : ''}${prefix}${group(integer)}${cleanFraction ? `,${cleanFraction}` : ''}`;
}

/** `22,4 kWh`, `22 kWh`; null → `—`. */
export function formatKwh(kwh: number | null | undefined): string {
  if (kwh === null || kwh === undefined || Number.isNaN(kwh)) return '—';
  const tenths = Math.round(kwh * 10);
  const integer = Math.floor(tenths / 10);
  const decimal = tenths % 10;
  return decimal === 0
    ? `${group(String(integer))} kWh`
    : `${group(String(integer))},${decimal} kWh`;
}

/** `48 kW` (una decimal por debajo de 10 kW: `7,2 kW`). */
export function formatKw(kw: number | null | undefined): string {
  if (kw === null || kw === undefined || Number.isNaN(kw)) return '—';
  if (kw >= 10) return `${group(String(Math.round(kw)))} kW`;
  const tenths = Math.round(kw * 10);
  return tenths % 10 === 0 ? `${tenths / 10} kW` : `${Math.floor(tenths / 10)},${tenths % 10} kW`;
}

/** Precio por kWh de la tarifa: `$ 1.350/kWh`. */
export function formatPerKwh(price: string | null | undefined, currency = 'COP'): string {
  return price ? `${formatMoney(price, currency)}/kWh` : '—';
}

/** `12 min`, `1 h 05 min`, `2 h`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return '—';
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${String(rest).padStart(2, '0')} min`;
}

/** Porcentaje entero: `80 %`. */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Math.round(value)} %`;
}

/** Hora colombiana `3:20 p. m.` (12 horas, sin cero a la izquierda). */
export function formatClock(
  iso: string | Date | null | undefined,
  timeZone = 'America/Bogota',
): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';
  const { hour, minute } = zonedParts(date, timeZone);
  const suffix = hour < 12 ? 'a. m.' : 'p. m.';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

const MONTHS_ES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];
const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Fecha corta `12 sep 2026` / `Sep 12, 2026` con la hora: `12 sep 2026, 3:20 p. m.`. */
export function formatDateTime(
  iso: string | Date | null | undefined,
  locale: 'es' | 'en' = 'es',
  timeZone = 'America/Bogota',
): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';
  const { day, month, year } = zonedParts(date, timeZone);
  const text =
    locale === 'en'
      ? `${MONTHS_EN[month - 1]} ${day}, ${year}`
      : `${day} ${MONTHS_ES[month - 1]} ${year}`;
  return `${text}, ${formatClock(date, timeZone)}`;
}

function zonedParts(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(date);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour') % 24,
      minute: get('minute'),
    };
  } catch {
    // Sin ICU (motores recortados): hora local del dispositivo.
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }
}

/** Distancia en km con una decimal por debajo de 10 km: `1,2 km`, `15 km`, `350 m`. */
export function formatDistance(km: number | null | undefined): string {
  if (km === null || km === undefined || Number.isNaN(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${Math.floor(km)},${Math.round((km % 1) * 10) % 10} km`;
  return `${Math.round(km)} km`;
}

/** Distancia entre dos coordenadas (haversine, km). */
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
