/** Lógica pura de Actividad (handoff, pantalla 14): agrupación por mes y resumen del mes en curso. */
import type { Session } from '../api/types.ts';

const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function sessionDate(session: Pick<Session, 'startedAt' | 'requestedAt'>): Date {
  return new Date(session.startedAt ?? session.requestedAt);
}

/** Clave `2026-09` en la zona horaria de Colombia. */
export function monthKey(date: Date, timeZone = 'America/Bogota'): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month').padStart(2, '0')}`;
  } catch {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
}

export function monthLabel(key: string, locale: 'es' | 'en' = 'es'): string {
  const [year = '', month = '1'] = key.split('-');
  const names = locale === 'en' ? MONTHS_EN : MONTHS_ES;
  const name = names[Number(month) - 1] ?? month;
  return locale === 'en'
    ? `${name} ${year}`
    : `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

export interface MonthGroup {
  key: string;
  label: string;
  sessions: Session[];
}

/** Grupos por mes, del más reciente al más antiguo, con las sesiones ordenadas igual. */
export function groupByMonth(
  sessions: readonly Session[],
  locale: 'es' | 'en' = 'es',
): MonthGroup[] {
  const sorted = [...sessions].sort((a, b) => sessionDate(b).getTime() - sessionDate(a).getTime());
  const groups = new Map<string, Session[]>();
  for (const session of sorted) {
    const key = monthKey(sessionDate(session));
    const list = groups.get(key);
    if (list) list.push(session);
    else groups.set(key, [session]);
  }
  return [...groups.entries()].map(([key, items]) => ({
    key,
    label: monthLabel(key, locale),
    sessions: items,
  }));
}

export interface MonthSummary {
  key: string;
  label: string;
  charges: number;
  energyKwh: number;
  /** Suma de los totales de las sesiones cerradas (unidad de la API, p. ej. `"38500"`). */
  totalMinor: bigint;
  currency: string;
}

const COUNTED_STATES = new Set<Session['state']>(['ENDED', 'SETTLED', 'PAID']);

/** Resumen del mes indicado (por defecto el actual): cargas terminadas, energía y total. */
export function monthSummary(
  sessions: readonly Session[],
  locale: 'es' | 'en' = 'es',
  now = new Date(),
): MonthSummary {
  const key = monthKey(now);
  let charges = 0;
  let energy = 0;
  let total = 0n;
  let currency = 'COP';
  for (const session of sessions) {
    if (!COUNTED_STATES.has(session.state) || monthKey(sessionDate(session)) !== key) continue;
    charges += 1;
    energy += session.energyKwh ?? 0;
    if (session.cost) {
      currency = session.cost.currency;
      total += toMinor(session.cost.total);
    }
  }
  return {
    key,
    label: monthLabel(key, locale),
    charges,
    energyKwh: Math.round(energy * 10) / 10,
    totalMinor: total,
    currency,
  };
}

/** `"38500"` o `"12.50"` → entero en la unidad mínima (COP sin decimales; otras con 2). */
export function toMinor(amount: string): bigint {
  const [integer = '0', fraction = ''] = amount.trim().split('.');
  if (!fraction) return BigInt(integer);
  return (
    BigInt(integer) * 100n +
    BigInt(fraction.padEnd(2, '0').slice(0, 2)) * (integer.startsWith('-') ? -1n : 1n)
  );
}

export function hasPendingPayment(session: Pick<Session, 'paymentStatus' | 'state'>): boolean {
  return (
    session.paymentStatus === 'FAILED' ||
    (session.state === 'SETTLED' && session.paymentStatus === 'PENDING')
  );
}
