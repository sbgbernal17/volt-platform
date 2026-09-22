/**
 * Servicio de precios sobre la base de datos (TAR §3, §7.3): construye los eventos normalizados de
 * una sesión, invoca el motor puro, guarda cada cálculo con sus líneas (idempotente por hash), lleva
 * el costo en curso y las alertas de exposición, liquida sesiones terminadas y recalcula.
 */
import { randomUUID } from 'node:crypto';
import { formatScaled } from '@volt/domain';
import {
  type Adjustment,
  type ComputeInput,
  type CostLine,
  type CostPolicy,
  type CostResult,
  compute,
  ENGINE_VERSION,
  type SessionEvent,
  type Tariff,
  TariffEngineError,
} from '@volt/tariff-engine';
import type { ISql, Sql } from 'postgres';
import { raiseAlarm, resolveAlarm } from '../alarms.ts';
import { ConflictError, CsmsError, NotFoundError, ValidationError } from '../errors.ts';
import { appendEvent } from '../sessions/outbox.ts';
import type { ChargingSessionRow, OcppTransactionRow, RunningCost } from '../sessions/rows.ts';
import { type CsmsLogger, silentLogger, toJson } from '../types.ts';
import { NoTariffError } from './assignments.ts';
import { resolveParam } from './params.ts';
import { validateTariffDefinition } from './schema.ts';
import {
  currencyExponent,
  freezeSessionSnapshot,
  loadSessionSnapshot,
  type SnapshotRow,
  type TariffSnapshot,
} from './snapshot.ts';
import { getTariffVersionById } from './tariffs.ts';

export interface CostCalcRow {
  id: string;
  session_id: string;
  calc_version: number;
  kind: 'RUNNING' | 'FINAL' | 'RECALC';
  engine_version: string;
  input_hash: string;
  output_hash: string;
  currency: string;
  subtotal_minor: bigint;
  discount_minor: bigint;
  tax_minor: bigint;
  total_minor: bigint;
  capped: boolean;
  flags: string[];
  alerts: string[];
  summary: CostResult['summary'];
  reason: string | null;
  computed_by: string;
  computed_at: Date;
}

export interface CostLineRow {
  id: string;
  calc_id: string;
  seq: number;
  dimension: string;
  element_ref: string | null;
  period_start: Date | null;
  period_end: Date | null;
  quantity: string;
  quantity_raw: bigint | null;
  unit: string;
  unit_price: string;
  amount_minor: bigint;
  tax_rate: string;
  tax_minor: bigint;
}

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

export interface CostCalcJson {
  id: string;
  calcVersion: number;
  kind: string;
  engineVersion: string;
  inputHash: string;
  outputHash: string;
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
  summary: CostResult['summary'];
  reason: string | null;
  computedBy: string;
  computedAt: string;
}

export type SettlementOutcome =
  | { status: 'settled'; calc: CostCalcRow; lines: CostLineRow[]; alreadySettled: boolean }
  | { status: 'waiting'; reason: 'IDLE_OPEN' | 'SETTLE_DELAY'; until: Date | null }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; code: string; message: string };

export interface PricingServiceOptions {
  logger?: CsmsLogger;
  clock?: () => Date;
}

const ENERGY_CONTEXTS = [
  'Sample.Periodic',
  'Sample.Clock',
  'Transaction.Begin',
  'Transaction.End',
  'Trigger',
];
const IDLE_AFTER_STOP: Record<string, boolean> = {
  TRANSACTION_END: true,
  EARLIEST: true,
  SUSPENDED_EV: false,
};

export class PricingService {
  private readonly logger: CsmsLogger;
  private readonly now: () => Date;

  constructor(
    private readonly sql: Sql,
    options: PricingServiceOptions = {},
  ) {
    this.logger = options.logger ?? silentLogger;
    this.now = options.clock ?? (() => new Date());
  }

  // ---- eventos normalizados ----

