/** Formas de las respuestas de /admin/v1 que usan las pantallas (solo los campos que se muestran). */
export interface Site {
  id: string;
  code: string;
  name: string;
  address: string;
  city: string | null;
  latitude: string | number;
  longitude: string | number;
  timezone: string;
  access_type: string;
  status: string;
  created_at: string;
}

export interface Connector {
  id: string;
  evse_id: string;
  evse_code: string;
  ocpp_connector_id: number;
  standard: string;
  power_type: string;
  max_power_w: number | null;
  ocpp_status?: string;
  status?: string;
  live_status?: string;
  error_code: string;
  status_received_at: string | null;
  current_transaction_id: string | null;
  visible_in_app: boolean;
}

/** Resumen de un conector en las listas de cargadores (`GET /admin/v1/charge-points`). */
export interface ConnectorSummary {
  id: string;
  evse_id: string;
  evse_code: string;
  ocpp_connector_id: number;
  standard: string;
  power_type: string;
  max_power_w: number | null;
  ocpp_status: string;
  visible_in_app: boolean;
  /** Potencia del gabinete (W) y si se reparte entre conectores (ADR 0026). */
  charger_max_power_w: number | null;
  power_shared: boolean;
}

export interface ChargePoint {
  id: string;
  site_id: string;
  charge_box_id: string;
  vendor: string | null;
  model: string | null;
  serial_number: string | null;
  firmware_version: string | null;
  /** Potencia máxima del gabinete (W), compartida entre conectores (ADR 0026). */
  max_power_w: number | null;
  lifecycle_status: string;
  connected: boolean;
  last_seen_at: string | null;
  last_boot_at: string | null;
  cp_status: string;
  config_template_id: string | null;
  security_profile: number;
  heartbeat_interval_s: number;
  visible_in_app: boolean;
  created_at: string;
}

/** Fila de `GET /admin/v1/charge-points`: el cargador con el resumen de sus conectores. */
export interface ChargePointListItem extends ChargePoint {
  connectors: ConnectorSummary[];
}

export interface ConfigEntry {
  key: string;
  desired_value: string | null;
  observed_value: string | null;
  readonly: boolean | null;
  drift: boolean;
  observed_at?: string | null;
}

export interface CommandRow {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  state: string;
  requested_by: string;
  requested_at: string;
  responded_at: string | null;
  result_status: string | null;
  error_code: string | null;
  error_description: string | null;
  response: Record<string, unknown> | null;
}

export interface Alarm {
  id: string;
  kind: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  status: string;
  site_id: string | null;
  charge_point_id: string | null;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  resolution: string | null;
  details: Record<string, unknown>;
}

export interface SessionView {
  id: string;
  session_no: string;
  state: string;
  site_id: string;
  charge_point_id: string;
  charge_box_id: string;
  evse_code: string;
  driver_id: string | null;
  driver_display_name: string | null;
  start_channel: string;
  requested_at: string;
  started_at: string | null;
  ended_at: string | null;
  settled_at: string | null;
  paid_at: string | null;
  energy_wh: number | string | null;
  charging_time_s: number | null;
  idle_time_s: number | null;
  currency: string | null;
  total_minor: number | string | null;
  subtotal_minor: number | string | null;
  tax_minor: number | string | null;
  discount_minor: number | string | null;
  payment_status: string;
  exposure_limit_minor: number | string | null;
  running_cost: { total_minor: string; currency: string } | null;
  tariff_code: string | null;
  tariff_version: number | null;
  ocpp_transaction_no: number | null;
  stop_reason: string | null;
  end_kind: string | null;
  failure_code: string | null;
  is_test: boolean;
  receipt_id: string | null;
}

/** Línea de un cálculo de costo (JSON de `toCostResultJson`). */
export interface CostLineJson {
  seq: number;
  dimension: string;
  elementRef: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  amountMinor: string;
  taxRate: string;
  tax: string;
  taxMinor: string;
  total: string;
}

/** Cálculo de costo persistido (final o histórico). */
export interface CostCalcJson {
  id: string;
  calcVersion: number;
  kind: string;
  engineVersion: string;
  currency: string;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  subtotalMinor: string;
  discountMinor: string;
  taxMinor: string;
  totalMinor: string;
  capped: boolean;
  flags: string[];
  alerts: string[];
  reason: string | null;
  computedBy: string;
  computedAt: string;
}

/** Costo en curso de una sesión abierta (snake_case, como lo guarda la sesión). */
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

/** Respuesta de `GET /admin/v1/sessions/:id/cost`: envoltorio con el costo en curso y el final. */
export interface SessionCostView {
  session_id: string;
  state: string;
  currency: string | null;
  segment: string | null;
  snapshot: {
    tariff_code: string | null;
    tariff_version: number | null;
    tax_included: boolean;
    snapshot_hash: string;
    frozen_at: string;
    retro: boolean;
  } | null;
  running: RunningCost | null;
  final: (CostCalcJson & { lines: CostLineJson[] }) | null;
  calcs: CostCalcJson[];
}

export interface Overview {
  sites: (Site & { chargePoints: (ChargePoint & { connectors: Connector[] })[] })[];
  counts: {
    sites: number;
    chargePoints: number;
    online: number;
    offline: number;
    connectorsByStatus: Record<string, number>;
    activeSessions: number;
    openAlarms: Record<string, number>;
  };
  activeSessions: SessionView[];
  openAlarms: Alarm[];
}

export interface Driver {
  id: string;
  email: string | null;
  phone: string | null;
  /** Celular verificado por SMS (ADR 0031). */
  phone_verified_at: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  locale: string;
  segment: string;
  status: string;
  billing_status: string;
  blocked_reason: string | null;
  /** Documento de identidad y factura electrónica (ADR 0027); en la lista el número va enmascarado. */
  document_type: string | null;
  document_number: string | null;
  wants_invoice: boolean;
  created_at: string;
}

export interface StaffUser {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  site_ids: string[];
  status: string;
  linked: boolean;
  mfa_enrolled: boolean;
  locale: string;
  last_login_at: string | null;
  invited_at: string;
  disabled_reason: string | null;
}

export interface AuditEntry {
  id: string;
  ts: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  outcome: string;
  after: unknown;
  request_id: string | null;
  remote_ip: string | null;
  hash: string;
}

export interface Items<T> {
  items: T[];
}
