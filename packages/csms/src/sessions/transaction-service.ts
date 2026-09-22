import {
  assertSessionTransition,
  type LifecycleState,
  type SessionState,
  STOP_REASONS,
  type StopReason,
} from '@volt/domain';
import type { ISql, Sql } from 'postgres';
import { raiseAlarm } from '../alarms.ts';
import { transitionLifecycle } from '../lifecycle.ts';
import { PricingService } from '../pricing/pricing-service.ts';
import { type CsmsLogger, silentLogger, toJson } from '../types.ts';
import { appendEvent } from './outbox.ts';
import {
  type ChargingSessionRow,
  LIVE_SESSION_STATES,
  type OcppTransactionRow,
  type SessionSample,
} from './rows.ts';
import { type AuthorizationStatus, evaluateIdTag, setTokenStatus } from './tokens.ts';

/** Cargador que envía el mensaje, tal como lo conoce el gateway. */
export interface InboundChargePoint {
  id: string;
  identity: string;
  tenantId: string;
  lifecycle: LifecycleState;
}

/** Contexto de un mensaje entrante: conexión, hora de recepción y trazabilidad. */
export interface InboundContext {
  chargePoint: InboundChargePoint;
  uniqueId: string;
  receivedAt: Date;
  /** Inicio de la conexión WebSocket actual: lo anterior llegó encolado (offline). */
  connectedAt: Date;
  heartbeatIntervalS: number;
  generation: number;
}

export interface StartTransactionParams {
  connectorId: number;
  idTag: string;
  meterStart: number;
  timestamp: string;
  reservationId?: number | undefined;
}

export interface StartTransactionResult {
  transactionId: number;
  idTagInfo: { status: AuthorizationStatus; expiryDate?: string };
  duplicate: boolean;
  sessionId: string | null;
}

export interface MeterValuesParams {
  connectorId: number;
  transactionId?: number | undefined;
  meterValue: {
    timestamp: string;
    sampledValue: {
      value: string;
      context?: string | undefined;
      format?: string | undefined;
      measurand?: string | undefined;
      phase?: string | undefined;
      location?: string | undefined;
      unit?: string | undefined;
    }[];
  }[];
}

export interface StopTransactionParams {
  transactionId: number;
  meterStop: number;
  timestamp: string;
  reason?: string | undefined;
  idTag?: string | undefined;
  transactionData?: MeterValuesParams['meterValue'] | undefined;
}

export interface StopTransactionResult {
  idTagInfo?: { status: AuthorizationStatus } | undefined;
  sessionId: string | null;
  duplicate: boolean;
  orphan: boolean;
}

/** Gancho de precios invocado tras cada lectura, en la misma transacción de base de datos. */
export interface SessionPricingHook {
  onSample(
    db: ISql,
    input: {
      session: ChargingSessionRow;
      transaction: OcppTransactionRow;
      chargeBoxId: string;
      at: Date;
    },
  ): Promise<unknown>;
}

export interface TransactionServiceOptions {
  logger?: CsmsLogger;
  clock?: () => Date;
  /** Servicio de precios (por defecto el real; las pruebas pueden sustituirlo). */
  pricing?: SessionPricingHook;
  /** Salto máximo verosímil del registro de energía entre lecturas (FUN M04 `max_energy_jump_kwh`). */
  maxEnergyJumpWh?: number;
  /** Ventana en la que un StartTransaction tardío reabre una sesión EXPIRED (DAT §5.7). */
  lateStartWindowS?: number;
  /** Tolerancia al comparar el sello del cargador con el inicio de la conexión. */
  offlineToleranceS?: number;
}

const SINGLE_USE_TOKEN_TYPES = new Set(['APP', 'QR', 'OPERATOR', 'TEST']);
const ENERGY_REGISTER = 'Energy.Active.Import.Register';
/** Estados de conector que indican que el vehículo dejó libre el conector (fin de la ocupación, TAR §3.6). */
const IDLE_END_STATUSES = new Set(['Available', 'Preparing', 'Unavailable', 'Faulted', 'Reserved']);

interface ConnectorRef {
  connector_id: string;
  evse_id: string;
  site_id: string;
}

/**
 * Transacciones OCPP y su efecto sobre las sesiones (DAT §3.2, §5): StartTransaction siempre
 * aceptado e idempotente, MeterValues con mapeo y anomalías, StopTransaction con propiedad por
 * cargador, duplicados y huérfanas, y transiciones de sesión por StatusNotification. Todo
 * cambio de estado escribe su evento en el outbox dentro de la misma transacción.
 */
export class TransactionService {
  private readonly logger: CsmsLogger;
  private readonly now: () => Date;
  private readonly maxEnergyJumpWh: number;
  private readonly lateStartWindowS: number;
  private readonly offlineToleranceS: number;
  private readonly pricing: SessionPricingHook;

  constructor(
    private readonly sql: Sql,
    options: TransactionServiceOptions = {},
  ) {
    this.logger = options.logger ?? silentLogger;
    this.now = options.clock ?? (() => new Date());
    this.maxEnergyJumpWh = options.maxEnergyJumpWh ?? 50_000;
    this.lateStartWindowS = options.lateStartWindowS ?? 600;
    this.offlineToleranceS = options.offlineToleranceS ?? 5;
    this.pricing =
      options.pricing ?? new PricingService(sql, { logger: this.logger, clock: this.now });
  }

  /** Authorize.req: solo tokens emitidos por la plataforma (SEG S4). */
  async authorize(
    ctx: InboundContext,
    idTag: string,
  ): Promise<{ idTagInfo: { status: AuthorizationStatus; expiryDate?: string } }> {
    const evaluation = await evaluateIdTag(this.sql, {
      tenantId: ctx.chargePoint.tenantId,
      chargePointId: ctx.chargePoint.id,
      lifecycle: ctx.chargePoint.lifecycle,
      idTag,
      now: ctx.receivedAt,
    });
    await appendEvent(this.sql, {
      name: evaluation.status === 'Accepted' ? 'authorization.granted' : 'authorization.denied',
      tenantId: ctx.chargePoint.tenantId,
      aggregate: { type: 'charge_point', id: ctx.chargePoint.id },
      orderingKey: ctx.chargePoint.identity,
      occurredAt: ctx.receivedAt,
      payload: {
        chargeBoxId: ctx.chargePoint.identity,
        idTag: mask(idTag),
        status: evaluation.status,
        tokenType: evaluation.token?.token_type ?? null,
      },
    });
    const expiry = evaluation.token?.valid_until;
    return {
      idTagInfo: {
        status: evaluation.status,
        ...(evaluation.status === 'Accepted' && expiry ? { expiryDate: expiry.toISOString() } : {}),
      },
    };
  }

