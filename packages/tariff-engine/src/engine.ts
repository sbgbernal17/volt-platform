/**
 * Motor de cálculo de costos (TAR §3.4 a §3.8 y §7). Función pura y determinista: no accede a
 * reloj (salvo `now` explícito), base de datos ni red. Todo el dinero se maneja en enteros
 * (unidad mínima de la moneda), la energía en Wh y el tiempo en milisegundos/segundos.
 *
 * Reglas OCPI 2.2.1 aplicadas: primer elemento con componente para la dimensión cuyas
 * restricciones coinciden; restricciones en AND; `step_size` redondea hacia arriba al cierre;
 * `start_time` inclusivo y `end_time` exclusivo; TIME y PARKING_TIME se cobran por hora.
 */
import { createHash } from 'node:crypto';
import {
  divideRounded,
  formatScaled,
  PRICE_SCALE,
  PRICE_SCALE_FACTOR,
  parseScaled,
  percentOfMinor,
  type RoundingMode,
} from '@volt/domain';
import { type LocalParts, localParts, localTimeOnDate, nextDateKey, parseHhmm } from './time.ts';
import type {
  Adjustment,
  ComputeInput,
  CostAlert,
  CostLine,
  CostResult,
  CostSummary,
  PriceComponent,
  PriceComponentType,
  SessionEvent,
  Tariff,
  TariffElement,
  TariffRestrictions,
} from './types.ts';

export const ENGINE_VERSION = '1.0.0';

/** Porcentaje del límite de exposición a partir del cual se alerta si el snapshot no dice otra cosa. */
export const DEFAULT_WARN_PCT = 80;

/** Decimales con los que se representa una tasa de impuesto ("19" -> 19000). */
const TAX_RATE_SCALE = 3;
const TAX_RATE_FACTOR = 10n ** BigInt(TAX_RATE_SCALE);
const HUNDRED_PCT = 100n * TAX_RATE_FACTOR;

const NOT_CHARGING_STATUSES = new Set([
  'SuspendedEV',
  'SuspendedEVSE',
  'Finishing',
  'Available',
  'Preparing',
  'Faulted',
  'Unavailable',
  'Reserved',
]);
/** Estados que, tras StopTransaction, indican que el vehículo dejó libre el conector. */
const IDLE_END_STATUSES = new Set(['Available', 'Preparing', 'Unavailable', 'Faulted', 'Reserved']);
/** Motivos de parada por los que no se cobra ocupación y la sesión pasa a revisión (TAR §3.5). */
const NO_IDLE_REASONS = new Set(['PowerLoss', 'Reboot', 'HardReset']);

const KIND_ORDER: Record<SessionEvent['kind'], number> = {
  TX_START: 0,
  METER: 1,
  STATUS: 2,
  TX_STOP: 3,
  IDLE_END: 4,
};

const DIMENSION_ORDER: Record<PriceComponentType, number> = {
  FLAT: 0,
  ENERGY: 1,
  TIME: 2,
  PARKING_TIME: 3,
};

export class TariffEngineError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_EVENT' | 'INVALID_TARIFF' | 'NO_MATCHING_ELEMENT' | 'INVALID_INPUT',
  ) {
    super(message);
    this.name = 'TariffEngineError';
  }
}

// ---------------------------------------------------------------------------
// Canonicalización y hashes
// ---------------------------------------------------------------------------

/** JSON canónico: claves ordenadas, bigint como texto, `undefined` omitido. */
export function canonicalJson(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function eventTs(event: SessionEvent): number {
  const raw = event.kind === 'IDLE_END' ? event.ts : event.ts_cp;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    throw new TariffEngineError(
      `Marca de tiempo inválida en evento ${event.kind}: "${raw}"`,
      'INVALID_EVENT',
    );
  }
  return ms;
}

