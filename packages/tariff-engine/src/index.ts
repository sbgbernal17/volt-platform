/**
 * Contrato del motor de tarifas (TAR §7.1). La implementación llega en la iteración 4; aquí se
 * fijan los tipos para que el resto del sistema compile contra ellos desde ahora.
 *
 * Modelo alineado con OCPI 2.2.1 Tariffs: Tariff -> TariffElement[] -> PriceComponent[] +
 * TariffRestrictions. Precios como texto decimal (se convierten a enteros escalados al calcular).
 */
import type { RoundingMode } from '@volt/domain';

export type PriceComponentType = 'ENERGY' | 'TIME' | 'PARKING_TIME' | 'FLAT';

export interface PriceComponent {
  type: PriceComponentType;
  /** Precio por unidad sin impuestos, como texto decimal ("0.45"). */
  price: string;
  /** Porcentaje de impuesto aplicable ("19"). */
  vat?: string;
  /** Unidad mínima de facturación: Wh para ENERGY, segundos para TIME y PARKING_TIME, 1 para FLAT. */
  step_size: number;
}

export type DayOfWeek =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

export interface TariffRestrictions {
  /** Hora local de inicio "HH:MM"; si end_time < start_time el período envuelve la medianoche. */
  start_time?: string;
  end_time?: string;
  start_date?: string;
  end_date?: string;
  min_kwh?: number;
  max_kwh?: number;
  min_current?: number;
  max_current?: number;
  min_power?: number;
  max_power?: number;
  min_duration?: number;
  max_duration?: number;
  day_of_week?: DayOfWeek[];
  reservation?: 'RESERVATION' | 'RESERVATION_EXPIRES';
}

/** Extensiones propias que OCPI no cubre (TAR §1.2). */
export interface VoltElementExtensions {
  grace_period_s?: number;
  idle_start?: 'TRANSACTION_END' | 'SUSPENDED_EV';
  max_idle_s?: number;
}

export interface TariffElement {
  price_components: PriceComponent[];
  restrictions?: TariffRestrictions;
  x_volt?: VoltElementExtensions;
}

export interface Price {
  excl_vat: string;
  incl_vat?: string;
}

export interface Tariff {
  country_code: string;
  party_id: string;
  id: string;
  version?: number;
  currency: string;
  type?: 'AD_HOC_PAYMENT' | 'PROFILE_CHEAP' | 'PROFILE_FAST' | 'PROFILE_GREEN' | 'REGULAR';
  tariff_alt_text?: { language: string; text: string }[];
  tariff_alt_url?: string;
  min_price?: Price;
  max_price?: Price;
  elements: TariffElement[];
  start_date_time?: string;
  end_date_time?: string;
  last_updated: string;
}

export interface CostPolicy {
  rounding: RoundingMode;
  tax_rounding: 'PER_LINE' | 'PER_TAX_GROUP';
  currency_exponent: number;
  /** Zona horaria IANA de la sede para resolver franjas horarias. */
  timezone: string;
}

export type SessionEvent =
  | { kind: 'TX_START'; ts_cp: string; ts_srv: string; meter_start_wh: number }
  | {
      kind: 'METER';
      ts_cp: string;
      ts_srv: string;
      register_wh: number;
      power_w?: number;
      soc?: number;
    }
  | { kind: 'STATUS'; ts_cp: string; ts_srv: string; status: string }
  | { kind: 'TX_STOP'; ts_cp: string; ts_srv: string; meter_stop_wh: number; reason?: string }
  | { kind: 'IDLE_END'; ts: string };

export interface CostLine {
  seq: number;
  dimension: PriceComponentType | 'ADJUSTMENT' | 'CAP';
  element_ref: string;
  period_start?: string;
  period_end?: string;
  quantity: string;
  unit: string;
  unit_price: string;
  amount_minor: bigint;
  tax_minor: bigint;
}

export interface CostResult {
  lines: CostLine[];
  subtotal_minor: bigint;
  discount_minor: bigint;
  tax_minor: bigint;
  total_minor: bigint;
  capped: boolean;
  flags: string[];
  alerts: ('PREAUTH_WARN' | 'PREAUTH_EXHAUSTED')[];
  input_hash: string;
  output_hash: string;
  engine_version: string;
}

export const ENGINE_VERSION = '0.0.0-pending';

export interface ComputeInput {
  tariff: Tariff;
  policy: CostPolicy;
  events: SessionEvent[];
  mode: 'RUNNING' | 'FINAL';
  now?: string;
  /** Límite de exposición por sesión en unidad mínima (ADR 0002), si aplica. */
  exposure_limit_minor?: bigint;
}

/** Se implementa en la iteración 4 (TAR §7). */
export function compute(_input: ComputeInput): CostResult {
  throw new Error('Motor de tarifas pendiente de implementación (iteración 4)');
}