  /** StartTransaction.req (DAT §5.1, §5.7, §5.8, §5.10, §5.12). */
  async startTransaction(
    ctx: InboundContext,
    params: StartTransactionParams,
  ): Promise<StartTransactionResult> {
    const cp = ctx.chargePoint;
    const startedAtCp = parseTimestamp(params.timestamp, ctx.receivedAt);
    return this.sql.begin(async (tx) => {
      const existing = await tx<OcppTransactionRow[]>`
        SELECT * FROM sessions.ocpp_transaction
        WHERE charge_point_id = ${cp.id} AND ocpp_connector_id = ${params.connectorId}
          AND started_at_cp = ${startedAtCp} AND meter_start_wh = ${params.meterStart}::bigint
          AND upper(id_tag) = upper(${params.idTag})`;
      const duplicate = existing[0];
      if (duplicate) {
        return {
          transactionId: duplicate.ocpp_transaction_id,
          idTagInfo: { status: duplicate.id_tag_status as AuthorizationStatus },
          duplicate: true,
          sessionId: duplicate.session_id,
        };
      }
      const connector = await this.resolveConnector(tx, cp, params.connectorId);
      await this.endIdle(tx, cp, params.connectorId, startedAtCp, 'new_transaction');
      const evaluation = await evaluateIdTag(tx, {
        tenantId: cp.tenantId,
        chargePointId: cp.id,
        lifecycle: cp.lifecycle,
        idTag: params.idTag,
        now: ctx.receivedAt,
      });
      const offlineStart = this.isOffline(ctx, startedAtCp);
      const clockOffsetS = offlineStart
        ? null
        : Math.round((ctx.receivedAt.getTime() - startedAtCp.getTime()) / 1000);

      // Una transacción activa previa en el mismo conector se cierra como estimada (DAT §5.8).
      const previous = await tx<OcppTransactionRow[]>`
        SELECT * FROM sessions.ocpp_transaction
        WHERE charge_point_id = ${cp.id} AND ocpp_connector_id = ${params.connectorId} AND state = 'ACTIVE' FOR UPDATE`;
      for (const active of previous) {
        await this.closeEstimated(
          tx,
          active,
          ctx.receivedAt,
          'nuevo StartTransaction en el mismo conector',
        );
      }

      const session = await this.findSessionForStart(
        tx,
        cp,
        connector,
        params.idTag,
        evaluation.token?.driver_id ?? null,
        ctx.receivedAt,
      );
      const seq = await tx<
        { id: number }[]
      >`SELECT nextval('sessions.ocpp_transaction_id_seq')::int AS id`;
      const transactionId = seq[0]?.id ?? 0;
      const rows = await tx<OcppTransactionRow[]>`
        INSERT INTO sessions.ocpp_transaction
          (id, tenant_id, charge_point_id, evse_id, ocpp_connector_id, ocpp_transaction_id, ocpp_transaction_ref,
           session_id, id_tag, id_tag_status, reservation_ocpp_id, meter_start_wh, started_at_cp, started_received_at,
           offline_start, clock_offset_s, start_unique_id)
        VALUES (gen_random_uuid(), ${cp.tenantId}, ${cp.id}, ${connector.evse_id}, ${params.connectorId}, ${transactionId},
                ${String(transactionId)}, ${session?.id ?? null}, ${params.idTag}, ${evaluation.status},
                ${params.reservationId ?? null}, ${params.meterStart}::bigint, ${startedAtCp}, ${ctx.receivedAt},
                ${offlineStart}, ${clockOffsetS}, ${ctx.uniqueId})
        RETURNING *`;
      const transaction = rows[0] as OcppTransactionRow;
      await tx`UPDATE assets.connector SET current_transaction_id = ${transaction.id} WHERE id = ${connector.connector_id}`;

      const startedAt = offlineStart ? startedAtCp : ctx.receivedAt;
      let sessionId: string;
      if (session) {
        const flags = session.state === 'EXPIRED' ? ['LATE_START'] : [];
        assertSessionTransition(session.state, 'CHARGING');
        await tx`
          UPDATE sessions.charging_session SET
            state = 'CHARGING', state_changed_at = ${ctx.receivedAt}, started_at = ${startedAt},
            ocpp_transaction_id = ${transaction.id}, connector_id = ${connector.connector_id},
            end_kind = NULL, failure_code = NULL,
            anomaly_flags = anomaly_flags || ${flags}::text[], app_seq = app_seq + 1, updated_at = now()
          WHERE id = ${session.id}`;
        sessionId = session.id;
      } else {
        sessionId = await this.createUnsolicitedSession(
          tx,
          cp,
          connector,
          transaction,
          evaluation.token,
          startedAt,
          ctx.receivedAt,
        );
        await tx`UPDATE sessions.ocpp_transaction SET session_id = ${sessionId} WHERE id = ${transaction.id}`;
      }
      if (evaluation.token) {
        await tx`UPDATE auth.id_token SET last_used_at = ${ctx.receivedAt}, last_charge_point_id = ${cp.id} WHERE id = ${evaluation.token.id}`;
      }
      await appendEvent(tx, {
        name: 'session.started',
        tenantId: cp.tenantId,
        aggregate: { type: 'session', id: sessionId },
        orderingKey: cp.identity,
        occurredAt: ctx.receivedAt,
        payload: {
          sessionId,
          chargeBoxId: cp.identity,
          connectorId: params.connectorId,
          ocppTransactionId: transactionId,
          idTagStatus: evaluation.status,
          meterStartWh: params.meterStart,
          startedAtChargePoint: startedAtCp.toISOString(),
          offlineStart,
          unsolicited: !session,
        },
      });
      return {
        transactionId,
        idTagInfo: { status: evaluation.status },
        duplicate: false,
        sessionId,
      };
    });
  }

