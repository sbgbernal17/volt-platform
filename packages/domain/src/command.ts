/**
 * Ciclo de vida de un comando remoto CSMS -> cargador (DAT §3.3): una sola CALL en vuelo por
 * cargador; un CALLRESULT que llega después del timeout se registra pero no se aplica.
 */
export const COMMAND_STATES = [
  'PENDING',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'ERROR',
  'TIMEOUT',
  'CANCELLED',
] as const;

export type CommandState = (typeof COMMAND_STATES)[number];

const TRANSITIONS: Readonly<Record<CommandState, readonly CommandState[]>> = {
  PENDING: ['SENT', 'CANCELLED'],
  SENT: ['ACCEPTED', 'REJECTED', 'ERROR', 'TIMEOUT'],
  ACCEPTED: [],
  REJECTED: [],
  ERROR: [],
  TIMEOUT: [],
  CANCELLED: [],
};

export function canTransitionCommand(from: CommandState, to: CommandState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isFinalCommandState(state: CommandState): boolean {
  return TRANSITIONS[state].length === 0;
}

/** Códigos de error de OCPP-J 1.6 (CALLERROR). */
export const CALL_ERROR_CODES = [
  'NotImplemented',
  'NotSupported',
  'InternalError',
  'ProtocolError',
  'SecurityError',
  'FormationViolation',
  'PropertyConstraintViolation',
  'OccurenceConstraintViolation',
  'TypeConstraintViolation',
  'GenericError',
] as const;

export type CallErrorCode = (typeof CALL_ERROR_CODES)[number];

/** Comandos cuyo resultado real llega después, por otro mensaje del cargador. */
export const DEFERRED_EFFECT_ACTIONS = [
  'Reset',
  'UpdateFirmware',
  'SignedUpdateFirmware',
  'GetDiagnostics',
  'GetLog',
  'ChangeAvailability',
] as const;

/** Comandos que se envían antes que cualquier otro pendiente para el mismo cargador. */
export const HIGH_PRIORITY_ACTIONS = ['RemoteStopTransaction', 'Reset'] as const;
