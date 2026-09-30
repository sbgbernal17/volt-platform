/**
 * Lógica pura de la pantalla de carga (handoff, pantallas 09 a 12, 19 y 22): fase visible, datos
 * desactualizados, avance del anillo, duración con formato de reloj y paradas anómalas.
 */
import type { Session } from '../api/types.ts';

export type SessionPhase = 'starting' | 'live' | 'stopping' | 'completed' | 'failed';

export function sessionPhase(session: Pick<Session, 'state' | 'detailedState'>): SessionPhase {
  switch (session.state) {
    case 'REQUESTED':
    case 'STARTING':
      return 'starting';
    case 'ACTIVE':
      return 'live';
    case 'STOPPING':
      return 'stopping';
    case 'ENDED':
    case 'SETTLED':
    case 'PAID':
      return 'completed';
    default:
      return 'failed';
  }
}

/** Sin lecturas del cargador en `thresholdMs` durante la carga: cifras en gris y aviso ámbar. */
export function isStale(
  session: Pick<Session, 'state' | 'lastSampleAt' | 'startedAt'>,
  now = Date.now(),
  thresholdMs = 90_000,
): boolean {
  if (session.state !== 'ACTIVE') return false;
  const reference = session.lastSampleAt ?? session.startedAt;
  if (!reference) return false;
  return now - new Date(reference).getTime() > thresholdMs;
}

export function minutesAgo(iso: string | null, now = Date.now()): number {
  if (!iso) return 0;
  return Math.max(1, Math.round((now - new Date(iso).getTime()) / 60_000));
}

/** Avance del anillo: batería de 0 a 1, o null cuando el vehículo no la reporta. */
export function ringProgress(session: Pick<Session, 'soc'>): number | null {
  if (session.soc === null || session.soc === undefined || Number.isNaN(session.soc)) return null;
  return Math.min(1, Math.max(0, session.soc / 100));
}

/** `00:24:18` (horas siempre presentes, cifras tabulares). */
export function formatClockDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return '00:00:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return [hours, minutes, rest].map((part) => String(part).padStart(2, '0')).join(':');
}

const FAULT_REASONS = new Set(['EmergencyStop', 'PowerLoss', 'Reboot', 'HardReset', 'SoftReset']);

/** Paradas que no pidió nadie: el cargador se detuvo por falla o reinicio (pantalla 22). */
export function stoppedByFault(session: Pick<Session, 'stopReason' | 'endKind'>): boolean {
  return (
    session.endKind === 'ESTIMATED' ||
    (session.stopReason !== null && FAULT_REASONS.has(session.stopReason))
  );
}

/** Texto corto para soporte: número de sesión y transacción. */
export function supportCode(session: Pick<Session, 'sessionNo' | 'ocppTransactionId'>): string {
  return session.ocppTransactionId
    ? `${session.sessionNo} · ${session.ocppTransactionId}`
    : session.sessionNo;
}
