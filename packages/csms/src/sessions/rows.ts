import type { SessionState, StopReason } from '@volt/domain';

export type StartChannel =
  | 'APP'
  | 'QR'
  | 'RFID'
  | 'AUTOCHARGE'
  | 'ROAMING'
  | 'OPERATOR'
  | 'UNSOLICITED';

export interface ChargingSessionRow {
  id: string;
  tenant_id: string;
  session_no: string;
  driver_id: string | null;
  id_token_id: string | null;
  id_tag: string;
  site_id: string;
  charge_point_id: string;
  evse_id: string;
  connector_id: string | null;
  start_channel: StartChannel;
  auth_method: 'AUTH_REQUEST' | 'COMMAND' | 'WHITELIST';
  state: SessionState;
  state_changed_at: Date;
  idempotency_key: string | null;
  remote_start_command_id: string | null;
  ocpp_transaction_id: string | null;
  requested_at: Date;
  authorized_at: Date | null;
  start_deadline_at: Date | null;
  started_at: Date | null;
  ended_at: Date | null;
  interrupted_at: Date | null;
  idle_since: Date | null;
  energy_wh: bigint | null;
  charging_time_s: number | null;
  idle_time_s: number | null;
  stop_reason: StopReason | null;
  end_kind: 'NORMAL' | 'TIMEOUT' | 'ESTIMATED' | 'ORPHAN' | 'FAILED' | null;
  failure_code: string | null;
  settled_at: Date | null;
  paid_at: Date | null;
  tariff_snapshot_id: string | null;
  final_calc_id: string | null;
  currency: string | null;
  subtotal_minor: bigint | null;
  discount_minor: bigint | null;
  tax_minor: bigint | null;
  total_minor: bigint | null;
  preauth_minor: bigint | null;
  payment_status: string;
  last_sample: SessionSample | null;
  app_seq: bigint;
  is_test: boolean;
  stop_requested_by: string | null;
  remote_stop_command_id: string | null;
  anomaly_flags: string[];
  /** Iteración 4: segmento del snapshot, fin de ocupación, exposición y costo en curso. */
  tariff_segment: string | null;
  idle_ended_at: Date | null;
  exposure_limit_minor: bigint | null;
  exposure_warned_at: Date | null;
  exposure_exhausted_at: Date | null;
  running_cost: RunningCost | null;
  pricing_error: string | null;
  /** Iteración 5: cobro y recibo. */
  payment_attempts: number;
  last_payment_id: string | null;
  receipt_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Costo en curso guardado en `charging_session.running_cost` y enviado en `session.metered` (importes como texto). */
export interface RunningCost {
  currency: string;
  tax_included: boolean;
  total_minor: string;
  subtotal_minor: string;
  tax_minor: string;
  discount_minor: string;
  energy_wh: number;
  alerts: string[];
  flags: string[];
  computed_at: string;
  engine_version: string;
}

/** Última lectura conocida de la sesión (PDF `lastProcessData`; ARQ §1.4). */
export interface SessionSample {
  at: string;
  registerWh: number | null;
  energyWh: number | null;
  powerW: number | null;
  voltageV: number | null;
  currentA: number | null;
  soc: number | null;
}

export type TransactionState = 'ACTIVE' | 'STOPPED' | 'CLOSED_ESTIMATED' | 'ORPHAN' | 'RECONCILED';

export interface OcppTransactionRow {
  id: string;
  tenant_id: string;
  charge_point_id: string;
  evse_id: string;
  ocpp_connector_id: number;
  ocpp_transaction_id: number;
  ocpp_transaction_ref: string;
  session_id: string | null;
  id_tag: string;
  id_tag_status: string;
  reservation_ocpp_id: number | null;
  meter_start_wh: bigint;
  meter_stop_wh: bigint | null;
  started_at_cp: Date;
  started_received_at: Date;
  stopped_at_cp: Date | null;
  stopped_received_at: Date | null;
  stop_reason: StopReason | null;
  stop_id_tag: string | null;
  state: TransactionState;
  offline_start: boolean;
  offline_stop: boolean;
  clock_offset_s: number | null;
  start_unique_id: string | null;
  stop_unique_id: string | null;
  transaction_data: unknown;
  anomaly_flags: string[];
  created_at: Date;
  updated_at: Date;
}

/** Estados de sesión con transacción viva o a punto de tenerla. */
export const LIVE_SESSION_STATES = [
  'AUTHORIZED',
  'STARTING',
  'CHARGING',
  'SUSPENDED_EV',
  'SUSPENDED_EVSE',
  'STOPPING',
] as const;
