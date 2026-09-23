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

export interface ChargePoint {
  id: string;
  site_id: string;
  charge_box_id: string;
  vendor: string | null;
  model: string | null;
  serial_number: string | null;
  firmware_version: string | null;
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
  display_name: string | null;
  locale: string;
  segment: string;
  status: string;
  billing_status: string;
  blocked_reason: string | null;
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
