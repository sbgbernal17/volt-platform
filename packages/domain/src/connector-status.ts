/**
 * Estados de conector según OCPP 1.6 (ChargePointStatus, sección 7.7 de la especificación)
 * más el estado derivado `Offline`, que no existe en el protocolo: lo calcula el CSMS a partir
 * de la conectividad del cargador (capítulo DAT §3.1, decisión D2).
 */
export const CHARGE_POINT_STATUSES = [
  'Available',
  'Preparing',
  'Charging',
  'SuspendedEVSE',
  'SuspendedEV',
  'Finishing',
  'Reserved',
  'Unavailable',
  'Faulted',
] as const;

export type ChargePointStatus = (typeof CHARGE_POINT_STATUSES)[number];

/** Estado que ven la app y el back-office: los nueve de OCPP más `Offline`. */
export type ConnectorDisplayStatus = ChargePointStatus | 'Offline';

export const CHARGE_POINT_ERROR_CODES = [
  'ConnectorLockFailure',
  'EVCommunicationError',
  'GroundFailure',
  'HighTemperature',
  'InternalError',
  'LocalListConflict',
  'NoError',
  'OtherError',
  'OverCurrentFailure',
  'OverVoltage',
  'PowerMeterFailure',
  'PowerSwitchFailure',
  'ReaderFailure',
  'ResetFailure',
  'UnderVoltage',
  'WeakSignal',
] as const;

export type ChargePointErrorCode = (typeof CHARGE_POINT_ERROR_CODES)[number];

/**
 * Transiciones esperadas entre estados de conector (tabla de transiciones de OCPP 1.6,
 * letras A..I). El gateway acepta cualquier StatusNotification: esta tabla solo sirve para
 * marcar como anómala una transición no prevista (alarma, no rechazo).
 */
const EXPECTED_TRANSITIONS: Readonly<Record<ChargePointStatus, readonly ChargePointStatus[]>> = {
  Available: [
    'Preparing',
    'Charging',
    'SuspendedEV',
    'SuspendedEVSE',
    'Reserved',
    'Unavailable',
    'Faulted',
  ],
  Preparing: ['Available', 'Charging', 'SuspendedEV', 'SuspendedEVSE', 'Finishing', 'Faulted'],
  Charging: ['Available', 'SuspendedEV', 'SuspendedEVSE', 'Finishing', 'Unavailable', 'Faulted'],
  SuspendedEV: ['Available', 'Charging', 'SuspendedEVSE', 'Finishing', 'Unavailable', 'Faulted'],
  SuspendedEVSE: ['Available', 'Charging', 'SuspendedEV', 'Finishing', 'Unavailable', 'Faulted'],
  Finishing: ['Available', 'Preparing', 'Unavailable', 'Faulted'],
  Reserved: ['Available', 'Preparing', 'Unavailable', 'Faulted'],
  Unavailable: ['Available', 'Preparing', 'Charging', 'SuspendedEV', 'SuspendedEVSE', 'Faulted'],
  Faulted: [
    'Available',
    'Preparing',
    'Charging',
    'SuspendedEV',
    'SuspendedEVSE',
    'Finishing',
    'Reserved',
    'Unavailable',
  ],
};

export function isChargePointStatus(value: unknown): value is ChargePointStatus {
  return typeof value === 'string' && (CHARGE_POINT_STATUSES as readonly string[]).includes(value);
}

/** Un StatusNotification con el mismo estado es un refresco, no una transición. */
export function isExpectedTransition(from: ChargePointStatus, to: ChargePointStatus): boolean {
  if (from === to) return true;
  return EXPECTED_TRANSITIONS[from].includes(to);
}

/** Estados en los que hay un vehículo conectado y una transacción puede estar en curso. */
export function isOccupied(status: ChargePointStatus): boolean {
  return (
    status === 'Preparing' ||
    status === 'Charging' ||
    status === 'SuspendedEV' ||
    status === 'SuspendedEVSE' ||
    status === 'Finishing'
  );
}

export interface ConnectorSnapshot {
  /** Último estado crudo reportado por el cargador (nunca se sobrescribe con Offline). */
  ocppStatus: ChargePointStatus;
  /** Si el cargador tiene un WebSocket abierto con el gateway en este momento. */
  connected: boolean;
  /** Último mensaje de cualquier tipo recibido del cargador. */
  lastSeenAt: Date;
  /** Umbral a partir del cual, sin mensajes, se considera offline aunque el socket siga abierto. */
  offlineAfterSeconds: number;
  now?: Date;
}

/**
 * Deriva el estado que se muestra. `Offline` se calcula con "cualquier mensaje recibido", no
 * solo con Heartbeat: un cargador puede omitir Heartbeat mientras envía MeterValues.
 */
export function deriveDisplayStatus(snapshot: ConnectorSnapshot): ConnectorDisplayStatus {
  const now = snapshot.now ?? new Date();
  const silentForSeconds = (now.getTime() - snapshot.lastSeenAt.getTime()) / 1000;
  if (!snapshot.connected || silentForSeconds > snapshot.offlineAfterSeconds) {
    return 'Offline';
  }
  return snapshot.ocppStatus;
}