  /** Eventos del motor a partir de la transacción, las mediciones, el historial de estados y la ocupación. */
  async buildSessionEvents(
    db: ISql,
    session: ChargingSessionRow,
    transaction: OcppTransactionRow | null,
  ): Promise<{ events: SessionEvent[]; flags: string[] }> {
    const events: SessionEvent[] = [];
    const flags = new Set<string>();
    if (!transaction) return { events, flags: [] };
    events.push({
      kind: 'TX_START',
      ts_cp: transaction.started_at_cp.toISOString(),
      ts_srv: transaction.started_received_at.toISOString(),
      meter_start_wh: Number(transaction.meter_start_wh),
    });
    const samples = await db<
      {
        sampled_at: Date;
        received_at: Date;
        measurand: string;
        value_wh: bigint | null;
        value: string;
        unit: string;
      }[]
    >`
      SELECT sampled_at, received_at, measurand, value_wh, value, unit FROM sessions.meter_value
      WHERE transaction_id = ${transaction.id}
        AND measurand IN ('Energy.Active.Import.Register', 'Power.Active.Import')
        AND context = ANY(${ENERGY_CONTEXTS}::sessions.reading_context[]) AND phase = 'NONE' AND signed_data IS NULL
      ORDER BY sampled_at`;
    const byInstant = new Map<
      number,
      { ts: Date; received: Date; wh: number | null; powerW: number | undefined }
    >();
    for (const sample of samples) {
      const key = sample.sampled_at.getTime();
      const entry = byInstant.get(key) ?? {
        ts: sample.sampled_at,
        received: sample.received_at,
        wh: null,
        powerW: undefined,
      };
      if (sample.measurand === 'Energy.Active.Import.Register') {
        if (sample.value_wh !== null) entry.wh = Number(sample.value_wh);
      } else {
        const value = Number(sample.value);
        if (Number.isFinite(value)) entry.powerW = sample.unit === 'kW' ? value * 1000 : value;
      }
      byInstant.set(key, entry);
    }
    for (const entry of byInstant.values()) {
      if (entry.wh === null) continue;
      events.push({
        kind: 'METER',
        ts_cp: entry.ts.toISOString(),
        ts_srv: entry.received.toISOString(),
        register_wh: entry.wh,
        ...(entry.powerW !== undefined ? { power_w: entry.powerW } : {}),
      });
    }
    const statuses = await db<
      { occurred_at: Date; type: string; payload: { payload?: { to?: string } } }[]
    >`
      SELECT occurred_at, type, payload FROM ops.event_outbox
      WHERE aggregate_type = 'session' AND aggregate_id = ${session.id}
        AND type IN ('session.suspended', 'session.resumed')
      ORDER BY id`;
    for (const status of statuses) {
      const to = status.payload.payload?.to;
      const ocpp =
        status.type === 'session.resumed'
          ? 'Charging'
          : to === 'SUSPENDED_EVSE'
            ? 'SuspendedEVSE'
            : 'SuspendedEV';
      const ts = status.occurred_at.toISOString();
      events.push({ kind: 'STATUS', ts_cp: ts, ts_srv: ts, status: ocpp });
    }
    if (
      transaction.state !== 'ACTIVE' &&
      transaction.meter_stop_wh !== null &&
      transaction.stopped_at_cp
    ) {
      events.push({
        kind: 'TX_STOP',
        ts_cp: transaction.stopped_at_cp.toISOString(),
        ts_srv: (transaction.stopped_received_at ?? transaction.stopped_at_cp).toISOString(),
        meter_stop_wh: Number(transaction.meter_stop_wh),
        ...(transaction.stop_reason ? { reason: transaction.stop_reason } : {}),
      });
    }
    if (session.idle_ended_at)
      events.push({ kind: 'IDLE_END', ts: session.idle_ended_at.toISOString() });
    if (transaction.offline_start || transaction.offline_stop) flags.add('OFFLINE');
    if (transaction.state === 'CLOSED_ESTIMATED' || session.end_kind === 'ESTIMATED')
      flags.add('ESTIMATED');
    if (transaction.state === 'ORPHAN') flags.add('ORPHAN');
    for (const flag of session.anomaly_flags ?? [])
      if (flag === 'RETRO_SNAPSHOT' || flag === 'IDLE_TIMEOUT') flags.add(flag);
    return { events, flags: [...flags].sort() };
  }

  /** Entrada del motor a partir del snapshot y los eventos. */
  static computeInput(
    snapshot: TariffSnapshot,
    events: SessionEvent[],
    mode: 'RUNNING' | 'FINAL',
    extra: { now?: Date | undefined; flags?: string[] | undefined } = {},
  ): ComputeInput {
    const tariff: Tariff = snapshot.tariff ?? {
      country_code: 'CO',
      party_id: 'VLT',
      id: 'INTERNAL',
      currency: 'COP',
      elements: [{ price_components: [{ type: 'ENERGY', price: '0', step_size: 1 }] }],
      last_updated: new Date(0).toISOString(),
    };
    return {
      tariff,
      policy: snapshot.policy,
      events,
      mode,
      now: extra.now?.toISOString(),
      exposure_limit_minor:
        snapshot.exposure_limit_minor === null ? undefined : BigInt(snapshot.exposure_limit_minor),
      warn_pct: snapshot.warn_pct,
      tax_included: snapshot.tax_included,
      adjustments: snapshot.adjustments,
      flags: extra.flags,
    };
  }

  // ---- costo en curso ----

