/**
 * Lógica pura de la pantalla de pagos (sin React): períodos en días de Colombia y etiquetas.
 * Probada en payments-view.test.ts.
 */
export type Period = 'today' | '7d' | 'month' | '30d';

/** `YYYY-MM-DD` de hoy en Colombia (sin horario de verano). */
export function bogotaToday(now: Date = new Date()): string {
  return new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

function shiftDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Rango [from, to] inclusive, en días de Colombia, para cada período de la pantalla. */
export function periodRange(period: Period, now: Date = new Date()): { from: string; to: string } {
  const today = bogotaToday(now);
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: shiftDays(today, -6), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    default:
      return { from: shiftDays(today, -29), to: today };
  }
}
