/**
 * Contrato del motor de tarifas (TAR §7.1). Modelo alineado con OCPI 2.2.1 Tariffs:
 * Tariff -> TariffElement[] -> PriceComponent[] + TariffRestrictions. Los precios viajan como
 * texto decimal y se convierten a enteros escalados al calcular (nunca float, TAR §3.8).
 */
import type { RoundingMode } from '@volt/domain';

export type PriceComponentType = 'ENERGY' | 'TIME' | 'PARKING_TIME' | 'FLAT';

export interface PriceComponent {
  type: PriceComponentType;
  /**
   * Precio por unidad como texto decimal ("0.45"). ENERGY por kWh; TIME y PARKING_TIME por
   * hora (semántica OCPI: 1.500 COP por minuto se expresa como "90000"); FLAT por sesión.
   * Sin impuesto salvo que la política declare `tax_included`.
   */
  price: string;
  /** Porcentaje de impuesto aplicable ("19"). Omitirlo equivale a 0 para el cálculo. */
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
  /** Hora local de inicio "HH:MM" (inclusiva); si end_time < start_time el período envuelve la medianoche. */
  start_time?: string;
  /** Hora local de fin "HH:MM" (exclusiva); "00:00" significa fin del día. */
  end_time?: string;
  /** Fecha local inclusiva `YYYY-MM-DD`. */
  start_date?: string;
  /** Fecha local exclusiva `YYYY-MM-DD`. */
  end_date?: string;
  /** kWh acumulados de la sesión al inicio del tramo (inclusivo). */
  min_kwh?: number;
  /** kWh acumulados de la sesión al inicio del tramo (exclusivo). */
  max_kwh?: number;
  min_current?: number;
  max_current?: number;
  /** Potencia de carga en kW (inclusiva). */
  min_power?: number;
  /** Potencia de carga en kW (exclusiva). */
  max_power?: number;
  /** Duración total de la sesión en segundos (inclusiva). */
  min_duration?: number;
  /** Duración total de la sesión en segundos (exclusiva). */
  max_duration?: number;
  day_of_week?: DayOfWeek[];
  reservation?: 'RESERVATION' | 'RESERVATION_EXPIRES';
}

/** Extensiones propias que OCPI no cubre (TAR §1.2). */
export interface VoltElementExtensions {
  /** Segundos de gracia desde el inicio de cada período de ocupación antes de cobrarlo (ADR 0012: 900). */
  grace_period_s?: number;
  /**
   * Qué marca el inicio de la ocupación: fin de la transacción (StopTransaction), SuspendedEV
   * durante la transacción, o lo primero que ocurra (valor por defecto de Volt).
   */
  idle_start?: 'TRANSACTION_END' | 'SUSPENDED_EV' | 'EARLIEST';
  /** Tope de segundos de ocupación cobrables por sesión; el resto no se cobra y se marca MAX_IDLE_REACHED. */
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

/** Ajuste post-cálculo congelado en el snapshot (descuento de segmento, cupón, cortesía). */
export interface Adjustment {
  type: 'PERCENT' | 'AMOUNT';
  /** Dimensión sobre la que aplica; sin dimensión aplica sobre todas las líneas base. */
  dimension?: PriceComponentType | undefined;
  /** PERCENT: porcentaje con signo ("-15"); AMOUNT: importe en unidades mayores con signo ("-1.00"). */
  value: string;
  label?: string | undefined;
}

export interface CostLine {
  seq: number;
  dimension: PriceComponentType | 'ADJUSTMENT' | 'CAP';
  /** `e<n>` (índice del TariffElement), etiqueta del ajuste, o `max_price`/`min_price`. */
  element_ref: string;
  period_start?: string;
  period_end?: string;
  /** Cantidad presentada: kWh (3 decimales), minutos, "1" por sesión, importe base de un ajuste. */
  quantity: string;
  /** Cantidad exacta antes de `step_size`: Wh o segundos; 1 para FLAT; base en unidad mínima para ajustes. */
  quantity_raw: bigint;
  unit: string;
  /** Precio unitario presentado: por kWh, por minuto, por sesión o el factor del ajuste. */
  unit_price: string;
  /** Importe neto (sin impuesto) en unidad mínima, ya redondeado. */
  amount_minor: bigint;
  /** Tasa de impuesto aplicada en porcentaje ("19"). */
  tax_rate: string;
  tax_minor: bigint;
}

export interface CostSummary {
  currency: string;
  energy_wh: number;
  charging_time_s: number;
  /** Segundos de ocupación observados (antes de gracia y topes). */
  idle_time_s: number;
  /** Segundos de ocupación cobrables (tras gracia y `max_idle_s`, antes de `step_size`). */
  billable_idle_s: number;
  started_at?: string;
  ended_at?: string;
  idle_ended_at?: string;
}

export type CostAlert = 'PREAUTH_WARN' | 'PREAUTH_EXHAUSTED';

export interface CostResult {
  lines: CostLine[];
  /** Suma de líneas netas (incluye ajustes y tope). */
  subtotal_minor: bigint;
  /** Magnitud positiva de los ajustes negativos (descuentos). */
  discount_minor: bigint;
  tax_minor: bigint;
  total_minor: bigint;
  capped: boolean;
  flags: string[];
  alerts: CostAlert[];
  summary: CostSummary;
  input_hash: string;
  output_hash: string;
  engine_version: string;
}

export interface ComputeInput {
  tariff: Tariff;
  policy: CostPolicy;
  events: SessionEvent[];
  mode: 'RUNNING' | 'FINAL';
  /** Instante "a fecha" para RUNNING; sin él se usa el último evento. Se ignora en FINAL. */
  now?: string | undefined;
  /** Límite de exposición por sesión en unidad mínima (ADR 0002), si aplica. */
  exposure_limit_minor?: bigint | undefined;
  /** Porcentaje del límite a partir del cual se alerta (por defecto 80). */
  warn_pct?: number | undefined;
  /** `true` cuando los precios de la tarifa ya incluyen el impuesto (ADR 0017). */
  tax_included?: boolean | undefined;
  adjustments?: Adjustment[] | undefined;
  /** Banderas externas que el motor propaga al resultado (OFFLINE, ORPHAN, CLOCK_SKEW...). */
  flags?: string[] | undefined;
}