  /**
   * Tras cada MeterValues (misma transacción de base de datos que la lectura): recalcula el costo
   * RUNNING, lo guarda en la sesión y emite las alertas de exposición una sola vez cada una.
   */
  async onSample(
    db: ISql,
    input: {
      session: ChargingSessionRow;
      transaction: OcppTransactionRow;
      chargeBoxId: string;
      at: Date;
    },
  ): Promise<RunningCost | null> {
    const snapshot = await loadSessionSnapshot(db, input.session.id);
    if (!snapshot) return null;
    const { events, flags } = await this.buildSessionEvents(db, input.session, input.transaction);
    let result: CostResult;
    try {
      result = compute(
        PricingService.computeInput(snapshot.snapshot, events, 'RUNNING', { now: input.at, flags }),
      );
    } catch (error) {
      this.logger.warn(
        { err: error, sessionId: input.session.id },
        'no se pudo calcular el costo en curso',
      );
      return null;
    }
    const running: RunningCost = {
      currency: snapshot.snapshot.tariff?.currency ?? 'COP',
      tax_included: snapshot.snapshot.tax_included,
      total_minor: result.total_minor.toString(),
      subtotal_minor: result.subtotal_minor.toString(),
      tax_minor: result.tax_minor.toString(),
      discount_minor: result.discount_minor.toString(),
      energy_wh: result.summary.energy_wh,
      alerts: result.alerts,
      flags: result.flags,
      computed_at: input.at.toISOString(),
      engine_version: result.engine_version,
    };
    const warn = result.alerts.includes('PREAUTH_WARN') && !input.session.exposure_warned_at;
    const exhausted =
      result.alerts.includes('PREAUTH_EXHAUSTED') && !input.session.exposure_exhausted_at;
    await db`
      UPDATE sessions.charging_session SET
        running_cost = ${toJson(db as never, running)},
        exposure_warned_at = CASE WHEN ${warn} THEN ${input.at} ELSE exposure_warned_at END,
        exposure_exhausted_at = CASE WHEN ${exhausted} THEN ${input.at} ELSE exposure_exhausted_at END,
        updated_at = now()
      WHERE id = ${input.session.id}`;
    const limit = snapshot.snapshot.exposure_limit_minor;
    if (warn) {
      await appendEvent(db, {
        name: 'session.exposure_warning',
        tenantId: input.session.tenant_id,
        aggregate: { type: 'session', id: input.session.id },
        orderingKey: input.chargeBoxId,
        occurredAt: input.at,
        payload: {
          sessionId: input.session.id,
          chargeBoxId: input.chargeBoxId,
          totalMinor: running.total_minor,
          limitMinor: limit,
          currency: running.currency,
        },
      });
    }
    if (exhausted) {
      await appendEvent(db, {
        name: 'session.exposure_exhausted',
        tenantId: input.session.tenant_id,
        aggregate: { type: 'session', id: input.session.id },
        orderingKey: input.chargeBoxId,
        occurredAt: input.at,
        payload: {
          sessionId: input.session.id,
          chargeBoxId: input.chargeBoxId,
          totalMinor: running.total_minor,
          limitMinor: limit,
          currency: running.currency,
        },
      });
      this.logger.warn(
        {
          sessionId: input.session.id,
          chargeBoxId: input.chargeBoxId,
          total: running.total_minor,
          limit,
        },
        'límite de exposición alcanzado',
      );
    }
    return running;
  }

  // ---- liquidación ----

  /** Sesiones ENDED pendientes de liquidar (worker). Devuelve cuántas quedaron SETTLED. */
  async settlePending(
    options: { limit?: number | undefined; actor?: string | undefined } = {},
  ): Promise<{ settled: number; waiting: number; errors: number }> {
    const rows = await this.sql<{ id: string }[]>`
      SELECT id FROM sessions.charging_session WHERE state = 'ENDED' ORDER BY ended_at LIMIT ${options.limit ?? 100}`;
    const counts = { settled: 0, waiting: 0, errors: 0 };
    for (const row of rows) {
      const outcome = await this.settle(row.id, { actor: options.actor ?? 'system:pricing' });
      if (outcome.status === 'settled') counts.settled += 1;
      else if (outcome.status === 'waiting') counts.waiting += 1;
      else if (outcome.status === 'error') counts.errors += 1;
    }
    return counts;
  }