  /** MeterValues.req (DAT §5.2, §5.3). */
  async recordMeterValues(
    ctx: InboundContext,
    params: MeterValuesParams,
  ): Promise<{ transactionId: string | null; samples: number }> {
    const cp = ctx.chargePoint;
    return this.sql.begin(async (tx) => {
      let transaction: OcppTransactionRow | undefined;
      let unmapped = false;
      if (params.transactionId !== undefined) {
        const rows = await tx<OcppTransactionRow[]>`
          SELECT * FROM sessions.ocpp_transaction
          WHERE charge_point_id = ${cp.id} AND ocpp_transaction_id = ${params.transactionId} FOR UPDATE`;
        transaction = rows[0];
        if (!transaction) unmapped = true;
      }
      if (!transaction) {
        const rows = await tx<OcppTransactionRow[]>`
          SELECT * FROM sessions.ocpp_transaction
          WHERE charge_point_id = ${cp.id} AND ocpp_connector_id = ${params.connectorId} AND state = 'ACTIVE' FOR UPDATE`;
        transaction = rows[0];
      }
      const samples = flattenSamples(params.meterValue, ctx.receivedAt);
      if (samples.length > 0) {
        await tx`
          INSERT INTO sessions.meter_value
            (tenant_id, charge_point_id, ocpp_connector_id, transaction_id, sampled_at, received_at, measurand, context,
             phase, location, unit, value, signed_data, source)
          SELECT ${cp.tenantId}::uuid, ${cp.id}::uuid, ${params.connectorId}, ${transaction?.id ?? null}::uuid,
                 r.sampled_at::timestamptz, ${ctx.receivedAt}, r.measurand::sessions.measurand,
                 r.context::sessions.reading_context, r.phase::sessions.phase, r.location::sessions.mv_location,
                 r.unit::sessions.unit, r.value, r.signed_data, 'MeterValues'
          FROM jsonb_to_recordset(${toJson(tx as never, samples)}::jsonb)
            AS r(sampled_at text, measurand text, context text, phase text, location text, unit text, value numeric, signed_data text)
          ON CONFLICT DO NOTHING`;
      }
      if (unmapped && transaction) {
        await tx`
          UPDATE sessions.ocpp_transaction SET anomaly_flags = array_append(anomaly_flags, 'UNMAPPED_TX')
          WHERE id = ${transaction.id} AND NOT ('UNMAPPED_TX' = ANY(anomaly_flags))`;
      }
      if (transaction?.session_id) {
        await this.updateSessionSample(tx, cp, transaction, samples, ctx.receivedAt);
      }
      return { transactionId: transaction?.id ?? null, samples: samples.length };
    });
  }

  /** StopTransaction.req (DAT §5.1, §5.5, §5.10). */
  async stopTransaction(
    ctx: InboundContext,
    params: StopTransactionParams,
  ): Promise<StopTransactionResult> {
    const cp = ctx.chargePoint;
    const stoppedAtCp = parseTimestamp(params.timestamp, ctx.receivedAt);
    const reason: StopReason = (STOP_REASONS as readonly string[]).includes(params.reason ?? '')
      ? (params.reason as StopReason)
      : 'Local';
    const response = (): StopTransactionResult['idTagInfo'] =>
      params.idTag ? { status: 'Accepted' as AuthorizationStatus } : undefined;
    const outcome = await this.sql.begin(async (tx) => {
      const rows = await tx<OcppTransactionRow[]>`
        SELECT * FROM sessions.ocpp_transaction
        WHERE charge_point_id = ${cp.id} AND ocpp_transaction_id = ${params.transactionId} FOR UPDATE`;
      const transaction = rows[0];
      if (!transaction) {
        await this.handleOrphanStop(tx, ctx, params, stoppedAtCp, reason);
        return {
          idTagInfo: response(),
          sessionId: null,
          duplicate: false,
          orphan: true,
          lifecycleCheck: null,
        };
      }
      if (transaction.state !== 'ACTIVE') {
        const same =
          Number(transaction.meter_stop_wh ?? -1) === params.meterStop &&
          (transaction.stop_reason ?? 'Local') === reason;
        if (!same) {
          await tx`
            UPDATE sessions.ocpp_transaction SET anomaly_flags = array_append(anomaly_flags, 'DUPLICATE_STOP')
            WHERE id = ${transaction.id} AND NOT ('DUPLICATE_STOP' = ANY(anomaly_flags))`;
          this.logger.warn(
            { chargeBoxId: cp.identity, transactionId: params.transactionId },
            'StopTransaction repetido con datos distintos',
          );
        }
        return {
          idTagInfo: response(),
          sessionId: transaction.session_id,
          duplicate: true,
          orphan: false,
          lifecycleCheck: null,
        };
      }
      const offlineStop = this.isOffline(ctx, stoppedAtCp);
      const decreasing = params.meterStop < Number(transaction.meter_start_wh);
      await tx`
        UPDATE sessions.ocpp_transaction SET
          state = 'STOPPED', meter_stop_wh = ${params.meterStop}::bigint, stopped_at_cp = ${stoppedAtCp},
          stopped_received_at = ${ctx.receivedAt}, stop_reason = ${reason}::sessions.stop_reason,
          stop_id_tag = ${params.idTag ?? null}, transaction_data = ${params.transactionData ? toJson(tx as never, params.transactionData) : null},
          offline_stop = ${offlineStop}, stop_unique_id = ${ctx.uniqueId},
          anomaly_flags = CASE WHEN ${decreasing} AND NOT ('METER_DECREASING' = ANY(anomaly_flags))
                               THEN array_append(anomaly_flags, 'METER_DECREASING') ELSE anomaly_flags END,
          updated_at = now()
        WHERE id = ${transaction.id}`;
      const samples = flattenSamples(params.transactionData ?? [], ctx.receivedAt);
      if (samples.length > 0) {
        await tx`
          INSERT INTO sessions.meter_value
            (tenant_id, charge_point_id, ocpp_connector_id, transaction_id, sampled_at, received_at, measurand, context,
             phase, location, unit, value, signed_data, source)
          SELECT ${cp.tenantId}::uuid, ${cp.id}::uuid, ${transaction.ocpp_connector_id}, ${transaction.id}::uuid,
                 r.sampled_at::timestamptz, ${ctx.receivedAt}, r.measurand::sessions.measurand,
                 r.context::sessions.reading_context, r.phase::sessions.phase, r.location::sessions.mv_location,
                 r.unit::sessions.unit, r.value, r.signed_data, 'StopTransaction'
          FROM jsonb_to_recordset(${toJson(tx as never, samples)}::jsonb)
            AS r(sampled_at text, measurand text, context text, phase text, location text, unit text, value numeric, signed_data text)
          ON CONFLICT DO NOTHING`;
      }
      await tx`UPDATE assets.connector SET current_transaction_id = NULL WHERE current_transaction_id = ${transaction.id}`;
      let lifecycleCheck: { sessionId: string; isTest: boolean } | null = null;
      if (transaction.session_id) {
        const energyWh = decreasing ? 0 : params.meterStop - Number(transaction.meter_start_wh);
        const endedAt = offlineStop ? stoppedAtCp : ctx.receivedAt;
        const chargingTimeS = Math.max(
          0,
          Math.round((stoppedAtCp.getTime() - transaction.started_at_cp.getTime()) / 1000),
        );
        const session = await this.endSession(tx, cp, transaction.session_id, {
          endedAt,
          energyWh,
          chargingTimeS,
          stopReason: reason,
          endKind: 'NORMAL',
          occurredAt: ctx.receivedAt,
          extra: {
            ocppTransactionId: transaction.ocpp_transaction_id,
            meterStopWh: params.meterStop,
            offlineStop,
            estimated: false,
          },
        });
        if (session) lifecycleCheck = { sessionId: session.id, isTest: session.is_test };
      }
      return {
        idTagInfo: response(),
        sessionId: transaction.session_id,
        duplicate: false,
        orphan: false,
        lifecycleCheck,
      };
    });
    // Una sesión de prueba completa en un cargador CONFIGURED lo pasa a TESTED (OPS §1.3, paso 7).
    if (outcome.lifecycleCheck?.isTest && cp.lifecycle === 'CONFIGURED') {
      await transitionLifecycle(this.sql, {
        chargePointId: cp.id,
        to: 'TESTED',
        actor: 'system:ocpp-gateway',
        reason: 'sesión de prueba terminada',
        evidence: {
          sessionId: outcome.lifecycleCheck.sessionId,
          transactionId: params.transactionId,
          uniqueId: ctx.uniqueId,
        },
      }).catch((error: unknown) => this.logger.warn({ err: error }, 'no se pudo pasar a TESTED'));
    }
    const { lifecycleCheck: _ignored, ...result } = outcome;
    return result;
  }