/** Orden por instante del cargador y tipo; duplicados exactos eliminados (TAR §7.1). */
export function canonicalizeEvents(events: SessionEvent[]): SessionEvent[] {
  const seen = new Set<string>();
  const unique: { event: SessionEvent; key: string; ts: number }[] = [];
  for (const event of events) {
    const key = canonicalJson(event);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ event, key, ts: eventTs(event) });
  }
  unique.sort(
    (a, b) =>
      a.ts - b.ts ||
      KIND_ORDER[a.event.kind] - KIND_ORDER[b.event.kind] ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  return unique.map((u) => u.event);
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface Sample {
  ts: number;
  register: bigint;
  powerW: number | undefined;
}

interface Segment {
  t0: number;
  t1: number;
  wh: bigint;
  powerW: number | undefined;
}

interface Interval {
  a: number;
  b: number;
}

interface MatchContext {
  local: LocalParts;
  cumWh: bigint;
  durationS: number;
  powerKw: number | undefined;
}

interface IndexedElement {
  index: number;
  element: TariffElement;
  component: PriceComponent;
}

/** Acumulado por elemento antes de convertirlo en línea. */
interface Accumulator {
  element: IndexedElement;
  raw: bigint;
  first: number;
  last: number;
}

/** Línea en construcción: importe bruto (según precio) y tasa; el neto se fija al cerrar impuestos. */
interface DraftLine {
  dimension: CostLine['dimension'];
  element_ref: string;
  period_start?: string;
  period_end?: string;
  quantity: string;
  quantity_raw: bigint;
  unit: string;
  unit_price: string;
  gross: bigint;
  rate: bigint;
  tax: bigint;
  /** Dimensión a la que acompaña un ajuste (para ordenarlo tras sus líneas base). */
  target?: PriceComponentType | undefined;
}

/** Orden de presentación: cada dimensión seguida de sus ajustes; ajustes generales y tope al final. */
function draftOrder(line: DraftLine): number {
  if (line.dimension === 'CAP') return 100;
  if (line.dimension === 'ADJUSTMENT')
    return line.target ? DIMENSION_ORDER[line.target] * 2 + 1 : 50;
  return DIMENSION_ORDER[line.dimension] * 2;
}

// ---------------------------------------------------------------------------
// Utilidades numéricas
// ---------------------------------------------------------------------------

function ceilToStep(raw: bigint, step: number): bigint {
  const s = BigInt(Math.max(1, Math.floor(step)));
  if (raw <= 0n) return 0n;
  return ((raw + s - 1n) / s) * s;
}

function parseRate(vat: string | undefined): bigint {
  if (vat === undefined || vat === '') return 0n;
  const rate = parseScaled(vat, TAX_RATE_SCALE);
  if (rate < 0n)
    throw new TariffEngineError(`Tasa de impuesto negativa: "${vat}"`, 'INVALID_TARIFF');
  return rate;
}

function formatRate(rate: bigint): string {
  const text = formatScaled(rate, TAX_RATE_SCALE);
  return text.replace(/\.?0+$/, '');
}

function formatMinutes(seconds: bigint): string {
  const whole = seconds / 60n;
  const rest = seconds % 60n;
  if (rest === 0n) return whole.toString();
  return formatScaled(divideRounded(seconds * 100n, 60n, 'HALF_UP'), 2).replace(/0+$/, '');
}

function formatPercent(hundredths: bigint): string {
  return formatScaled(hundredths, 4).replace(/0+$/, '').replace(/\.$/, '');
}

function roundMs(ms: number): number {
  return Math.round(ms);
}

// ---------------------------------------------------------------------------
// Restricciones
// ---------------------------------------------------------------------------

function timeWindowMatches(restrictions: TariffRestrictions, secondsOfDay: number): boolean {
  const start =
    restrictions.start_time === undefined ? undefined : parseHhmm(restrictions.start_time);
  let end = restrictions.end_time === undefined ? undefined : parseHhmm(restrictions.end_time);
  if (end === 0) end = 86400;
  if (start === undefined && end === undefined) return true;
  if (start !== undefined && end !== undefined) {
    if (start === end) return true;
    if (start < end) return secondsOfDay >= start && secondsOfDay < end;
    return secondsOfDay >= start || secondsOfDay < end;
  }
  if (start !== undefined) return secondsOfDay >= start;
  return secondsOfDay < (end as number);
}

function restrictionsMatch(
  restrictions: TariffRestrictions | undefined,
  ctx: MatchContext,
): boolean {
  if (!restrictions) return true;
  if (!timeWindowMatches(restrictions, ctx.local.secondsOfDay)) return false;
  if (restrictions.day_of_week && !restrictions.day_of_week.includes(ctx.local.weekday))
    return false;
  if (restrictions.start_date !== undefined && ctx.local.dateKey < restrictions.start_date)
    return false;
  if (restrictions.end_date !== undefined && ctx.local.dateKey >= restrictions.end_date)
    return false;
  if (restrictions.min_kwh !== undefined && ctx.cumWh < kwhToWh(restrictions.min_kwh)) return false;
  if (restrictions.max_kwh !== undefined && ctx.cumWh >= kwhToWh(restrictions.max_kwh))
    return false;
  if (restrictions.min_duration !== undefined && ctx.durationS < restrictions.min_duration)
    return false;
  if (restrictions.max_duration !== undefined && ctx.durationS >= restrictions.max_duration)
    return false;
  if (restrictions.min_power !== undefined || restrictions.max_power !== undefined) {
    if (ctx.powerKw === undefined) return false;
    if (restrictions.min_power !== undefined && ctx.powerKw < restrictions.min_power) return false;
    if (restrictions.max_power !== undefined && ctx.powerKw >= restrictions.max_power) return false;
  }
  // Corriente y reservas no son observables en este motor: la restricción no coincide (fail-closed).
  if (restrictions.min_current !== undefined || restrictions.max_current !== undefined)
    return false;
  if (restrictions.reservation !== undefined) return false;
  return true;
}

function kwhToWh(kwh: number): bigint {
  return BigInt(Math.round(kwh * 1000));
}

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

class Engine {
  private readonly tz: string;
  private readonly rounding: RoundingMode;
  private readonly exponent: number;
  private readonly taxIncluded: boolean;
  private readonly flags = new Set<string>();
  private readonly elements: Record<PriceComponentType, IndexedElement[]> = {
    FLAT: [],
    ENERGY: [],
    TIME: [],
    PARKING_TIME: [],
  };
  private samples: Sample[] = [];
  private segments: Segment[] = [];
  private startMs = 0;
  private stopMs: number | undefined;
  private horizonMs = 0;
  private events: SessionEvent[] = [];

  constructor(private readonly input: ComputeInput) {
    this.tz = input.policy.timezone;
    this.rounding = input.policy.rounding;
    this.exponent = input.policy.currency_exponent;
    this.taxIncluded = input.tax_included === true;
    for (const flag of input.flags ?? []) this.flags.add(flag);
    if (!Number.isInteger(this.exponent) || this.exponent < 0 || this.exponent > 6) {
      throw new TariffEngineError(
        'currency_exponent debe ser un entero entre 0 y 6',
        'INVALID_INPUT',
      );
    }
    input.tariff.elements.forEach((element, index) => {
      for (const component of element.price_components) {
        this.elements[component.type]?.push({ index, element, component });
      }
    });
    try {
      localParts(0, this.tz);
    } catch {
      throw new TariffEngineError(`Zona horaria inválida: "${this.tz}"`, 'INVALID_INPUT');
    }
  }

  run(): CostResult {
    const all = canonicalizeEvents(this.input.events);
    const mode = this.input.mode;
    let horizon = Number.POSITIVE_INFINITY;
    if (mode === 'RUNNING') {
      if (this.input.now !== undefined) {
        horizon = Date.parse(this.input.now);
        if (!Number.isFinite(horizon)) {
          throw new TariffEngineError(`"now" inválido: "${this.input.now}"`, 'INVALID_INPUT');
        }
      } else {
        horizon = all.length > 0 ? Math.max(...all.map(eventTs)) : 0;
      }
    }
    this.events = mode === 'RUNNING' ? all.filter((e) => eventTs(e) <= horizon) : all;
    const lastTs = this.events.length > 0 ? Math.max(...this.events.map(eventTs)) : 0;
    this.horizonMs = mode === 'RUNNING' ? horizon : lastTs;

    const start = this.events.find((e) => e.kind === 'TX_START');
    const drafts: DraftLine[] = [];
    let summary: CostSummary = {
      currency: this.input.tariff.currency,
      energy_wh: 0,
      charging_time_s: 0,
      idle_time_s: 0,
      billable_idle_s: 0,
    };

    if (start && start.kind === 'TX_START') {
      this.startMs = eventTs(start);
      const stop = this.events.find(
        (e): e is Extract<SessionEvent, { kind: 'TX_STOP' }> =>
          e.kind === 'TX_STOP' && eventTs(e) >= this.startMs,
      );
      this.stopMs = stop ? eventTs(stop) : undefined;
      if (!stop && mode === 'FINAL') this.flags.add('NO_TX_STOP');

      this.buildSamples(start.meter_start_wh, stop);
      this.buildSegments(stop);

      const chargingIntervals = this.chargingIntervals();
      const idle = this.idleIntervals(stop);

      drafts.push(...this.flatLines());
      drafts.push(...this.energyLines());
      drafts.push(...this.timeLines(chargingIntervals));
      drafts.push(...this.parkingLines(idle.billable));

      summary = {
        currency: this.input.tariff.currency,
        energy_wh: Number(this.segments.reduce((acc, s) => acc + s.wh, 0n)),
        charging_time_s: Number(sumSeconds(chargingIntervals)),
        idle_time_s: Number(sumSeconds(idle.observed)),
        billable_idle_s: Number(sumSeconds(idle.billable)),
        started_at: new Date(this.startMs).toISOString(),
        ...(this.stopMs !== undefined ? { ended_at: new Date(this.stopMs).toISOString() } : {}),
        ...(idle.endedAt !== undefined
          ? { idle_ended_at: new Date(idle.endedAt).toISOString() }
          : {}),
      };
    } else {
      this.flags.add('NO_TX_START');
    }

    drafts.push(...this.adjustmentLines(drafts));
    drafts.sort((a, b) => draftOrder(a) - draftOrder(b));
    this.applyTaxes(drafts);

    let subtotal = drafts.reduce((acc, l) => acc + this.net(l), 0n);
    let tax = drafts.reduce((acc, l) => acc + l.tax, 0n);
    let total = subtotal + tax;
    let capped = false;

    const cap = this.capLine(subtotal, tax, total);
    if (cap) {
      drafts.push(cap.line);
      capped = cap.capped;
      subtotal += this.net(cap.line);
      tax += cap.line.tax;
      total = subtotal + tax;
    }

    const discount = drafts
      .filter((l) => l.dimension === 'ADJUSTMENT' && this.net(l) < 0n)
      .reduce((acc, l) => acc - this.net(l), 0n);

    const alerts = this.alerts(total);

    const lines: CostLine[] = drafts.map((l, i) => ({
      seq: i + 1,
      dimension: l.dimension,
      element_ref: l.element_ref,
      ...(l.period_start !== undefined ? { period_start: l.period_start } : {}),
      ...(l.period_end !== undefined ? { period_end: l.period_end } : {}),
      quantity: l.quantity,
      quantity_raw: l.quantity_raw,
      unit: l.unit,
      unit_price: l.unit_price,
      amount_minor: this.net(l),
      tax_rate: formatRate(l.rate),
      tax_minor: l.tax,
    }));

    const flags = [...this.flags].sort();
    const inputHash = sha256Hex(
      canonicalJson({
        tariff: this.input.tariff,
        policy: this.input.policy,
        tax_included: this.taxIncluded,
        adjustments: this.input.adjustments ?? [],
        exposure_limit_minor: this.input.exposure_limit_minor?.toString() ?? null,
        warn_pct: this.input.warn_pct ?? DEFAULT_WARN_PCT,
        flags: [...(this.input.flags ?? [])].sort(),
        mode,
        now: mode === 'RUNNING' ? new Date(this.horizonMs).toISOString() : null,
        events: all,
      }),
    );
    const body = {
      lines,
      subtotal_minor: subtotal,
      discount_minor: discount,
      tax_minor: tax,
      total_minor: total,
      capped,
      flags,
      alerts,
      summary,
      engine_version: ENGINE_VERSION,
    };
    return { ...body, input_hash: inputHash, output_hash: sha256Hex(canonicalJson(body)) };
  }

  // -- energía ------------------------------------------------------------

  private buildSamples(
    meterStartWh: number,
    stop: Extract<SessionEvent, { kind: 'TX_STOP' }> | undefined,
  ): void {
    const txEnd = this.stopMs ?? this.horizonMs;
    const samples: Sample[] = [
      { ts: this.startMs, register: toWh(meterStartWh), powerW: undefined },
    ];
    for (const event of this.events) {
      if (event.kind !== 'METER') continue;
      const ts = eventTs(event);
      if (ts < this.startMs || ts > txEnd) continue;
      samples.push({ ts, register: toWh(event.register_wh), powerW: event.power_w });
    }
    if (stop)
      samples.push({
        ts: this.stopMs as number,
        register: toWh(stop.meter_stop_wh),
        powerW: undefined,
      });
    samples.sort((a, b) => a.ts - b.ts);
    // Dos lecturas en el mismo instante: se conserva la primera en orden canónico.
    this.samples = samples.filter((s, i) => i === 0 || s.ts !== (samples[i - 1] as Sample).ts);
  }

  private buildSegments(stop: Extract<SessionEvent, { kind: 'TX_STOP' }> | undefined): void {
    const segments: Segment[] = [];
    for (let i = 1; i < this.samples.length; i += 1) {
      const prev = this.samples[i - 1] as Sample;
      const next = this.samples[i] as Sample;
      let wh = next.register - prev.register;
      if (wh < 0n) {
        wh = 0n;
        this.flags.add('METER_ANOMALY');
      }
      segments.push({ t0: prev.ts, t1: next.ts, wh, powerW: prev.powerW });
    }
    if (stop && segments.length > 0) {
      const first = this.samples[0] as Sample;
      let authoritative = toWh(stop.meter_stop_wh) - first.register;
      const measured = segments.reduce((acc, s) => acc + s.wh, 0n);
      if (authoritative < 0n) {
        this.flags.add('METER_ANOMALY');
        authoritative = measured;
      }
      let diff = authoritative - measured;
      if (diff !== 0n) {
        this.flags.add('RECONCILED_TO_STOP');
        for (let i = segments.length - 1; i >= 0 && diff !== 0n; i -= 1) {
          const segment = segments[i] as Segment;
          if (segment.wh + diff >= 0n) {
            segment.wh += diff;
            diff = 0n;
          } else {
            diff += segment.wh;
            segment.wh = 0n;
            this.flags.add('METER_ANOMALY');
          }
        }
      }
    }
    this.segments = segments;
  }

  /** Energía acumulada de la sesión en un instante (interpolación lineal entre lecturas). */
  private energyAt(ts: number): bigint {
    let cum = 0n;
    for (const segment of this.segments) {
      if (ts >= segment.t1) {
        cum += segment.wh;
        continue;
      }
      if (ts > segment.t0) {
        cum += divideRounded(
          segment.wh * BigInt(ts - segment.t0),
          BigInt(segment.t1 - segment.t0),
          'HALF_UP',
        );
      }
      break;
    }
    return cum;
  }

  private restrictedTimes(dimension: PriceComponentType): string[] {
    const times = new Set<string>();
    for (const { element } of this.elements[dimension]) {
      if (element.restrictions?.start_time) times.add(element.restrictions.start_time);
      if (element.restrictions?.end_time) times.add(element.restrictions.end_time);
    }
    return [...times];
  }

  private durationInstants(dimension: PriceComponentType): number[] {
    const instants: number[] = [];
    for (const { element } of this.elements[dimension]) {
      if (element.restrictions?.min_duration !== undefined) {
        instants.push(this.startMs + element.restrictions.min_duration * 1000);
      }
      if (element.restrictions?.max_duration !== undefined) {
        instants.push(this.startMs + element.restrictions.max_duration * 1000);
      }
    }
    return instants;
  }

  private kwhThresholds(dimension: PriceComponentType): bigint[] {
    const thresholds = new Set<bigint>();
    for (const { element } of this.elements[dimension]) {
      if (element.restrictions?.min_kwh !== undefined)
        thresholds.add(kwhToWh(element.restrictions.min_kwh));
      if (element.restrictions?.max_kwh !== undefined)
        thresholds.add(kwhToWh(element.restrictions.max_kwh));
    }
    return [...thresholds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** Instantes estrictamente dentro de (t0, t1) en los que puede cambiar el elemento activo. */
  private boundaries(t0: number, t1: number, times: string[], extra: number[]): number[] {
    const found = new Set<number>();
    if (t1 - t0 > 0) {
      let key = localParts(t0, this.tz).dateKey;
      const endKey = localParts(t1, this.tz).dateKey;
      for (let guard = 0; guard < 400; guard += 1) {
        for (const hhmm of ['00:00', ...times]) {
          const ms = localTimeOnDate(key, hhmm, this.tz);
          if (ms > t0 && ms < t1) found.add(ms);
        }
        if (key === endKey) break;
        key = nextDateKey(key);
      }
      for (const ms of extra) if (ms > t0 && ms < t1) found.add(ms);
    }
    return [...found].sort((a, b) => a - b);
  }

  private context(ts: number, cumWh: bigint, powerKw: number | undefined): MatchContext {
    return {
      local: localParts(ts, this.tz),
      cumWh,
      durationS: Math.max(0, Math.floor((ts - this.startMs) / 1000)),
      powerKw,
    };
  }

  private firstMatch(dimension: PriceComponentType, ctx: MatchContext): IndexedElement | undefined {
    return this.elements[dimension].find((e) => restrictionsMatch(e.element.restrictions, ctx));
  }

  private energyLines(): DraftLine[] {
    if (this.elements.ENERGY.length === 0) {
      if (this.segments.some((s) => s.wh > 0n)) {
        throw new TariffEngineError(
          'La tarifa no tiene componente ENERGY y la sesión consumió energía',
          'NO_MATCHING_ELEMENT',
        );
      }
      return [];
    }
    const times = this.restrictedTimes('ENERGY');
    const durations = this.durationInstants('ENERGY');
    const thresholds = this.kwhThresholds('ENERGY');
    const accumulators = new Map<number, Accumulator>();
    let cumWh = 0n;

    const account = (
      a: number,
      b: number,
      wh: bigint,
      cumAtStart: bigint,
      powerKw: number | undefined,
    ): void => {
      if (wh <= 0n) return;
      const ctx = this.context(a, cumAtStart, powerKw);
      const match = this.firstMatch('ENERGY', ctx);
      if (!match) {
        throw new TariffEngineError(
          `Ningún elemento ENERGY coincide en ${new Date(a).toISOString()} (falta el elemento de respaldo)`,
          'NO_MATCHING_ELEMENT',
        );
      }
      const acc = accumulators.get(match.index);
      if (acc) {
        acc.raw += wh;
        acc.last = Math.max(acc.last, b);
        acc.first = Math.min(acc.first, a);
      } else {
        accumulators.set(match.index, { element: match, raw: wh, first: a, last: b });
      }
    };

    for (const segment of this.segments) {
      const powerKw = segmentPowerKw(segment);
      const bounds = this.boundaries(segment.t0, segment.t1, times, durations);
      if (bounds.length > 0 && segment.wh > 0n) this.flags.add('INTERPOLATED');
      const pieces = interpolate(segment, bounds);
      for (const piece of pieces) {
        let pieceStart = piece.t0;
        let remaining = piece.wh;
        let pieceCum = cumWh;
        for (const threshold of thresholds) {
          if (pieceCum < threshold && threshold < pieceCum + remaining) {
            const part = threshold - pieceCum;
            const splitAt = pieceStart + Number((BigInt(piece.t1 - pieceStart) * part) / remaining);
            account(pieceStart, splitAt, part, pieceCum, powerKw);
            pieceCum += part;
            remaining -= part;
            pieceStart = splitAt;
          }
        }
        account(pieceStart, piece.t1, remaining, pieceCum, powerKw);
        cumWh += piece.wh;
      }
    }

    return [...accumulators.values()]
      .sort((a, b) => a.first - b.first || a.element.index - b.element.index)
      .map((acc) => {
        const billable = ceilToStep(acc.raw, acc.element.component.step_size);
        return this.draft({
          dimension: 'ENERGY',
          element: acc.element,
          period_start: acc.first,
          period_end: acc.last,
          quantity: formatScaled(billable, 3),
          quantity_raw: acc.raw,
          unit: 'kWh',
          unit_price: acc.element.component.price,
          gross: this.cost(billable, 1000n, acc.element.component.price),
        });
      });
  }

  // -- tiempo ----------------------------------------------------------------

  /** Períodos en los que el vehículo cargaba, entre TX_START y el fin de la transacción (o el horizonte). */
  private chargingIntervals(): Interval[] {
    const txEnd = this.stopMs ?? this.horizonMs;
    if (txEnd <= this.startMs) return [];
    const intervals: Interval[] = [];
    let charging = true;
    let since = this.startMs;
    for (const event of this.events) {
      if (event.kind !== 'STATUS') continue;
      const ts = eventTs(event);
      if (ts <= this.startMs || ts >= txEnd) continue;
      const nowCharging = !NOT_CHARGING_STATUSES.has(event.status);
      if (nowCharging === charging) continue;
      if (charging) intervals.push({ a: since, b: ts });
      charging = nowCharging;
      since = ts;
    }
    if (charging && txEnd > since) intervals.push({ a: since, b: txEnd });
    return intervals;
  }

  private timeLines(charging: Interval[]): DraftLine[] {
    if (this.elements.TIME.length === 0) return [];
    return this.timeDimensionLines('TIME', charging, false);
  }

  private timeDimensionLines(
    dimension: 'TIME' | 'PARKING_TIME',
    intervals: Interval[],
    optional: boolean,
  ): DraftLine[] {
    const times = this.restrictedTimes(dimension);
    const durations = this.durationInstants(dimension);
    const accumulators = new Map<number, Accumulator>();
    for (const interval of intervals) {
      const bounds = this.boundaries(interval.a, interval.b, times, durations);
      const cuts = [interval.a, ...bounds, interval.b];
      for (let i = 0; i + 1 < cuts.length; i += 1) {
        const a = cuts[i] as number;
        const b = cuts[i + 1] as number;
        if (b <= a) continue;
        const ctx = this.context(a, this.energyAt(a), undefined);
        const match = this.firstMatch(dimension, ctx);
        if (!match) {
          if (optional) continue;
          throw new TariffEngineError(
            `Ningún elemento ${dimension} coincide en ${new Date(a).toISOString()} (falta el elemento de respaldo)`,
            'NO_MATCHING_ELEMENT',
          );
        }
        const ms = BigInt(b - a);
        const acc = accumulators.get(match.index);
        if (acc) {
          acc.raw += ms;
          acc.last = Math.max(acc.last, b);
          acc.first = Math.min(acc.first, a);
        } else {
          accumulators.set(match.index, { element: match, raw: ms, first: a, last: b });
        }
      }
    }
    return [...accumulators.values()]
      .sort((a, b) => a.first - b.first || a.element.index - b.element.index)
      .map((acc) => {
        const seconds = divideRounded(acc.raw, 1000n, 'HALF_UP');
        const billable = ceilToStep(seconds, acc.element.component.step_size);
        const perMinute = divideRounded(
          parseScaled(acc.element.component.price, PRICE_SCALE),
          60n,
          this.rounding,
        );
        return this.draft({
          dimension,
          element: acc.element,
          period_start: acc.first,
          period_end: acc.last,
          quantity: formatMinutes(billable),
          quantity_raw: seconds,
          unit: 'min',
          unit_price: trimScaled(formatScaled(perMinute, PRICE_SCALE)),
          gross: this.cost(billable, 3600n, acc.element.component.price),
        });
      });
  }

  // -- ocupación -------------------------------------------------------------

  private idleIntervals(stop: Extract<SessionEvent, { kind: 'TX_STOP' }> | undefined): {
    observed: Interval[];
    billable: Interval[];
    endedAt: number | undefined;
  } {
    const parking = this.elements.PARKING_TIME[0];
    const policy = parking?.element.x_volt ?? {};
    const idleStart = policy.idle_start ?? 'EARLIEST';
    const graceMs = Math.max(0, policy.grace_period_s ?? 0) * 1000;
    const maxIdleMs =
      policy.max_idle_s === undefined ? undefined : Math.max(0, policy.max_idle_s) * 1000;

    const raw: Interval[] = [];
    let endedAt: number | undefined;

    if (stop && NO_IDLE_REASONS.has(stop.reason ?? '')) {
      this.flags.add('IDLE_WAIVED');
      this.flags.add('REVIEW');
      return { observed: [], billable: [], endedAt: undefined };
    }

    if (idleStart !== 'TRANSACTION_END') raw.push(...this.suspendedIntervals());

    if (stop && idleStart !== 'SUSPENDED_EV') {
      const stopMs = this.stopMs as number;
      if (stop.reason === 'EVDisconnected') {
        endedAt = stopMs;
      } else {
        endedAt = this.idleEndAfter(stopMs);
        if (endedAt === undefined) {
          if (this.input.mode === 'RUNNING') {
            if (this.horizonMs > stopMs) raw.push({ a: stopMs, b: this.horizonMs });
          } else {
            this.flags.add('IDLE_OPEN');
            const lastKnown = Math.max(stopMs, ...this.events.map(eventTs));
            if (lastKnown > stopMs) raw.push({ a: stopMs, b: lastKnown });
          }
        } else if (endedAt > stopMs) {
          raw.push({ a: stopMs, b: endedAt });
        }
      }
    }

    const observed = mergeIntervals(raw);
    if (!parking) return { observed, billable: [], endedAt };

    const billable: Interval[] = [];
    let budget = maxIdleMs;
    for (const interval of observed) {
      const from = interval.a + graceMs;
      if (interval.b <= from) continue;
      let to = interval.b;
      if (budget !== undefined) {
        if (budget <= 0) {
          this.flags.add('MAX_IDLE_REACHED');
          break;
        }
        if (to - from > budget) {
          to = from + budget;
          this.flags.add('MAX_IDLE_REACHED');
        }
        budget -= to - from;
      }
      billable.push({ a: from, b: to });
    }
    return { observed, billable, endedAt };
  }

  /** Períodos SuspendedEV dentro de la transacción (caso A de TAR §3.6). */
  private suspendedIntervals(): Interval[] {
    const txEnd = this.stopMs ?? this.horizonMs;
    const intervals: Interval[] = [];
    let since: number | undefined;
    for (const event of this.events) {
      if (event.kind !== 'STATUS') continue;
      const ts = eventTs(event);
      if (ts <= this.startMs || ts >= txEnd) continue;
      if (event.status === 'SuspendedEV') {
        if (since === undefined) since = ts;
      } else if (since !== undefined) {
        if (ts > since) intervals.push({ a: since, b: ts });
        since = undefined;
      }
    }
    if (since !== undefined && txEnd > since) intervals.push({ a: since, b: txEnd });
    return intervals;
  }

  private idleEndAfter(stopMs: number): number | undefined {
    for (const event of this.events) {
      const ts = eventTs(event);
      if (ts < stopMs) continue;
      if (event.kind === 'IDLE_END') return ts;
      if (event.kind === 'STATUS' && IDLE_END_STATUSES.has(event.status)) return ts;
    }
    return undefined;
  }

  private parkingLines(billable: Interval[]): DraftLine[] {
    if (this.elements.PARKING_TIME.length === 0 || billable.length === 0) return [];
    return this.timeDimensionLines('PARKING_TIME', billable, true);
  }

  // -- sesión ----------------------------------------------------------------

  private flatLines(): DraftLine[] {
    if (this.elements.FLAT.length === 0) return [];
    const ctx = this.context(this.startMs, 0n, undefined);
    const match = this.firstMatch('FLAT', ctx);
    if (!match) return [];
    return [
      this.draft({
        dimension: 'FLAT',
        element: match,
        quantity: '1',
        quantity_raw: 1n,
        unit: 'session',
        unit_price: match.component.price,
        gross: this.cost(1n, 1n, match.component.price),
      }),
    ];
  }

  // -- ajustes ---------------------------------------------------------------

  private adjustmentLines(base: DraftLine[]): DraftLine[] {
    const adjustments = this.input.adjustments ?? [];
    const lines: DraftLine[] = [];
    for (const adjustment of adjustments) {
      lines.push(...this.adjustmentFor(adjustment, base, lines));
    }
    return lines;
  }

  private adjustmentFor(
    adjustment: Adjustment,
    base: DraftLine[],
    previous: DraftLine[],
  ): DraftLine[] {
    const dimension = adjustment.dimension;
    const targets = base.filter(
      (l) => l.dimension !== 'ADJUSTMENT' && (dimension === undefined || l.dimension === dimension),
    );
    if (targets.length === 0) {
      this.flags.add('ADJUSTMENT_SKIPPED');
      return [];
    }
    const label =
      adjustment.label ??
      `${adjustment.type}${dimension ? `:${dimension}` : ''}:${adjustment.value}`;
    const lines: DraftLine[] = [];
    if (adjustment.type === 'PERCENT') {
      const pct = parseScaled(adjustment.value, 2);
      const groups = new Map<bigint, bigint>();
      for (const line of targets) groups.set(line.rate, (groups.get(line.rate) ?? 0n) + line.gross);
      for (const [rate, baseGross] of groups) {
        let amount = percentOfMinor(baseGross, pct, this.rounding);
        const alreadyApplied = previous
          .filter(
            (l) =>
              l.dimension === 'ADJUSTMENT' &&
              l.rate === rate &&
              (dimension === undefined || l.unit === `base:${dimension}`),
          )
          .reduce((acc, l) => acc + l.gross, 0n);
        if (baseGross + alreadyApplied + amount < 0n) {
          amount = -(baseGross + alreadyApplied);
          this.flags.add('ADJUSTMENT_CAPPED');
        }
        if (amount === 0n) continue;
        lines.push({
          dimension: 'ADJUSTMENT',
          element_ref: label,
          quantity: formatScaled(baseGross, this.exponent),
          quantity_raw: baseGross,
          unit: dimension ? `base:${dimension}` : 'base',
          unit_price: formatPercent(pct),
          gross: amount,
          rate,
          tax: 0n,
          target: dimension,
        });
      }
      return lines;
    }
    const amountMinor = parseScaled(adjustment.value, this.exponent);
    const rate = (targets[0] as DraftLine).rate;
    const baseGross = targets.reduce((acc, l) => acc + l.gross, 0n);
    const alreadyApplied = previous
      .filter((l) => l.dimension === 'ADJUSTMENT')
      .reduce((acc, l) => acc + l.gross, 0n);
    let amount = amountMinor;
    if (baseGross + alreadyApplied + amount < 0n) {
      amount = -(baseGross + alreadyApplied);
      this.flags.add('ADJUSTMENT_CAPPED');
    }
    if (amount === 0n) return [];
    return [
      {
        dimension: 'ADJUSTMENT',
        element_ref: label,
        quantity: '1',
        quantity_raw: 1n,
        unit: dimension ? `amount:${dimension}` : 'amount',
        unit_price: adjustment.value,
        gross: amount,
        rate,
        tax: 0n,
        target: dimension,
      },
    ];
  }

  // -- impuestos ---------------------------------------------------------------

  private taxOf(gross: bigint, rate: bigint): bigint {
    if (rate === 0n) return 0n;
    if (this.taxIncluded) return divideRounded(gross * rate, HUNDRED_PCT + rate, this.rounding);
    return divideRounded(gross * rate, HUNDRED_PCT, this.rounding);
  }

  private net(line: DraftLine): bigint {
    return this.taxIncluded ? line.gross - line.tax : line.gross;
  }

  private applyTaxes(lines: DraftLine[]): void {
    for (const line of lines) line.tax = this.taxOf(line.gross, line.rate);
    if (this.input.policy.tax_rounding !== 'PER_TAX_GROUP') return;
    const groups = new Map<bigint, DraftLine[]>();
    for (const line of lines) {
      const group = groups.get(line.rate) ?? [];
      group.push(line);
      groups.set(line.rate, group);
    }
    for (const [rate, group] of groups) {
      const gross = group.reduce((acc, l) => acc + l.gross, 0n);
      const expected = this.taxOf(gross, rate);
      const assigned = group.reduce((acc, l) => acc + l.tax, 0n);
      const last = group[group.length - 1] as DraftLine;
      last.tax += expected - assigned;
    }
  }

  // -- tope y mínimo -------------------------------------------------------------

  private capLine(
    subtotal: bigint,
    tax: bigint,
    total: bigint,
  ): { line: DraftLine; capped: boolean } | undefined {
    const { max_price: max, min_price: min } = this.input.tariff;
    if (max) {
      const maxIncl =
        max.incl_vat !== undefined ? parseScaled(max.incl_vat, this.exponent) : undefined;
      const maxExcl =
        max.excl_vat !== undefined ? parseScaled(max.excl_vat, this.exponent) : undefined;
      if (maxIncl !== undefined && total > maxIncl) {
        const over = total - maxIncl;
        let capTax: bigint;
        let capNet: bigint;
        if (maxExcl !== undefined && maxExcl <= maxIncl) {
          capNet = maxExcl - subtotal;
          capTax = maxIncl - maxExcl - tax;
        } else {
          capTax = total > 0n ? -divideRounded(over * tax, total, this.rounding) : 0n;
          capNet = -over - capTax;
        }
        return { line: this.limitLine('max_price', over, capNet, capTax), capped: true };
      }
      if (maxIncl === undefined && maxExcl !== undefined && subtotal > maxExcl) {
        const over = subtotal - maxExcl;
        const capTax = subtotal > 0n ? -divideRounded(over * tax, subtotal, this.rounding) : 0n;
        return { line: this.limitLine('max_price', over, -over, capTax), capped: true };
      }
    }
    if (min && this.startMs > 0) {
      const minIncl =
        min.incl_vat !== undefined ? parseScaled(min.incl_vat, this.exponent) : undefined;
      const minExcl =
        min.excl_vat !== undefined ? parseScaled(min.excl_vat, this.exponent) : undefined;
      if (minIncl !== undefined && total < minIncl) {
        const under = minIncl - total;
        let capTax: bigint;
        let capNet: bigint;
        if (minExcl !== undefined && minExcl <= minIncl) {
          capNet = minExcl - subtotal;
          capTax = minIncl - minExcl - tax;
        } else {
          capTax = total > 0n ? divideRounded(under * tax, total, this.rounding) : 0n;
          capNet = under - capTax;
        }
        return { line: this.limitLine('min_price', under, capNet, capTax), capped: false };
      }
      if (minIncl === undefined && minExcl !== undefined && subtotal < minExcl) {
        const under = minExcl - subtotal;
        const capTax = subtotal > 0n ? divideRounded(under * tax, subtotal, this.rounding) : 0n;
        return { line: this.limitLine('min_price', under, under, capTax), capped: false };
      }
    }
    return undefined;
  }

  private limitLine(
    ref: 'max_price' | 'min_price',
    delta: bigint,
    net: bigint,
    tax: bigint,
  ): DraftLine {
    // El tope se expresa como línea con importe neto ya fijado: en modo `tax_included` el bruto es neto + impuesto.
    return {
      dimension: 'CAP',
      element_ref: ref,
      quantity: formatScaled(delta, this.exponent),
      quantity_raw: delta,
      unit: 'cap',
      unit_price: ref === 'max_price' ? '-1' : '1',
      gross: this.taxIncluded ? net + tax : net,
      rate: 0n,
      tax,
    };
  }

  // -- alertas de exposición ---------------------------------------------------

  private alerts(total: bigint): CostAlert[] {
    const limit = this.input.exposure_limit_minor;
    if (limit === undefined || limit <= 0n) return [];
    const alerts: CostAlert[] = [];
    const warnPct = BigInt(Math.round((this.input.warn_pct ?? DEFAULT_WARN_PCT) * 100));
    const warnAt = percentOfMinor(limit, warnPct, 'DOWN');
    if (total >= warnAt) alerts.push('PREAUTH_WARN');
    let projected = total;
    if (this.input.mode === 'RUNNING' && this.stopMs === undefined && this.startMs > 0) {
      projected += this.projectedIncrement();
    }
    if (projected >= limit) alerts.push('PREAUTH_EXHAUSTED');
    return alerts;
  }

  /** Costo bruto de dos intervalos más de muestreo a la potencia actual (TAR §3.3). */
  private projectedIncrement(): bigint {
    const last = this.segments[this.segments.length - 1];
    if (!last) return 0n;
    const lastSample = this.samples[this.samples.length - 1] as Sample;
    const intervalMs = Math.max(1000, last.t1 - last.t0);
    const powerW = lastSample.powerW ?? (Number(last.wh) * 3_600_000) / intervalMs;
    if (!(powerW > 0)) return 0n;
    const wh = BigInt(Math.round((powerW * 2 * intervalMs) / 3_600_000));
    if (wh <= 0n) return 0n;
    const ctx = this.context(this.horizonMs, this.energyAt(this.horizonMs), powerW / 1000);
    const match =
      this.firstMatch('ENERGY', ctx) ?? this.elements.ENERGY[this.elements.ENERGY.length - 1];
    if (!match) return 0n;
    const gross = this.cost(wh, 1000n, match.component.price);
    const rate = parseRate(match.component.vat);
    return this.taxIncluded ? gross : gross + this.taxOf(gross, rate);
  }

  // -- utilidades ----------------------------------------------------------------

  private cost(units: bigint, perUnits: bigint, price: string): bigint {
    const priceScaled = parseScaled(price, PRICE_SCALE);
    if (priceScaled < 0n)
      throw new TariffEngineError(`Precio negativo: "${price}"`, 'INVALID_TARIFF');
    return divideRounded(
      units * priceScaled * 10n ** BigInt(this.exponent),
      perUnits * PRICE_SCALE_FACTOR,
      this.rounding,
    );
  }

  private draft(input: {
    dimension: PriceComponentType;
    element: IndexedElement;
    period_start?: number;
    period_end?: number;
    quantity: string;
    quantity_raw: bigint;
    unit: string;
    unit_price: string;
    gross: bigint;
  }): DraftLine {
    return {
      dimension: input.dimension,
      element_ref: `e${input.element.index}`,
      ...(input.period_start !== undefined
        ? { period_start: new Date(input.period_start).toISOString() }
        : {}),
      ...(input.period_end !== undefined
        ? { period_end: new Date(input.period_end).toISOString() }
        : {}),
      quantity: input.quantity,
      quantity_raw: input.quantity_raw,
      unit: input.unit,
      unit_price: input.unit_price,
      gross: input.gross,
      rate: parseRate(input.element.component.vat),
      tax: 0n,
    };
  }
}

function toWh(value: number): bigint {
  if (!Number.isFinite(value))
    throw new TariffEngineError(`Lectura de energía inválida: ${value}`, 'INVALID_EVENT');
  return BigInt(Math.round(value));
}

function trimScaled(text: string): string {
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

function segmentPowerKw(segment: Segment): number | undefined {
  if (segment.powerW !== undefined) return segment.powerW / 1000;
  const ms = segment.t1 - segment.t0;
  if (ms <= 0) return undefined;
  return (Number(segment.wh) * 3_600_000) / ms / 1000;
}

function sumSeconds(intervals: Interval[]): bigint {
  const ms = intervals.reduce((acc, i) => acc + BigInt(Math.max(0, roundMs(i.b - i.a))), 0n);
  return divideRounded(ms, 1000n, 'HALF_UP');
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.b > i.a).sort((x, y) => x.a - y.a || x.b - y.b);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.a <= last.b) {
      last.b = Math.max(last.b, interval.b);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/**
 * Parte un tramo de energía en los límites dados con interpolación lineal en Wh enteros; el
 * resto se asigna al último subtramo para que la suma sea exactamente `segment.wh` (TAR §3.4).
 * La interpolación es acumulativa desde `t0`, por lo que insertar una lectura con el valor
 * interpolado en un límite no cambia el resultado (propiedad 4 de TAR §7.2).
 */
function interpolate(segment: Segment, bounds: number[]): { t0: number; t1: number; wh: bigint }[] {
  if (bounds.length === 0) return [{ t0: segment.t0, t1: segment.t1, wh: segment.wh }];
  const pieces: { t0: number; t1: number; wh: bigint }[] = [];
  const span = BigInt(segment.t1 - segment.t0);
  let prevT = segment.t0;
  let prevCum = 0n;
  for (const bound of bounds) {
    const cum = divideRounded(segment.wh * BigInt(bound - segment.t0), span, 'HALF_UP');
    pieces.push({ t0: prevT, t1: bound, wh: cum - prevCum });
    prevT = bound;
    prevCum = cum;
  }
  pieces.push({ t0: prevT, t1: segment.t1, wh: segment.wh - prevCum });
  return pieces;
}

/** Calcula el costo de una sesión a partir del snapshot de tarifa y los eventos OCPP normalizados. */
export function compute(input: ComputeInput): CostResult {
  return new Engine(input).run();
}

/**
 * Componente de precio activo para una dimensión en un instante (inicio de sesión hipotético:
 * 0 kWh acumulados, duración 0, potencia desconocida). Sirve para cotizar "precio ahora".
 */
export function activeComponent(
  tariff: Tariff,
  dimension: PriceComponentType,
  at: Date | string,
  timezone: string,
): { index: number; element: TariffElement; component: PriceComponent } | undefined {
  const ms = typeof at === 'string' ? Date.parse(at) : at.getTime();
  const ctx: MatchContext = {
    local: localParts(ms, timezone),
    cumWh: 0n,
    durationS: 0,
    powerKw: undefined,
  };
  for (let index = 0; index < tariff.elements.length; index += 1) {
    const element = tariff.elements[index] as TariffElement;
    const component = element.price_components.find((c) => c.type === dimension);
    if (component && restrictionsMatch(element.restrictions, ctx))
      return { index, element, component };
  }
  return undefined;
}

/** Orden de presentación de las dimensiones en un recibo. */
export function dimensionOrder(dimension: CostLine['dimension']): number {
  if (dimension === 'ADJUSTMENT') return 10;
  if (dimension === 'CAP') return 20;
  return DIMENSION_ORDER[dimension];
}
