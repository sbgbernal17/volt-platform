/**
 * Ciclo de vida de un cargador en la plataforma (OPS §1.2). Decide la respuesta a
 * BootNotification y si el cargador puede iniciar transacciones facturables.
 */
export const LIFECYCLE_STATES = [
  'INVENTORIED',
  'PROVISIONED',
  'CONNECTED_PENDING',
  'CONFIGURED',
  'TESTED',
  'OPERATIONAL',
  'MAINTENANCE',
  'REJECTED',
  'DECOMMISSIONED',
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

const TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  INVENTORIED: ['PROVISIONED', 'DECOMMISSIONED'],
  PROVISIONED: ['CONNECTED_PENDING', 'DECOMMISSIONED'],
  CONNECTED_PENDING: ['CONFIGURED', 'REJECTED', 'DECOMMISSIONED'],
  CONFIGURED: ['TESTED', 'CONNECTED_PENDING', 'DECOMMISSIONED'],
  TESTED: ['OPERATIONAL', 'CONFIGURED', 'DECOMMISSIONED'],
  OPERATIONAL: ['MAINTENANCE', 'DECOMMISSIONED'],
  MAINTENANCE: ['OPERATIONAL', 'DECOMMISSIONED'],
  REJECTED: ['PROVISIONED', 'DECOMMISSIONED'],
  DECOMMISSIONED: [],
};

export type BootNotificationStatus = 'Accepted' | 'Pending' | 'Rejected';

export function canTransitionLifecycle(from: LifecycleState, to: LifecycleState): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Respuesta a BootNotification según el estado (OPS §1.2 y SEG S2). Un cargador que no está
 * dado de alta nunca llega aquí: el gateway cierra la conexión en el handshake.
 */
export function bootNotificationStatusFor(state: LifecycleState): BootNotificationStatus {
  switch (state) {
    case 'INVENTORIED':
    case 'PROVISIONED':
    case 'CONNECTED_PENDING':
      return 'Pending';
    case 'CONFIGURED':
    case 'TESTED':
    case 'OPERATIONAL':
    case 'MAINTENANCE':
      return 'Accepted';
    case 'REJECTED':
    case 'DECOMMISSIONED':
      return 'Rejected';
  }
}

/** Intervalo que se devuelve en BootNotification.conf cuando el estado no es Accepted. */
export const REJECTED_BOOT_INTERVAL_SECONDS = 3600;

/** Solo estos estados pueden iniciar transacciones que se cobran a conductores. */
export function canStartBillableTransaction(state: LifecycleState): boolean {
  return state === 'OPERATIONAL' || state === 'MAINTENANCE';
}

/** Estados en los que solo se aceptan transacciones con tokens de prueba (sin cobro). */
export function isCommissioning(state: LifecycleState): boolean {
  return state === 'CONNECTED_PENDING' || state === 'CONFIGURED' || state === 'TESTED';
}