  /** StatusNotification con sesión viva en el conector (DAT §3.2, §5.7). */
  async onConnectorStatus(
    ctx: InboundContext,
    connectorId: number,
    status: string,
    previousStatus: string | null,
  ): Promise<{ sessionId: string; from: SessionState; to: SessionState } | null> {
    const cp = ctx.chargePoint;
    if (connectorId === 0) return null;
    return this.sql.begin(async (tx) => {
      if (IDLE_END_STATUSES.has(status))
        await this.endIdle(tx, cp, connectorId, ctx.receivedAt, 'status');
      const rows = await tx<ChargingSessionRow[]>`
        SELECT s.* FROM sessions.charging_session s
        JOIN assets.connector c ON c.id = s.connector_id
        WHERE s.charge_point_id = ${cp.id} AND c.ocpp_connector_id = ${connectorId}
          AND s.state = ANY(${[...LIVE_SESSION_STATES]}::sessions.session_state[])
        ORDER BY s.requested_at DESC LIMIT 1 FOR UPDATE OF s`;
      const session = rows[0];
      if (!session) return null;
      let target: SessionState | null = null;
      let event:
        | 'session.suspended'
        | 'session.resumed'
        | 'session.stop_requested'
        | 'session.expired'
        | null = null;
      if (
        status === 'SuspendedEV' &&
        (session.state === 'CHARGING' || session.state === 'SUSPENDED_EVSE')
      ) {
        target = 'SUSPENDED_EV';
        event = 'session.suspended';
      } else if (
        status === 'SuspendedEVSE' &&
        (session.state === 'CHARGING' || session.state === 'SUSPENDED_EV')
      ) {
        target = 'SUSPENDED_EVSE';
        event = 'session.suspended';
      } else if (
        status === 'Charging' &&
        (session.state === 'SUSPENDED_EV' || session.state === 'SUSPENDED_EVSE')
      ) {
        target = 'CHARGING';
        event = 'session.resumed';
      } else if (
        status === 'Finishing' &&
        (session.state === 'CHARGING' ||
          session.state === 'SUSPENDED_EV' ||
          session.state === 'SUSPENDED_EVSE')
      ) {
        target = 'STOPPING';
        event = 'session.stop_requested';
      } else if (
        status === 'Available' &&
        session.state === 'STARTING' &&
        previousStatus === 'Preparing'
      ) {
        target = 'EXPIRED';
        event = 'session.expired';
      }
      if (!target || !event) return null;
      assertSessionTransition(session.state, target);
      await tx`
        UPDATE sessions.charging_session SET
          state = ${target}::sessions.session_state, state_changed_at = ${ctx.receivedAt},
          idle_since = CASE WHEN ${target} = 'SUSPENDED_EV' THEN COALESCE(idle_since, ${ctx.receivedAt})
                            WHEN ${target} = 'CHARGING' THEN NULL ELSE idle_since END,
          stop_requested_by = CASE WHEN ${target} = 'STOPPING' THEN COALESCE(stop_requested_by, 'charge_point') ELSE stop_requested_by END,
          end_kind = CASE WHEN ${target} = 'EXPIRED' THEN 'TIMEOUT' ELSE end_kind END,
          failure_code = CASE WHEN ${target} = 'EXPIRED' THEN 'CONNECTION_TIMEOUT' ELSE failure_code END,
          app_seq = app_seq + 1, updated_at = now()
        WHERE id = ${session.id}`;
      if (target === 'EXPIRED' && session.id_token_id)
        await setTokenStatus(tx, session.id_token_id, 'INVALID');
      await appendEvent(tx, {
        name: event,
        tenantId: cp.tenantId,
        aggregate: { type: 'session', id: session.id },
        orderingKey: cp.identity,
        occurredAt: ctx.receivedAt,
        payload: {
          sessionId: session.id,
          chargeBoxId: cp.identity,
          connectorId,
          status,
          from: session.state,
          to: target,
        },
      });
      return { sessionId: session.id, from: session.state, to: target };
    });
  }

  /** BootNotification con sesiones vivas: se marcan interrumpidas (DAT §5.8). */
  async onBoot(ctx: InboundContext): Promise<number> {
    const result = await this.sql`
      UPDATE sessions.charging_session SET interrupted_at = ${ctx.receivedAt}, updated_at = now()
      WHERE charge_point_id = ${ctx.chargePoint.id} AND interrupted_at IS NULL
        AND state IN ('CHARGING', 'SUSPENDED_EV', 'SUSPENDED_EVSE', 'STOPPING')`;
    return result.count;
  }

