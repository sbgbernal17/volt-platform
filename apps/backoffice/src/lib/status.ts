/**
 * Estados por palabra + ícono + color (regla del manual de marca y del handoff de la app, ADR 0030).
 * Un solo módulo para conectores, ciclo de vida, sesiones, pagos, severidad y cobro del conductor;
 * las pantallas no eligen colores por su cuenta. Probado en status.test.ts.
 */
export type Tone = 'ok' | 'info' | 'warning' | 'danger' | 'primary' | 'neutral';

export interface StatusVisual {
  tone: Tone;
  icon: string;
  /** Clave de texto (`status.Available`) o el valor tal cual si no hay traducción. */
  label: string;
  outlined?: boolean;
  dotted?: boolean;
}

const CONNECTOR: Record<string, StatusVisual> = {
  Available: { tone: 'ok', icon: 'check', label: 'status.Available' },
  Preparing: { tone: 'info', icon: 'schedule', label: 'status.Preparing' },
  Charging: { tone: 'primary', icon: 'bolt', label: 'status.Charging' },
  SuspendedEV: { tone: 'info', icon: 'pause', label: 'status.SuspendedEV' },
  SuspendedEVSE: { tone: 'warning', icon: 'pause', label: 'status.SuspendedEVSE' },
  Finishing: { tone: 'info', icon: 'schedule', label: 'status.Finishing' },
  Reserved: { tone: 'info', icon: 'event', label: 'status.Reserved' },
  Unavailable: { tone: 'neutral', icon: 'block', label: 'status.Unavailable', outlined: true },
  Faulted: { tone: 'danger', icon: 'error', label: 'status.Faulted' },
  Offline: { tone: 'neutral', icon: 'wifi-off', label: 'status.Offline', dotted: true },
};

export function connectorVisual(status: string, connected = true): StatusVisual {
  if (!connected) return CONNECTOR.Offline as StatusVisual;
  return (
    CONNECTOR[status] ?? { tone: 'neutral', icon: 'help-outline', label: status, dotted: true }
  );
}

const LIFECYCLE: Record<string, StatusVisual> = {
  INVENTORIED: { tone: 'neutral', icon: 'inventory-2', label: 'lifecycle.INVENTORIED' },
  PROVISIONED: { tone: 'info', icon: 'vpn-key', label: 'lifecycle.PROVISIONED' },
  CONNECTED_PENDING: { tone: 'warning', icon: 'schedule', label: 'lifecycle.CONNECTED_PENDING' },
  CONFIGURED: { tone: 'info', icon: 'tune', label: 'lifecycle.CONFIGURED' },
  TESTED: { tone: 'info', icon: 'verified', label: 'lifecycle.TESTED' },
  OPERATIONAL: { tone: 'ok', icon: 'check', label: 'lifecycle.OPERATIONAL' },
  MAINTENANCE: { tone: 'warning', icon: 'build', label: 'lifecycle.MAINTENANCE' },
  REJECTED: { tone: 'danger', icon: 'block', label: 'lifecycle.REJECTED' },
  DECOMMISSIONED: {
    tone: 'neutral',
    icon: 'archive',
    label: 'lifecycle.DECOMMISSIONED',
    outlined: true,
  },
};

export function lifecycleVisual(value: string): StatusVisual {
  return LIFECYCLE[value] ?? { tone: 'neutral', icon: 'help-outline', label: value };
}

const SESSION: Record<string, StatusVisual> = {
  REQUESTED: { tone: 'info', icon: 'schedule', label: 'session.state.REQUESTED' },
  AUTHORIZED: { tone: 'info', icon: 'schedule', label: 'session.state.AUTHORIZED' },
  STARTING: { tone: 'info', icon: 'schedule', label: 'session.state.STARTING' },
  CHARGING: { tone: 'primary', icon: 'bolt', label: 'session.state.CHARGING' },
  SUSPENDED_EV: { tone: 'info', icon: 'pause', label: 'session.state.SUSPENDED_EV' },
  SUSPENDED_EVSE: { tone: 'warning', icon: 'pause', label: 'session.state.SUSPENDED_EVSE' },
  STOPPING: { tone: 'warning', icon: 'schedule', label: 'session.state.STOPPING' },
  ENDED: { tone: 'neutral', icon: 'check', label: 'session.state.ENDED' },
  SETTLED: { tone: 'ok', icon: 'check', label: 'session.state.SETTLED' },
  PAID: { tone: 'ok', icon: 'check-circle', label: 'session.state.PAID' },
  FAILED: { tone: 'danger', icon: 'error', label: 'session.state.FAILED' },
  EXPIRED: { tone: 'warning', icon: 'timer-off', label: 'session.state.EXPIRED' },
  CANCELLED: { tone: 'neutral', icon: 'block', label: 'session.state.CANCELLED', outlined: true },
};

export function sessionVisual(value: string): StatusVisual {
  return SESSION[value] ?? { tone: 'neutral', icon: 'help-outline', label: value };
}

const PAYMENT: Record<string, StatusVisual> = {
  PAID: { tone: 'ok', icon: 'check', label: 'payment.status.PAID' },
  CAPTURED: { tone: 'ok', icon: 'check', label: 'payment.status.CAPTURED' },
  APPROVED: { tone: 'ok', icon: 'check', label: 'payment.status.APPROVED' },
  SUCCEEDED: { tone: 'ok', icon: 'check', label: 'payment.status.SUCCEEDED' },
  PENDING: { tone: 'info', icon: 'schedule', label: 'payment.status.PENDING' },
  AUTHORIZED: { tone: 'info', icon: 'schedule', label: 'payment.status.AUTHORIZED' },
  FAILED: { tone: 'danger', icon: 'error', label: 'payment.status.FAILED' },
  DECLINED: { tone: 'danger', icon: 'credit-card-off', label: 'payment.status.DECLINED' },
  ERROR: { tone: 'danger', icon: 'error', label: 'payment.status.ERROR' },
  REFUNDED: { tone: 'warning', icon: 'undo', label: 'payment.status.REFUNDED' },
  VOIDED: { tone: 'warning', icon: 'undo', label: 'payment.status.VOIDED' },
  CANCELLED: { tone: 'neutral', icon: 'block', label: 'payment.status.CANCELLED', outlined: true },
  NONE: { tone: 'neutral', icon: 'remove', label: 'payment.status.NONE', outlined: true },
  OPEN: { tone: 'warning', icon: 'schedule', label: 'payment.status.OPEN' },
  WAIVED: { tone: 'neutral', icon: 'volunteer-activism', label: 'payment.status.WAIVED' },
  WALLET: { tone: 'ok', icon: 'account-balance-wallet', label: 'payment.status.WALLET' },
};

export function paymentVisual(value: string | null | undefined): StatusVisual {
  const shown = value ?? '—';
  return PAYMENT[shown] ?? { tone: 'neutral', icon: 'help-outline', label: shown };
}

export function severityVisual(value: string): StatusVisual {
  if (value === 'CRITICAL') return { tone: 'danger', icon: 'error', label: 'severity.CRITICAL' };
  if (value === 'WARNING') return { tone: 'warning', icon: 'warning', label: 'severity.WARNING' };
  return { tone: 'info', icon: 'info', label: `severity.${value}` };
}

export function billingVisual(value: string): StatusVisual {
  if (value === 'OK') return { tone: 'ok', icon: 'check', label: 'drivers.ok' };
  if (value === 'BLOCKED_DEBT')
    return { tone: 'danger', icon: 'block', label: 'drivers.blockedDebt' };
  return { tone: 'warning', icon: 'block', label: 'drivers.blockedManual' };
}