  /**
   * Liquidación FINAL de una sesión ENDED (TAR §3.5, §3.6): espera el fin de la ocupación cuando la
   * tarifa cobra PARKING_TIME tras la transacción (o el tiempo máximo configurado), calcula, guarda el
   * cálculo con sus líneas y pasa la sesión a SETTLED con sus totales.
   */
  async settle(
    sessionId: string,
    options: { actor: string; force?: boolean | undefined },
  ): Promise<SettlementOutcome> {
    const now = this.now();
    return this.sql.begin(async (tx): Promise<SettlementOutcome> => {
      const rows = await tx<
        ChargingSessionRow[]
      >`SELECT * FROM sessions.charging_session WHERE id = ${sessionId} FOR UPDATE`;
      const session = rows[0];
      if (!session) throw new NotFoundError('session', sessionId);
      if (session.state === 'SETTLED' || session.state === 'PAID') {
        const calc = await this.latestCalc(tx, sessionId);
        if (calc)
          return {
            status: 'settled',
            calc,
            lines: await this.listLines(tx, calc.id),
            alreadySettled: true,
          };
        return { status: 'skipped', reason: `sesión en ${session.state} sin cálculo` };
      }
      if (session.state !== 'ENDED')
        return { status: 'skipped', reason: `sesión en ${session.state}` };

      let snapshot = await loadSessionSnapshot(tx, sessionId);
      if (!snapshot) {
        try {
          snapshot = await freezeSessionSnapshot(tx, {
            session,
            segment: session.is_test ? 'INTERNAL' : 'PUBLIC',
            retro: true,
            at: session.started_at ?? session.requested_at,
          });
          const refreshed = await tx<
            ChargingSessionRow[]
          >`SELECT * FROM sessions.charging_session WHERE id = ${sessionId}`;
          if (refreshed[0]) Object.assign(session, refreshed[0]);
        } catch (error) {
          if (error instanceof NoTariffError) {
            await this.markPricingError(tx, session, 'NO_TARIFF', error.message);
            return { status: 'error', code: 'NO_TARIFF', message: error.message };
          }
          throw error;
        }
      }
      const transaction = session.ocpp_transaction_id
        ? ((
            await tx<
              OcppTransactionRow[]
            >`SELECT * FROM sessions.ocpp_transaction WHERE id = ${session.ocpp_transaction_id}`
          )[0] ?? null)
        : null;

      // Espera del fin de la ocupación (solo cuando la tarifa la cobra tras la transacción).
      if (
        !options.force &&
        this.waitsForIdleEnd(snapshot.snapshot, session) &&
        !session.idle_ended_at
      ) {
        const timeoutS = await resolveParam<number>(tx, 'session.idle_settle_timeout_s', {
          tenantId: session.tenant_id,
        });
        const endedAt = session.ended_at ?? now;
        const deadline = new Date(endedAt.getTime() + timeoutS * 1000);
        if (now < deadline) return { status: 'waiting', reason: 'IDLE_OPEN', until: deadline };
        const cp = await tx<
          { connected: boolean; last_seen_at: Date | null; charge_box_id: string }[]
        >`
          SELECT connected, last_seen_at, charge_box_id FROM assets.charge_point WHERE id = ${session.charge_point_id}`;
        const idleEnd = cp[0]?.connected ? now : (cp[0]?.last_seen_at ?? endedAt);
        await tx`
          UPDATE sessions.charging_session SET idle_ended_at = ${idleEnd},
                 anomaly_flags = CASE WHEN NOT ('IDLE_TIMEOUT' = ANY(anomaly_flags)) THEN array_append(anomaly_flags, 'IDLE_TIMEOUT') ELSE anomaly_flags END,
                 updated_at = now()
          WHERE id = ${sessionId}`;
        session.idle_ended_at = idleEnd;
        session.anomaly_flags = [...(session.anomaly_flags ?? []), 'IDLE_TIMEOUT'];
        await appendEvent(tx, {
          name: 'session.idle_ended',
          tenantId: session.tenant_id,
          aggregate: { type: 'session', id: sessionId },
          orderingKey: cp[0]?.charge_box_id ?? session.charge_point_id,
          occurredAt: now,
          payload: { sessionId, idleEndedAt: idleEnd.toISOString(), reason: 'timeout' },
        });
      }
      if (!options.force) {
        const delayS = await resolveParam<number>(tx, 'session.settle_delay_s', {
          tenantId: session.tenant_id,
        });
        const reference = session.idle_ended_at ?? session.ended_at ?? now;
        const readyAt = new Date(reference.getTime() + delayS * 1000);
        if (now < readyAt) return { status: 'waiting', reason: 'SETTLE_DELAY', until: readyAt };
      }

      const { events, flags } = await this.buildSessionEvents(tx, session, transaction);
      let result: CostResult;
      try {
        result = compute(
          PricingService.computeInput(snapshot.snapshot, events, 'FINAL', { flags }),
        );
      } catch (error) {
        const code = error instanceof TariffEngineError ? error.code : 'ENGINE_ERROR';
        await this.markPricingError(tx, session, code, (error as Error).message);
        return { status: 'error', code, message: (error as Error).message };
      }
      const { calc, lines } = await this.persistCalc(
        tx,
        session,
        snapshot,
        result,
        'FINAL',
        options.actor,
        null,
      );
      const chargeBoxId = await this.identityOf(tx, session.charge_point_id);
      await tx`
        UPDATE sessions.charging_session SET
          state = 'SETTLED', state_changed_at = ${now}, settled_at = ${now},
          currency = ${calc.currency}, subtotal_minor = ${calc.subtotal_minor.toString()}::bigint,
          discount_minor = ${calc.discount_minor.toString()}::bigint, tax_minor = ${calc.tax_minor.toString()}::bigint,
          total_minor = ${calc.total_minor.toString()}::bigint, final_calc_id = ${calc.id},
          payment_status = CASE WHEN ${BigInt(calc.total_minor) === 0n} OR is_test THEN 'WAIVED' ELSE payment_status END,
          pricing_error = NULL, app_seq = app_seq + 1, updated_at = now()
        WHERE id = ${sessionId}`;
      await resolveAlarm(tx as never, `PRICING_FAILED|${sessionId}`, 'liquidada').catch(
        () => undefined,
      );
      const payload = {
        sessionId,
        chargeBoxId,
        calcId: calc.id,
        calcVersion: calc.calc_version,
        currency: calc.currency,
        subtotalMinor: calc.subtotal_minor.toString(),
        discountMinor: calc.discount_minor.toString(),
        taxMinor: calc.tax_minor.toString(),
        totalMinor: calc.total_minor.toString(),
        capped: calc.capped,
        flags: calc.flags,
        lines: lines.length,
        summary: calc.summary,
        taxIncluded: snapshot.snapshot.tax_included,
      };
      await appendEvent(tx, {
        name: 'session.priced',
        tenantId: session.tenant_id,
        aggregate: { type: 'session', id: sessionId },
        orderingKey: chargeBoxId,
        occurredAt: now,
        payload,
      });
      await appendEvent(tx, {
        name: 'session.settled',
        tenantId: session.tenant_id,
        aggregate: { type: 'session', id: sessionId },
        orderingKey: chargeBoxId,
        occurredAt: now,
        payload: { ...payload, isTest: session.is_test },
      });
      this.logger.info(
        { sessionId, total: calc.total_minor.toString(), currency: calc.currency },
        'sesión liquidada',
      );
      return { status: 'settled', calc, lines, alreadySettled: false };
    });
  }