  /** Sesiones STARTING cuyo plazo de arranque venció (worker; DAT §3.2 STARTING → EXPIRED). */
  async expireStartTimeouts(now = this.now()): Promise<number> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<ChargingSessionRow[]>`
        SELECT * FROM sessions.charging_session
        WHERE state = 'STARTING' AND start_deadline_at IS NOT NULL AND start_deadline_at < ${now}
        FOR UPDATE SKIP LOCKED`;
      for (const session of rows) {
        await tx`
          UPDATE sessions.charging_session SET state = 'EXPIRED', state_changed_at = ${now}, end_kind = 'TIMEOUT',
                 failure_code = 'CONNECTION_TIMEOUT', app_seq = app_seq + 1, updated_at = now()
          WHERE id = ${session.id}`;
        if (session.id_token_id) await setTokenStatus(tx, session.id_token_id, 'INVALID');
        const identity = await this.identityOf(tx, session.charge_point_id);
        await appendEvent(tx, {
          name: 'session.expired',
          tenantId: session.tenant_id,
          aggregate: { type: 'session', id: session.id },
          orderingKey: identity,
          occurredAt: now,
          payload: { sessionId: session.id, chargeBoxId: identity, reason: 'start_deadline' },
        });
      }
      return rows.length;
    });
  }

  /** Transacciones activas de cargadores desconectados más de `orphanTimeoutH` (worker; cierre estimado). */
  async closeOrphanTransactions(orphanTimeoutH: number, now = this.now()): Promise<number> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<OcppTransactionRow[]>`
        SELECT t.* FROM sessions.ocpp_transaction t
        JOIN assets.charge_point cp ON cp.id = t.charge_point_id
        WHERE t.state = 'ACTIVE' AND cp.connected = false
          AND COALESCE(cp.last_disconnect_at, cp.last_seen_at, t.started_received_at) < ${now} - make_interval(hours => ${orphanTimeoutH})
        FOR UPDATE OF t SKIP LOCKED`;
      for (const transaction of rows) {
        await this.closeEstimated(
          tx,
          transaction,
          now,
          `sin StopTransaction tras ${orphanTimeoutH} h desconectado`,
        );
      }
      return rows.length;
    });
  }

  // ---- internos ----

  private isOffline(ctx: InboundContext, timestampCp: Date): boolean {
    const tolerance = this.offlineToleranceS * 1000;
    if (timestampCp.getTime() < ctx.connectedAt.getTime() - tolerance) return true;
    return ctx.receivedAt.getTime() - timestampCp.getTime() > 2 * ctx.heartbeatIntervalS * 1000;
  }

  private async identityOf(db: ISql, chargePointId: string): Promise<string> {
    const rows = await db<
      { charge_box_id: string }[]
    >`SELECT charge_box_id FROM assets.charge_point WHERE id = ${chargePointId}`;
    return rows[0]?.charge_box_id ?? chargePointId;
  }

  private async resolveConnector(
    db: ISql,
    cp: InboundChargePoint,
    connectorId: number,
  ): Promise<ConnectorRef> {
    const rows = await db<ConnectorRef[]>`
      SELECT c.id AS connector_id, c.evse_id, cp.site_id
      FROM assets.connector c JOIN assets.charge_point cp ON cp.id = c.charge_point_id
      WHERE c.charge_point_id = ${cp.id} AND c.ocpp_connector_id = ${connectorId}`;
    const found = rows[0];
    if (found) return found;
    // Conector no inventariado: se crea con tipo desconocido y se avisa (la transacción no se puede rechazar).
    const site = await db<
      { site_id: string; charge_box_id: string }[]
    >`SELECT site_id, charge_box_id FROM assets.charge_point WHERE id = ${cp.id}`;
    const created = await db<{ connector_id: string; evse_id: string }[]>`
      WITH e AS (
        INSERT INTO assets.evse (id, charge_point_id, ocpp_evse_id, evse_id, visible_in_app)
        VALUES (gen_random_uuid(), ${cp.id}, ${connectorId}, ${`${cp.identity}-${connectorId}`}, false)
        RETURNING id)
      INSERT INTO assets.connector (id, evse_id, charge_point_id, ocpp_connector_id, standard, power_type)
      SELECT gen_random_uuid(), e.id, ${cp.id}, ${connectorId}, 'OTHER', 'DC' FROM e
      RETURNING id AS connector_id, evse_id`;
    await raiseAlarm(db as never, {
      tenantId: cp.tenantId,
      chargePointId: cp.id,
      siteId: site[0]?.site_id,
      kind: 'INVENTORY_MISMATCH',
      severity: 'WARNING',
      fingerprint: `INVENTORY_MISMATCH|${cp.identity}|connector-${connectorId}`,
      details: { reason: 'StartTransaction en un conector no inventariado', connectorId },
    });
    this.logger.warn(
      { chargeBoxId: cp.identity, connectorId },
      'conector creado automáticamente al recibir StartTransaction',
    );
    const row = created[0] as { connector_id: string; evse_id: string };
    return {
      connector_id: row.connector_id,
      evse_id: row.evse_id,
      site_id: site[0]?.site_id ?? '',
    };
  }

  private async findSessionForStart(
    db: ISql,
    cp: InboundChargePoint,
    connector: ConnectorRef,
    idTag: string,
    tokenDriverId: string | null,
    now: Date,
  ): Promise<ChargingSessionRow | undefined> {
    const starting = await db<ChargingSessionRow[]>`
      SELECT * FROM sessions.charging_session
      WHERE evse_id = ${connector.evse_id} AND state = 'STARTING' ORDER BY requested_at DESC LIMIT 1 FOR UPDATE`;
    const candidate = starting[0];
    if (candidate) {
      if (candidate.id_tag.toUpperCase() === idTag.toUpperCase()) return candidate;
      if (tokenDriverId && candidate.driver_id === tokenDriverId) return candidate; // DAT §5.12: mismo conductor
      // Otro idTag: la sesión solicitada expira y la transacción se registra como no solicitada.
      await db`
        UPDATE sessions.charging_session SET state = 'EXPIRED', state_changed_at = ${now}, end_kind = 'TIMEOUT',
               failure_code = 'OTHER_IDTAG_STARTED', app_seq = app_seq + 1, updated_at = now() WHERE id = ${candidate.id}`;
      if (candidate.id_token_id) await setTokenStatus(db, candidate.id_token_id, 'INVALID');
      await appendEvent(db, {
        name: 'session.expired',
        tenantId: cp.tenantId,
        aggregate: { type: 'session', id: candidate.id },
        orderingKey: cp.identity,
        occurredAt: now,
        payload: {
          sessionId: candidate.id,
          chargeBoxId: cp.identity,
          reason: 'other_idtag_started',
        },
      });
      return undefined;
    }
    const expired = await db<ChargingSessionRow[]>`
      SELECT * FROM sessions.charging_session
      WHERE evse_id = ${connector.evse_id} AND state = 'EXPIRED' AND upper(id_tag) = upper(${idTag})
        AND state_changed_at > ${now} - make_interval(secs => ${this.lateStartWindowS})
      ORDER BY state_changed_at DESC LIMIT 1 FOR UPDATE`;
    return expired[0];
  }

  private async createUnsolicitedSession(
    db: ISql,
    cp: InboundChargePoint,
    connector: ConnectorRef,
    transaction: OcppTransactionRow,
    token: { id: string; driver_id: string | null; token_type: string } | undefined,
    startedAt: Date,
    now: Date,
  ): Promise<string> {
    const rows = await db<{ id: string }[]>`
      INSERT INTO sessions.charging_session
        (id, tenant_id, session_no, driver_id, id_token_id, id_tag, site_id, charge_point_id, evse_id, connector_id,
         start_channel, auth_method, state, state_changed_at, ocpp_transaction_id, requested_at, authorized_at, started_at, is_test)
      VALUES (gen_random_uuid(), ${cp.tenantId}, ${nextSessionNo(db)}, ${token?.driver_id ?? null}, ${token?.id ?? null},
              ${transaction.id_tag}, ${connector.site_id}, ${cp.id}, ${connector.evse_id}, ${connector.connector_id},
              'UNSOLICITED', 'WHITELIST', 'CHARGING', ${now}, ${transaction.id}, ${startedAt}, ${startedAt}, ${startedAt},
              ${token?.token_type === 'TEST'})
      RETURNING id`;
    return (rows[0] as { id: string }).id;
  }

  private async updateSessionSample(
    db: ISql,
    cp: InboundChargePoint,
    transaction: OcppTransactionRow,
    samples: FlatSample[],
    receivedAt: Date,
  ): Promise<void> {
    if (!transaction.session_id) return;
    const sessions = await db<ChargingSessionRow[]>`
      SELECT * FROM sessions.charging_session WHERE id = ${transaction.session_id} FOR UPDATE`;
    const session = sessions[0];
    if (!session) return;
    const latest = pickLatest(samples);
    const previous = session.last_sample;
    const sample: SessionSample = {
      at: latest.at ?? receivedAt.toISOString(),
      registerWh: latest.registerWh ?? previous?.registerWh ?? null,
      energyWh:
        latest.registerWh !== null
          ? Math.max(0, latest.registerWh - Number(transaction.meter_start_wh))
          : (previous?.energyWh ?? null),
      powerW: latest.powerW ?? previous?.powerW ?? null,
      voltageV: latest.voltageV ?? previous?.voltageV ?? null,
      currentA: latest.currentA ?? previous?.currentA ?? null,
      soc: latest.soc ?? previous?.soc ?? null,
    };
    const flags: string[] = [];
    if (
      latest.registerWh !== null &&
      previous?.registerWh !== null &&
      previous?.registerWh !== undefined
    ) {
      if (latest.registerWh < previous.registerWh) flags.push('METER_DECREASING');
      else if (latest.registerWh - previous.registerWh > this.maxEnergyJumpWh) flags.push('JUMP');
    }
    if (flags.length > 0) {
      await db`
        UPDATE sessions.ocpp_transaction SET anomaly_flags = (
          SELECT array_agg(DISTINCT f) FROM unnest(anomaly_flags || ${flags}::text[]) AS f)
        WHERE id = ${transaction.id}`;
      await raiseAlarm(db as never, {
        tenantId: cp.tenantId,
        chargePointId: cp.id,
        kind: 'METER_ANOMALY',
        severity: 'WARNING',
        fingerprint: `METER_ANOMALY|${cp.identity}|${transaction.ocpp_transaction_id}`,
        details: { flags, registerWh: latest.registerWh, previousWh: previous?.registerWh ?? null },
      });
    }
    await db`
      UPDATE sessions.charging_session SET
        last_sample = ${toJson(db as never, sample)},
        energy_wh = ${sample.energyWh === null ? null : String(sample.energyWh)}::bigint,
        app_seq = app_seq + 1, updated_at = now()
      WHERE id = ${session.id}`;
    const sampledAt = new Date(sample.at);
    const costAt =
      Number.isNaN(sampledAt.getTime()) || sampledAt < receivedAt ? receivedAt : sampledAt;
    const cost = await this.pricing.onSample(db, {
      session: { ...session, last_sample: sample },
      transaction,
      chargeBoxId: cp.identity,
      at: costAt,
    });
    await appendEvent(db, {
      name: 'session.metered',
      tenantId: cp.tenantId,
      aggregate: { type: 'session', id: session.id },
      orderingKey: cp.identity,
      occurredAt: receivedAt,
      payload: {
        sessionId: session.id,
        chargeBoxId: cp.identity,
        connectorId: transaction.ocpp_connector_id,
        ocppTransactionId: transaction.ocpp_transaction_id,
        sample,
        anomalies: flags,
        cost: cost ?? null,
      },
    });
  }

  /**
   * Fin de la ocupación de las sesiones ENDED del conector (TAR §3.6 caso B): el vehículo se fue
   * (Available/Preparing...) o empieza otra transacción. Idempotente: solo afecta a idle_ended_at nulo.
   */
  private async endIdle(
    db: ISql,
    cp: InboundChargePoint,
    connectorId: number,
    at: Date,
    reason: 'status' | 'new_transaction',
  ): Promise<void> {
    const rows = await db<{ id: string; tenant_id: string }[]>`
      UPDATE sessions.charging_session s SET idle_ended_at = ${at}, app_seq = s.app_seq + 1, updated_at = now()
      FROM assets.connector c
      WHERE c.id = s.connector_id AND s.charge_point_id = ${cp.id} AND c.ocpp_connector_id = ${connectorId}
        AND s.state = 'ENDED' AND s.idle_ended_at IS NULL
      RETURNING s.id, s.tenant_id`;
    for (const row of rows) {
      await appendEvent(db, {
        name: 'session.idle_ended',
        tenantId: row.tenant_id,
        aggregate: { type: 'session', id: row.id },
        orderingKey: cp.identity,
        occurredAt: at,
        payload: {
          sessionId: row.id,
          chargeBoxId: cp.identity,
          connectorId,
          idleEndedAt: at.toISOString(),
          reason,
        },
      });
    }
  }

  private async endSession(
    db: ISql,
    cp: InboundChargePoint,
    sessionId: string,
    input: {
      endedAt: Date;
      energyWh: number;
      chargingTimeS: number;
      stopReason: StopReason;
      endKind: 'NORMAL' | 'ESTIMATED';
      occurredAt: Date;
      extra: Record<string, unknown>;
    },
  ): Promise<ChargingSessionRow | undefined> {
    const rows = await db<
      ChargingSessionRow[]
    >`SELECT * FROM sessions.charging_session WHERE id = ${sessionId} FOR UPDATE`;
    const session = rows[0];
    if (!session) return undefined;
    if (session.state === 'ENDED' || session.state === 'SETTLED' || session.state === 'PAID')
      return session;
    if (session.state === 'STARTING' || session.state === 'EXPIRED') {
      // Transacción que arranca y termina sin pasar por CHARGING (mensajes encolados): se acepta.
    } else {
      assertSessionTransition(session.state, 'ENDED');
    }
    const idleTimeS = session.idle_since
      ? Math.max(0, Math.round((input.endedAt.getTime() - session.idle_since.getTime()) / 1000))
      : 0;
    await db`
      UPDATE sessions.charging_session SET
        state = 'ENDED', state_changed_at = ${input.occurredAt}, ended_at = ${input.endedAt},
        energy_wh = ${String(input.energyWh)}::bigint, charging_time_s = ${input.chargingTimeS}, idle_time_s = ${idleTimeS},
        stop_reason = ${input.stopReason}::sessions.stop_reason, end_kind = ${input.endKind},
        idle_ended_at = CASE WHEN ${input.stopReason === 'EVDisconnected' || input.endKind === 'ESTIMATED'}
                             THEN COALESCE(idle_ended_at, ${input.endedAt}) ELSE idle_ended_at END,
        app_seq = app_seq + 1, updated_at = now()
      WHERE id = ${sessionId}`;
    if (session.id_token_id) {
      const token = await db<
        { token_type: string }[]
      >`SELECT token_type FROM auth.id_token WHERE id = ${session.id_token_id}`;
      if (token[0] && SINGLE_USE_TOKEN_TYPES.has(token[0].token_type))
        await setTokenStatus(db, session.id_token_id, 'INVALID');
    }
    await appendEvent(db, {
      name: 'session.ended',
      tenantId: cp.tenantId,
      aggregate: { type: 'session', id: sessionId },
      orderingKey: cp.identity,
      occurredAt: input.occurredAt,
      payload: {
        sessionId,
        chargeBoxId: cp.identity,
        energyWh: input.energyWh,
        chargingTimeS: input.chargingTimeS,
        idleTimeS,
        stopReason: input.stopReason,
        endKind: input.endKind,
        isTest: session.is_test,
        ...input.extra,
      },
    });
    return { ...session, state: 'ENDED' };
  }

  private async closeEstimated(
    db: ISql,
    transaction: OcppTransactionRow,
    at: Date,
    why: string,
  ): Promise<void> {
    const last = await db<{ value_wh: bigint | null; sampled_at: Date }[]>`
      SELECT value_wh, sampled_at FROM sessions.meter_value
      WHERE transaction_id = ${transaction.id} AND measurand = 'Energy.Active.Import.Register' AND value_wh IS NOT NULL
      ORDER BY sampled_at DESC LIMIT 1`;
    const meterStop = last[0]?.value_wh ?? transaction.meter_start_wh;
    const stoppedAtCp = last[0]?.sampled_at ?? at;
    await db`
      UPDATE sessions.ocpp_transaction SET
        state = 'CLOSED_ESTIMATED', meter_stop_wh = ${String(meterStop)}::bigint, stopped_at_cp = ${stoppedAtCp},
        stopped_received_at = ${at}, stop_reason = 'Other', updated_at = now()
      WHERE id = ${transaction.id}`;
    await db`UPDATE assets.connector SET current_transaction_id = NULL WHERE current_transaction_id = ${transaction.id}`;
    const identity = await this.identityOf(db, transaction.charge_point_id);
    const cp: InboundChargePoint = {
      id: transaction.charge_point_id,
      identity,
      tenantId: transaction.tenant_id,
      lifecycle: 'OPERATIONAL',
    };
    if (transaction.session_id) {
      await this.endSession(db, cp, transaction.session_id, {
        endedAt: stoppedAtCp,
        energyWh: Math.max(0, Number(meterStop) - Number(transaction.meter_start_wh)),
        chargingTimeS: Math.max(
          0,
          Math.round((stoppedAtCp.getTime() - transaction.started_at_cp.getTime()) / 1000),
        ),
        stopReason: 'Other',
        endKind: 'ESTIMATED',
        occurredAt: at,
        extra: { ocppTransactionId: transaction.ocpp_transaction_id, estimated: true, why },
      });
    }
    await raiseAlarm(db as never, {
      tenantId: transaction.tenant_id,
      chargePointId: transaction.charge_point_id,
      kind: 'TRANSACTION_ESTIMATED',
      severity: 'WARNING',
      fingerprint: `TRANSACTION_ESTIMATED|${identity}|${transaction.ocpp_transaction_id}`,
      details: {
        transactionId: transaction.ocpp_transaction_id,
        sessionId: transaction.session_id,
        why,
      },
    });
    this.logger.warn(
      { chargeBoxId: identity, transactionId: transaction.ocpp_transaction_id, why },
      'transacción cerrada como estimada',
    );
  }

  private async handleOrphanStop(
    db: ISql,
    ctx: InboundContext,
    params: StopTransactionParams,
    stoppedAtCp: Date,
    reason: StopReason,
  ): Promise<void> {
    const cp = ctx.chargePoint;
    const foreign = await db<{ charge_box_id: string }[]>`
      SELECT cp.charge_box_id FROM sessions.ocpp_transaction t JOIN assets.charge_point cp ON cp.id = t.charge_point_id
      WHERE t.ocpp_transaction_id = ${params.transactionId} AND t.charge_point_id <> ${cp.id} LIMIT 1`;
    if (foreign[0]) {
      // Propiedad de la transacción (SEG S4, SteVe #1296): no se toca la transacción ajena.
      this.logger.warn(
        {
          chargeBoxId: cp.identity,
          transactionId: params.transactionId,
          owner: foreign[0].charge_box_id,
          reason: 'StopForeignTransaction',
        },
        'security_event',
      );
      await raiseAlarm(db as never, {
        tenantId: cp.tenantId,
        chargePointId: cp.id,
        kind: 'SECURITY_EVENT',
        severity: 'CRITICAL',
        fingerprint: `SECURITY_EVENT|${cp.identity}|StopForeignTransaction`,
        details: { transactionId: params.transactionId, owner: foreign[0].charge_box_id },
      });
      return;
    }
    const evse = await db<{ evse_id: string; ocpp_connector_id: number }[]>`
      SELECT evse_id, ocpp_connector_id FROM assets.connector WHERE charge_point_id = ${cp.id} ORDER BY ocpp_connector_id LIMIT 1`;
    const target = evse[0];
    const firstData = flattenSamples(params.transactionData ?? [], ctx.receivedAt)
      .filter((s) => s.measurand === ENERGY_REGISTER)
      .sort((a, b) => a.sampled_at.localeCompare(b.sampled_at))[0];
    const meterStart = firstData ? toWh(Number(firstData.value), firstData.unit) : params.meterStop;
    if (target) {
      await db`
        INSERT INTO sessions.ocpp_transaction
          (id, tenant_id, charge_point_id, evse_id, ocpp_connector_id, ocpp_transaction_id, ocpp_transaction_ref, id_tag,
           id_tag_status, meter_start_wh, meter_stop_wh, started_at_cp, started_received_at, stopped_at_cp, stopped_received_at,
           stop_reason, stop_id_tag, state, offline_stop, stop_unique_id, transaction_data, anomaly_flags)
        VALUES (gen_random_uuid(), ${cp.tenantId}, ${cp.id}, ${target.evse_id}, ${target.ocpp_connector_id},
                ${params.transactionId}, ${String(params.transactionId)}, ${params.idTag ?? 'UNKNOWN'}, 'Invalid',
                ${String(Math.min(meterStart, params.meterStop))}::bigint, ${params.meterStop}::bigint, ${stoppedAtCp}, ${ctx.receivedAt},
                ${stoppedAtCp}, ${ctx.receivedAt}, ${reason}::sessions.stop_reason, ${params.idTag ?? null}, 'ORPHAN',
                ${this.isOffline(ctx, stoppedAtCp)}, ${ctx.uniqueId},
                ${params.transactionData ? toJson(db as never, params.transactionData) : null}, ${['UNMAPPED_TX']}::text[])
        ON CONFLICT (charge_point_id, ocpp_transaction_id) DO NOTHING`;
    }
    await raiseAlarm(db as never, {
      tenantId: cp.tenantId,
      chargePointId: cp.id,
      kind: 'ORPHAN_TRANSACTION',
      severity: 'WARNING',
      fingerprint: `ORPHAN_TRANSACTION|${cp.identity}|${params.transactionId}`,
      details: { transactionId: params.transactionId, meterStop: params.meterStop, reason },
    });
    await appendEvent(db, {
      name: 'transaction.orphaned',
      tenantId: cp.tenantId,
      aggregate: { type: 'transaction', id: `${cp.identity}:${params.transactionId}` },
      orderingKey: cp.identity,
      occurredAt: ctx.receivedAt,
      payload: {
        chargeBoxId: cp.identity,
        transactionId: params.transactionId,
        meterStop: params.meterStop,
        reason,
      },
    });
    this.logger.warn(
      { chargeBoxId: cp.identity, transactionId: params.transactionId },
      'StopTransaction de una transacción desconocida',
    );
  }
}

