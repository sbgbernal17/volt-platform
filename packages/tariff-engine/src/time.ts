/**
 * Resolución de hora local por zona IANA sin dependencias: `Intl.DateTimeFormat` da las partes
 * locales de un instante; la conversión inversa (hora local → instante) se hace por aproximación
 * con el desfase de la zona, corrigiendo una vez (basta para cambios de hora de una hora).
 */
import type { DayOfWeek } from './types.ts';

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: DayOfWeek;
  /** `YYYY-MM-DD` local. */
  dateKey: string;
  /** Segundos transcurridos desde la medianoche local. */
  secondsOfDay: number;
}

const WEEKDAYS: Record<string, DayOfWeek> = {
  Mon: 'MONDAY',
  Tue: 'TUESDAY',
  Wed: 'WEDNESDAY',
  Thu: 'THURSDAY',
  Fri: 'FRIDAY',
  Sat: 'SATURDAY',
  Sun: 'SUNDAY',
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timezone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, cached);
  }
  return cached;
}

export function localParts(ms: number, timezone: string): LocalParts {
  const parts = formatter(timezone).formatToParts(new Date(ms));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: WEEKDAYS[get('weekday')] ?? 'MONDAY',
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    secondsOfDay: hour * 3600 + minute * 60 + second,
  };
}

/** Desfase (ms) de la zona en un instante: hora local expresada como UTC menos el instante. */
export function timezoneOffsetMs(ms: number, timezone: string): number {
  const p = localParts(ms, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Instante (ms) de una hora local dada; ante hora repetida (fin del horario de verano) toma la primera. */
export function localToUtcMs(
  local: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timezone: string,
): number {
  const naive = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  let guess = naive - timezoneOffsetMs(naive, timezone);
  const offset = timezoneOffsetMs(guess, timezone);
  guess = naive - offset;
  // Hora inexistente (salto de verano): el desfase tras la corrección difiere; se toma el instante posterior.
  const check = timezoneOffsetMs(guess, timezone);
  if (check !== offset) guess = naive - check;
  return guess;
}

/** Instante de `HH:MM` local en la fecha local `dateKey` (`YYYY-MM-DD`). */
export function localTimeOnDate(dateKey: string, hhmm: string, timezone: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return localToUtcMs(
    { year: y ?? 1970, month: m ?? 1, day: d ?? 1, hour: hh ?? 0, minute: mm ?? 0, second: 0 },
    timezone,
  );
}

/** Fecha local siguiente (`YYYY-MM-DD` + 1 día) calculada en UTC (las fechas civiles no dependen de la zona). */
export function nextDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function parseHhmm(value: string): number {
  const [hh, mm] = value.split(':').map(Number);
  return (hh ?? 0) * 3600 + (mm ?? 0) * 60;
}