  /** Recalcula una sesión liquidada (llegada tardía, disputa). Mismo hash y motor → mismo cálculo. */
  async recalculate(
    sessionId: string,
    input: { reason: string; actor: string },
  ): Promise<{ calc: CostCalcRow; lines: CostLineRow[]; created: boolean }> {
    const now = this.now();
    return this.sql.begin(async (tx) => {
      const rows = await tx<
        ChargingSessionRow[]
      >`SELECT * FROM sessions.charging_session WHERE id = ${sessionId} FOR UPDATE`;
      const session = rows[0];
      if (!session) throw new NotFoundError('session', sessionId);
      if (session.state !== 'SETTLED' && session.state !== 'PAID') {
        throw new ConflictError(
          `La sesión está en ${session.state}; solo se recalcula una sesión liquidada`,
          'SESSION_NOT_SETTLED',
        );
      }
      const snapshot = await loadSessionSnapshot(tx, sessionId);
      if (!snapshot) throw new NotFoundError('session_tariff_snapshot', sessionId);
      const transaction = session.ocpp_transaction_id
        ? ((
            await tx<
              OcppTransactionRow[]
            >`SELECT * FROM sessions.ocpp_transaction WHERE id = ${session.ocpp_transaction_id}`
          )[0] ?? null)
        : null;
      const { events, flags } = await this.buildSessionEvents(tx, session, transaction);
      const result = compute(
        PricingService.computeInput(snapshot.snapshot, events, 'FINAL', { flags }),
      );
      const existing = await tx<CostCalcRow[]>`
        SELECT * FROM tariffs.session_cost_calc
        WHERE session_id = ${sessionId} AND input_hash = ${result.input_hash} AND engine_version = ${result.engine_version}`;
      if (existing[0]) {
        return {
          calc: existing[0],
          lines: await this.listLines(tx, existing[0].id),
          created: false,
        };
      }
      const { calc, lines } = await this.persistCalc(
        tx,
        session,
        snapshot,
        result,
        'RECALC',
        input.actor,
        input.reason,
      );
      await tx`
        UPDATE sessions.charging_session SET
          subtotal_minor = ${calc.subtotal_minor.toString()}::bigint, discount_minor = ${calc.discount_minor.toString()}::bigint,
          tax_minor = ${calc.tax_minor.toString()}::bigint, total_minor = ${calc.total_minor.toString()}::bigint,
          final_calc_id = ${calc.id}, app_seq = app_seq + 1, updated_at = now()
        WHERE id = ${sessionId}`;
      const chargeBoxId = await this.identityOf(tx, session.charge_point_id);
      await appendEvent(tx, {
        name: 'session.priced',
        tenantId: session.tenant_id,
        aggregate: { type: 'session', id: sessionId },
        orderingKey: chargeBoxId,
        occurredAt: now,
        payload: {
          sessionId,
          chargeBoxId,
          calcId: calc.id,
          calcVersion: calc.calc_version,
          kind: 'RECALC',
          reason: input.reason,
          totalMinor: calc.total_minor.toString(),
          currency: calc.currency,
        },
      });
      return { calc, lines, created: true };
    });
  }

  // ---- consultas ----

  async getSessionCost(db: ISql, sessionId: string): Promise<SessionCostView> {
    const rows = await db<
      ChargingSessionRow[]
    >`SELECT * FROM sessions.charging_session WHERE id = ${sessionId}`;
    const session = rows[0];
    if (!session) throw new NotFoundError('session', sessionId);
    const snapshot = await loadSessionSnapshot(db, sessionId);
    const calcs = await db<CostCalcRow[]>`
      SELECT * FROM tariffs.session_cost_calc WHERE session_id = ${sessionId} ORDER BY calc_version DESC`;
    const finalCalc = session.final_calc_id
      ? calcs.find((c) => c.id === session.final_calc_id)
      : undefined;
    const lines = finalCalc ? await this.listLines(db, finalCalc.id) : [];
    return {
      session_id: sessionId,
      state: session.state,
      currency: session.currency,
      segment: session.tariff_segment,
      snapshot: snapshot
        ? {
            tariff_code: snapshot.snapshot.tariff_code,
            tariff_version: snapshot.snapshot.tariff_version,
            tax_included: snapshot.snapshot.tax_included,
            snapshot_hash: snapshot.snapshot_hash,
            frozen_at: snapshot.frozen_at.toISOString(),
            retro: snapshot.retro,
          }
        : null,
      running: session.running_cost ?? null,
      final: finalCalc
        ? {
            ...toCalcJson(finalCalc),
            lines: lines.map((l) => toLineJson(l, currencyExponent(finalCalc.currency))),
          }
        : null,
      calcs: calcs.map(toCalcJson),
    };
  }