// ---- utilidades ----

interface FlatSample {
  sampled_at: string;
  measurand: string;
  context: string;
  phase: string;
  location: string;
  unit: string;
  value: number;
  signed_data: string | null;
}

const MEASURANDS = new Set([
  'Current.Export',
  'Current.Import',
  'Current.Offered',
  'Energy.Active.Export.Register',
  'Energy.Active.Import.Register',
  'Energy.Reactive.Export.Register',
  'Energy.Reactive.Import.Register',
  'Energy.Active.Export.Interval',
  'Energy.Active.Import.Interval',
  'Energy.Reactive.Export.Interval',
  'Energy.Reactive.Import.Interval',
  'Frequency',
  'Power.Active.Export',
  'Power.Active.Import',
  'Power.Factor',
  'Power.Offered',
  'Power.Reactive.Export',
  'Power.Reactive.Import',
  'RPM',
  'SoC',
  'Temperature',
  'Voltage',
]);

/** Aplana MeterValues.req.meterValue[] en filas con los valores por defecto de OCPP 1.6. */
export function flattenSamples(
  meterValue: MeterValuesParams['meterValue'],
  receivedAt: Date,
): FlatSample[] {
  const rows: FlatSample[] = [];
  for (const entry of meterValue) {
    const sampledAt = parseTimestamp(entry.timestamp, receivedAt).toISOString();
    for (const sampled of entry.sampledValue) {
      const measurand = sampled.measurand ?? 'Energy.Active.Import.Register';
      if (!MEASURANDS.has(measurand)) continue;
      const signed = sampled.format === 'SignedData';
      const value = signed ? 0 : Number(sampled.value);
      if (!signed && !Number.isFinite(value)) continue;
      rows.push({
        sampled_at: sampledAt,
        measurand,
        context: sampled.context ?? 'Sample.Periodic',
        phase: sampled.phase ?? 'NONE',
        location: sampled.location ?? 'Outlet',
        unit:
          sampled.unit ??
          (measurand.startsWith('Energy')
            ? 'Wh'
            : measurand.startsWith('Power')
              ? 'W'
              : measurand === 'SoC'
                ? 'Percent'
                : measurand.startsWith('Current')
                  ? 'A'
                  : measurand === 'Voltage'
                    ? 'V'
                    : 'Wh'),
        value,
        signed_data: signed ? sampled.value : null,
      });
    }
  }
  return rows;
}

