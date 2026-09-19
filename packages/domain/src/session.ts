/**
 * Máquina de estados de la sesión de carga (negocio), separada de la transacción OCPP
 * (protocolo). Trece estados y proyección a los ocho que ve la app (DAT §3.2, ARQ §1.4).
 */
export const SESSION_STATES = [
  'REQUESTED',
  'AUTHORIZED',
  'STARTING',
  'CHARGING',
  'SUSPENDED_EV',
  'SUSPENDED_EVSE',
  'STOPPING',
  'ENDED',
  'SETTLED',
  'PAID',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type SessionState = (typeof SESSION_STATES)[number];

/** Estados visibles para el conductor. */
export type AppSessionState =
  | 'REQUESTED'
  | 'STARTING'
  | 'ACTIVE'
  | 'STOPPING'
  | 'ENDED'
  | 'SETTLED'
  | 'FAILED'
  | 'CANCELLED';

const TRANSITIONS: Readonly<Record<SessionState, readonly SessionState[]>> = {
  REQUESTED: ['AUTHORIZED', 'FAILED', 'CANCELLED'],
  AUTHORIZED: ['STARTING', 'FAILED', 'CANCELLED'],
  STARTING: ['CHARGING', 'EXPIRED', 'CANCELLED', 'FAILED'],
  CHARGING: ['SUSPENDED_EV', 'SUSPENDED_EVSE', 'STOPPING', 'ENDED'],
  SUSPENDED_EV: ['CHARGING', 'SUSPENDED_EVSE', 'STOPPING', 'ENDED'],
  SUSPENDED_EVSE: ['CHARGING', 'SUSPENDED_EV', 'STOPPING', 'ENDED'],
  STOPPING: ['ENDED'],
  ENDED: ['SETTLED'],
  // SETTLED -> SETTLED representa un cobro fallido que se reintenta (payment_status FAILED).
  SETTLED: ['PAID', 'SETTLED'],
  PAID: [],
  FAILED: [],
  CANCELLED: [],
  // Un StartTransaction tardío dentro de la ventana permitida reabre la sesión.
  EXPIRED: ['CHARGING'],
};

export const TERMINAL_SESSION_STATES: readonly SessionState[] = ['PAID', 'FAILED', 'CANCELLED'];

export function isSessionState(value: unknown): value is SessionState {
  return typeof value === 'string' && (SESSION_STATES as readonly string[]).includes(value);
}

export function canTransitionSession(from: SessionState, to: SessionState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidSessionTransitionError extends Error {
  constructor(
    readonly from: SessionState,
    readonly to: SessionState,
  ) {
    super(`Transición de sesión no permitida: ${from} -> ${to}`);
    this.name = 'InvalidSessionTransitionError';
  }
}

export function assertSessionTransition(from: SessionState, to: SessionState): void {
  if (!canTransitionSession(from, to)) {
    throw new InvalidSessionTransitionError(from, to);
  }
}

export function isTerminalSessionState(state: SessionState): boolean {
  return TERMINAL_SESSION_STATES.includes(state);
}

/** Estados en los que hay una transacción OCPP en curso y se acumula costo. */
export function isSessionActive(state: SessionState): boolean {
  return state === 'CHARGING' || state === 'SUSPENDED_EV' || state === 'SUSPENDED_EVSE';
}

/** Proyección a los estados de la app (ARQ §1.4). */
export function toAppSessionState(state: SessionState): AppSessionState {
  switch (state) {
    case 'REQUESTED':
    case 'AUTHORIZED':
      return 'REQUESTED';
    case 'STARTING':
      return 'STARTING';
    case 'CHARGING':
    case 'SUSPENDED_EV':
    case 'SUSPENDED_EVSE':
      return 'ACTIVE';
    case 'STOPPING':
      return 'STOPPING';
    case 'ENDED':
      return 'ENDED';
    case 'SETTLED':
    case 'PAID':
      return 'SETTLED';
    case 'FAILED':
    case 'EXPIRED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
  }
}

/** Motivos de fin de transacción de OCPP 1.6 (StopTransaction.reason). Sin reason se asume Local. */
export const STOP_REASONS = [
  'EmergencyStop',
  'EVDisconnected',
  'HardReset',
  'Local',
  'Other',
  'PowerLoss',
  'Reboot',
  'Remote',
  'SoftReset',
  'UnlockCommand',
  'DeAuthorized',
] as const;

export type StopReason = (typeof STOP_REASONS)[number];