  async latestCalc(db: ISql, sessionId: string): Promise<CostCalcRow | undefined> {
    const rows = await db<CostCalcRow[]>`
      SELECT * FROM tariffs.session_cost_calc WHERE session_id = ${sessionId} ORDER BY calc_version DESC LIMIT 1`;
    return rows[0];
  }

  async listLines(db: ISql, calcId: string): Promise<CostLineRow[]> {
    return db<
      CostLineRow[]
    >`SELECT * FROM tariffs.session_cost_line WHERE calc_id = ${calcId} ORDER BY seq`;
  }

  // ---- simulación ----

  /** Escenario sintético o eventos explícitos contra una definición o una versión guardada (TAR §7.3 Simulate). */
  async simulate(db: ISql, input: SimulateInput): Promise<CostResult> {
    let tariff: Tariff;
    let taxIncluded = input.taxIncluded ?? true;
    if (input.tariffVersionId) {
      const version = await getTariffVersionById(db, input.tariffVersionId);
      tariff = version.definition;
      taxIncluded = input.taxIncluded ?? version.tax_included;
    } else if (input.tariff !== undefined) {
      tariff = validateTariffDefinition(input.tariff).definition;
    } else {
      throw new ValidationError('Hace falta tariff (definición) o tariffVersionId');
    }
    const timezone = input.timezone ?? 'America/Bogota';
    const policy: CostPolicy = {
      rounding: input.rounding ?? 'HALF_UP',
      tax_rounding: input.taxRounding ?? 'PER_LINE',
      currency_exponent: currencyExponent(tariff.currency),
      timezone,
    };
    const events = input.events ?? (input.scenario ? scenarioEvents(input.scenario) : undefined);
    if (!events) throw new ValidationError('Hace falta events o scenario');
    return compute({
      tariff,
      policy,
      events,
      mode: input.mode ?? 'FINAL',
      now: input.now,
      exposure_limit_minor:
        input.exposureLimitMinor === undefined ? undefined : BigInt(input.exposureLimitMinor),
      warn_pct: input.warnPct,
      tax_included: taxIncluded,
      adjustments: input.adjustments,
    });
  }

  // ---- internos ----

  private waitsForIdleEnd(snapshot: TariffSnapshot, session: ChargingSessionRow): boolean {
    const tariff = snapshot.tariff;
    if (!tariff) return false;
    const parking = tariff.elements.find((e) =>
      e.price_components.some((c) => c.type === 'PARKING_TIME'),
    );
    if (!parking) return false;
    if (!(IDLE_AFTER_STOP[parking.x_volt?.idle_start ?? 'EARLIEST'] ?? true)) return false;
    if (
      session.stop_reason === 'EVDisconnected' ||
      session.stop_reason === 'PowerLoss' ||
      session.stop_reason === 'Reboot' ||
      session.stop_reason === 'HardReset'
    )
      return false;
    if (session.end_kind !== 'NORMAL') return false;
    return true;
  }