function toWh(value: number, unit: string): number {
  return unit === 'kWh' ? Math.round(value * 1000) : Math.round(value);
}

function toW(value: number, unit: string): number {
  return unit === 'kW' ? value * 1000 : value;
}

function pickLatest(samples: FlatSample[]): {
  at: string | null;
  registerWh: number | null;
  powerW: number | null;
  voltageV: number | null;
  currentA: number | null;
  soc: number | null;
} {
  const result = {
    at: null as string | null,
    registerWh: null as number | null,
    powerW: null as number | null,
    voltageV: null as number | null,
    currentA: null as number | null,
    soc: null as number | null,
  };
  const sorted = [...samples].sort((a, b) => a.sampled_at.localeCompare(b.sampled_at));
  for (const sample of sorted) {
    if (sample.signed_data !== null) continue;
    if (
      sample.phase !== 'NONE' &&
      sample.measurand !== 'Voltage' &&
      sample.measurand !== 'Current.Import'
    )
      continue;
    result.at = sample.sampled_at;
    switch (sample.measurand) {
      case ENERGY_REGISTER:
        result.registerWh = toWh(sample.value, sample.unit);
        break;
      case 'Power.Active.Import':
        result.powerW = toW(sample.value, sample.unit);
        break;
      case 'Voltage':
        if (sample.phase === 'NONE' || result.voltageV === null) result.voltageV = sample.value;
        break;
      case 'Current.Import':
        if (sample.phase === 'NONE' || result.currentA === null) result.currentA = sample.value;
        break;
      case 'SoC':
        result.soc = sample.value;
        break;
      default:
        break;
    }
  }
  return result;
}

function parseTimestamp(value: string, fallback: Date): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function mask(idTag: string): string {
  return `${idTag.slice(0, 4)}***`;
}

/** Fragmento SQL que genera el siguiente número de sesión: VO-<año>-<secuencia de seis dígitos>. */
export function nextSessionNo(db: ISql) {
  return db`'VO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sessions.session_no_seq')::text, 6, '0')`;
}