  private async persistCalc(
    db: ISql,
    session: ChargingSessionRow,
    snapshot: SnapshotRow,
    result: CostResult,
    kind: 'FINAL' | 'RECALC',
    actor: string,
    reason: string | null,
  ): Promise<{ calc: CostCalcRow; lines: CostLineRow[] }> {
    const existing = await db<CostCalcRow[]>`
      SELECT * FROM tariffs.session_cost_calc
      WHERE session_id = ${session.id} AND input_hash = ${result.input_hash} AND engine_version = ${result.engine_version}`;
    if (existing[0]) return { calc: existing[0], lines: await this.listLines(db, existing[0].id) };
    const next = await db<{ version: number }[]>`
      SELECT COALESCE(MAX(calc_version), 0) + 1 AS version FROM tariffs.session_cost_calc WHERE session_id = ${session.id}`;
    const currency = snapshot.snapshot.tariff?.currency ?? session.currency ?? 'COP';
    const calcRows = await db<CostCalcRow[]>`
      INSERT INTO tariffs.session_cost_calc
        (id, session_id, calc_version, kind, engine_version, input_hash, output_hash, currency, subtotal_minor, discount_minor,
         tax_minor, total_minor, capped, flags, alerts, summary, reason, computed_by, computed_at)
      VALUES (${randomUUID()}, ${session.id}, ${next[0]?.version ?? 1}, ${kind}, ${result.engine_version}, ${result.input_hash},
              ${result.output_hash}, ${currency}, ${result.subtotal_minor.toString()}::bigint, ${result.discount_minor.toString()}::bigint,
              ${result.tax_minor.toString()}::bigint, ${result.total_minor.toString()}::bigint, ${result.capped}, ${result.flags}::text[],
              ${result.alerts}::text[], ${toJson(db as never, result.summary)}, ${reason}, ${actor}, ${this.now()})
      RETURNING *`;
    const calc = calcRows[0] as CostCalcRow;
    if (result.lines.length > 0) {
      const values = result.lines.map((line: CostLine) => ({
        id: randomUUID(),
        seq: line.seq,
        dimension: line.dimension,
        element_ref: line.element_ref,
        period_start: line.period_start ?? null,
        period_end: line.period_end ?? null,
        quantity: line.quantity,
        quantity_raw: line.quantity_raw.toString(),
        unit: line.unit,
        unit_price: line.unit_price,
        amount_minor: line.amount_minor.toString(),
        tax_rate: line.tax_rate === '' ? '0' : line.tax_rate,
        tax_minor: line.tax_minor.toString(),
      }));
      await db`
        INSERT INTO tariffs.session_cost_line
          (id, calc_id, seq, dimension, element_ref, period_start, period_end, quantity, quantity_raw, unit, unit_price, amount_minor, tax_rate, tax_minor)
        SELECT r.id::uuid, ${calc.id}::uuid, r.seq, r.dimension, r.element_ref, r.period_start::timestamptz, r.period_end::timestamptz,
               r.quantity::numeric, r.quantity_raw::bigint, r.unit, r.unit_price::numeric, r.amount_minor::bigint, r.tax_rate::numeric, r.tax_minor::bigint
        FROM jsonb_to_recordset(${toJson(db as never, values)}::jsonb)
          AS r(id text, seq int, dimension text, element_ref text, period_start text, period_end text, quantity text, quantity_raw text,
               unit text, unit_price text, amount_minor text, tax_rate text, tax_minor text)`;
    }
    return { calc, lines: await this.listLines(db, calc.id) };
  }

  private async markPricingError(
    db: ISql,
    session: ChargingSessionRow,
    code: string,
    message: string,
  ): Promise<void> {
    await db`UPDATE sessions.charging_session SET pricing_error = ${code}, updated_at = now() WHERE id = ${session.id}`;
    await raiseAlarm(db as never, {
      tenantId: session.tenant_id,
      chargePointId: session.charge_point_id,
      siteId: session.site_id,
      kind: 'PRICING_FAILED',
      severity: 'WARNING',
      fingerprint: `PRICING_FAILED|${session.id}`,
      details: { sessionId: session.id, code, message },
    });
    this.logger.warn({ sessionId: session.id, code, message }, 'no se pudo liquidar la sesión');
  }

  private async identityOf(db: ISql, chargePointId: string): Promise<string> {
    const rows = await db<
      { charge_box_id: string }[]
    >`SELECT charge_box_id FROM assets.charge_point WHERE id = ${chargePointId}`;
    return rows[0]?.charge_box_id ?? chargePointId;
  }
}

export interface SimulateScenario {
  /** Instante de inicio (ISO con desfase o UTC). */
  startAt: string;
  durationMin: number;
  energyWh: number;
  /** Minutos tras el inicio en que el vehículo deja de cargar (SuspendedEV); sin valor carga hasta el final. */
  suspendedAfterMin?: number | undefined;
  /** Minutos que el vehículo sigue conectado tras StopTransaction. */
  idleMin?: number | undefined;
  sampleEveryMin?: number | undefined;
  stopReason?: string | undefined;
  meterStartWh?: number | undefined;
  powerW?: number | undefined;
}

export interface SimulateInput {
  tariff?: unknown;
  tariffVersionId?: string | undefined;
  timezone?: string | undefined;
  rounding?: CostPolicy['rounding'] | undefined;
  taxRounding?: CostPolicy['tax_rounding'] | undefined;
  taxIncluded?: boolean | undefined;
  adjustments?: Adjustment[] | undefined;
  exposureLimitMinor?: string | number | undefined;
  warnPct?: number | undefined;
  mode?: 'RUNNING' | 'FINAL' | undefined;
  now?: string | undefined;
  events?: SessionEvent[] | undefined;
  scenario?: SimulateScenario | undefined;
}

/** Eventos sintéticos de un escenario lineal (energía uniforme mientras carga). */
export function scenarioEvents(scenario: SimulateScenario): SessionEvent[] {
  const startMs = Date.parse(scenario.startAt);
  if (!Number.isFinite(startMs)) throw new ValidationError('scenario.startAt inválido');
  if (scenario.durationMin <= 0)
    throw new ValidationError('scenario.durationMin debe ser positivo');
  const chargingMin = Math.min(
    scenario.durationMin,
    scenario.suspendedAfterMin ?? scenario.durationMin,
  );
  const meterStart = scenario.meterStartWh ?? 0;
  const every = Math.max(1, scenario.sampleEveryMin ?? 5);
  const iso = (min: number) => new Date(startMs + min * 60_000).toISOString();
  const powerW =
    scenario.powerW ?? (chargingMin > 0 ? Math.round((scenario.energyWh * 60) / chargingMin) : 0);
  const events: SessionEvent[] = [
    { kind: 'TX_START', ts_cp: iso(0), ts_srv: iso(0), meter_start_wh: meterStart },
  ];
  for (let min = every; min < scenario.durationMin; min += every) {
    const charged = Math.min(min, chargingMin);
    const register = meterStart + Math.round((scenario.energyWh * charged) / chargingMin);
    events.push({
      kind: 'METER',
      ts_cp: iso(min),
      ts_srv: iso(min),
      register_wh: register,
      power_w: min <= chargingMin ? powerW : 0,
    });
  }
  if (
    scenario.suspendedAfterMin !== undefined &&
    scenario.suspendedAfterMin < scenario.durationMin
  ) {
    const ts = iso(scenario.suspendedAfterMin);
    events.push({ kind: 'STATUS', ts_cp: ts, ts_srv: ts, status: 'SuspendedEV' });
  }
  const stop = iso(scenario.durationMin);
  events.push({
    kind: 'TX_STOP',
    ts_cp: stop,
    ts_srv: stop,
    meter_stop_wh: meterStart + scenario.energyWh,
    reason: scenario.stopReason ?? 'Remote',
  });
  const finishing = new Date(startMs + scenario.durationMin * 60_000 + 2000).toISOString();
  events.push({ kind: 'STATUS', ts_cp: finishing, ts_srv: finishing, status: 'Finishing' });
  const idleEnd = iso(scenario.durationMin + (scenario.idleMin ?? 0));
  events.push({ kind: 'STATUS', ts_cp: idleEnd, ts_srv: idleEnd, status: 'Available' });
  return events;
}

export function toCalcJson(calc: CostCalcRow): CostCalcJson {
  const exponent = currencyExponent(calc.currency);
  return {
    id: calc.id,
    calcVersion: calc.calc_version,
    kind: calc.kind,
    engineVersion: calc.engine_version,
    inputHash: calc.input_hash,
    outputHash: calc.output_hash,
    currency: calc.currency,
    subtotal: formatScaled(BigInt(calc.subtotal_minor), exponent),
    discount: formatScaled(BigInt(calc.discount_minor), exponent),
    tax: formatScaled(BigInt(calc.tax_minor), exponent),
    total: formatScaled(BigInt(calc.total_minor), exponent),
    subtotalMinor: calc.subtotal_minor.toString(),
    discountMinor: calc.discount_minor.toString(),
    taxMinor: calc.tax_minor.toString(),
    totalMinor: calc.total_minor.toString(),
    capped: calc.capped,
    flags: calc.flags,
    alerts: calc.alerts,
    summary: calc.summary,
    reason: calc.reason,
    computedBy: calc.computed_by,
    computedAt: calc.computed_at.toISOString(),
  };
}

export function toLineJson(line: CostLineRow, exponent: number): CostLineJson {
  const amount = BigInt(line.amount_minor);
  const tax = BigInt(line.tax_minor);
  return {
    seq: line.seq,
    dimension: line.dimension,
    elementRef: line.element_ref,
    periodStart: line.period_start?.toISOString() ?? null,
    periodEnd: line.period_end?.toISOString() ?? null,
    quantity: trimNumeric(line.quantity),
    unit: line.unit,
    unitPrice: trimNumeric(line.unit_price),
    amount: formatScaled(amount, exponent),
    amountMinor: amount.toString(),
    taxRate: trimNumeric(line.tax_rate),
    tax: formatScaled(tax, exponent),
    taxMinor: tax.toString(),
    total: formatScaled(amount + tax, exponent),
  };
}

/** Resultado del motor serializable en JSON (bigint como texto e importes en unidades mayores). */
export function toCostResultJson(result: CostResult, currency: string) {
  const exponent = currencyExponent(currency);
  return {
    currency,
    lines: result.lines.map((line) => ({
      seq: line.seq,
      dimension: line.dimension,
      elementRef: line.element_ref,
      periodStart: line.period_start ?? null,
      periodEnd: line.period_end ?? null,
      quantity: line.quantity,
      quantityRaw: line.quantity_raw.toString(),
      unit: line.unit,
      unitPrice: line.unit_price,
      amount: formatScaled(line.amount_minor, exponent),
      amountMinor: line.amount_minor.toString(),
      taxRate: line.tax_rate,
      tax: formatScaled(line.tax_minor, exponent),
      taxMinor: line.tax_minor.toString(),
      total: formatScaled(line.amount_minor + line.tax_minor, exponent),
    })),
    subtotal: formatScaled(result.subtotal_minor, exponent),
    discount: formatScaled(result.discount_minor, exponent),
    tax: formatScaled(result.tax_minor, exponent),
    total: formatScaled(result.total_minor, exponent),
    subtotalMinor: result.subtotal_minor.toString(),
    discountMinor: result.discount_minor.toString(),
    taxMinor: result.tax_minor.toString(),
    totalMinor: result.total_minor.toString(),
    capped: result.capped,
    flags: result.flags,
    alerts: result.alerts,
    summary: result.summary,
    inputHash: result.input_hash,
    outputHash: result.output_hash,
    engineVersion: result.engine_version,
  };
}

function trimNumeric(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

export { CsmsError, ENGINE_VERSION };
