import { assertSessionTransition, type SessionState } from '@volt/domain';
import type { ISql, Sql } from 'postgres';
import type { CommandService } from '../commands.ts';
import { ChargePointOfflineError, ConflictError, NotFoundError } from '../errors.ts';
import { type CsmsLogger, silentLogger } from '../types.ts';
import { type EvseLiveRow, getEvseByCode, getEvseById } from './locations.ts';
import { appendEvent } from './outbox.ts';
import {
  type ChargingSessionRow,
  LIVE_SESSION_STATES,
  type OcppTransactionRow,
  type StartChannel,
} from './rows.ts';
import { issueIdToken, setTokenStatus, type TokenType } from './tokens.ts';
import { nextSessionNo } from './transaction-service.ts';

/** Puerto de pagos (iteración 5: Wompi). Sin adaptador, toda sesión queda autorizada sin cobro. */
export interface PaymentAuthorizer {
  authorize(
    session: ChargingSessionRow,
  ): Promise<{ ok: true; preauthMinor?: bigint } | { ok: false; code: string; message: string }>;
}

export const noPaymentAuthorizer: PaymentAuthorizer = { authorize: async () => ({ ok: true }) };

export type RequestChannel = 'APP' | 'QR' | 'OPERATOR' | 'TEST';

export interface RequestStartInput {
  tenantId: string;
  evseCode?: string | undefined;
  evseId?: string | undefined;
  driverId?: string | null | undefined;
  channel: RequestChannel;
  /** `driver:<id>` | `staff:<id>` */
  requestedBy: string;
  idempotencyKey?: string | undefined;
}

export interface SessionServiceOptions {
  logger?: CsmsLogger;
  clock?: () => Date;
  paymentAuthorizer?: PaymentAuthorizer;
  /** ConnectionTimeOut por defecto cuando el cargador no lo ha reportado (FUN M04: 120 s). */
  defaultConnectionTimeoutS?: number;
  /** Margen sobre ConnectionTimeOut para dar por vencido el arranque (DAT §3.2). */
  startTimeoutMarginS?: number;
  /** Validez del idTag virtual emitido para la sesión. */
  tokenValidityS?: number;
}

export interface SessionFilter {
  tenantId: string;
  driverId?: string | undefined;
  chargePointId?: string | undefined;
  state?: SessionState | undefined;
  limit?: number | undefined;
}

/**
 * Sesiones de carga solicitadas desde la plataforma (ARQ §2.4, DAT §3.2): emisión del idTag
 * virtual, autorización de pago (puerto), RemoteStartTransaction, plazo de arranque, parada
 * remota y cancelación. Las transiciones que dependen del cargador viven en TransactionService.
 */
export class SessionService {
  private readonly logger: CsmsLogger;
  private readonly now: () => Date;
  private readonly payments: PaymentAuthorizer;
  private readonly defaultConnectionTimeoutS: number;
  private readonly startTimeoutMarginS: number;
  private readonly tokenValidityS: number;

  constructor(
    private readonly sql: Sql,
    private readonly commands: CommandService,
    options: SessionServiceOptions = {},
  ) {
    this.logger = options.logger ?? silentLogger;
    this.now = options.clock ?? (() => new Date());
    this.payments = options.paymentAuthorizer ?? noPaymentAuthorizer;
    this.defaultConnectionTimeoutS = options.defaultConnectionTimeoutS ?? 120;
    this.startTimeoutMarginS = options.startTimeoutMarginS ?? 30;
    this.tokenValidityS = options.tokenValidityS ?? 900;
  }

  async requestStart(input: RequestStartInput): Promise<ChargingSessionRow> {
    if (input.idempotencyKey) {
      const existing = await this.sql<ChargingSessionRow[]>`
        SELECT * FROM sessions.charging_session WHERE idempotency_key = ${input.idempotencyKey}`;
      if (existing[0]) return existing[0];
    }
    const evse = input.evseCode
      ? await getEvseByCode(this.sql, input.tenantId, input.evseCode)
      : input.evseId
        ? await getEvseById(this.sql, input.evseId)
        : undefined;
    if (!evse) throw new ConflictError('Hace falta evseCode o evseId', 'VALIDATION');
    this.assertStartable(evse, input.channel);

    const live = await this.sql`
      SELECT 1 FROM sessions.charging_session
      WHERE evse_id = ${evse.evse_uuid} AND state = ANY(${[...LIVE_SESSION_STATES]}::sessions.session_state[])`;
    if (live.length > 0)
      throw new ConflictError('El EVSE ya tiene una sesión en curso', 'EVSE_BUSY');

    const now = this.now();
    const tokenType: TokenType =
      input.channel === 'TEST' ? 'TEST' : input.channel === 'OPERATOR' ? 'OPERATOR' : 'APP';
    const channel: StartChannel = input.channel === 'TEST' ? 'OPERATOR' : input.channel;
    const session = await this.sql.begin(async (tx) => {
      const token = await issueIdToken(tx, {
        tenantId: input.tenantId,
        tokenType,
        driverId: input.driverId ?? null,
        validUntil: new Date(now.getTime() + this.tokenValidityS * 1000),
      });
      const rows = await tx<ChargingSessionRow[]>`
        INSERT INTO sessions.charging_session
          (id, tenant_id, session_no, driver_id, id_token_id, id_tag, site_id, charge_point_id, evse_id, connector_id,
           start_channel, auth_method, state, state_changed_at, idempotency_key, requested_at, is_test)
        VALUES (gen_random_uuid(), ${input.tenantId}, ${nextSessionNo(tx)}, ${input.driverId ?? null}, ${token.id}, ${token.token},
                ${evse.site_id}, ${evse.charge_point_id}, ${evse.evse_uuid}, ${evse.connector_uuid},
                ${channel}, 'COMMAND', 'REQUESTED', ${now}, ${input.idempotencyKey ?? null}, ${now}, ${tokenType === 'TEST'})
        RETURNING *`;
      const created = rows[0] as ChargingSessionRow;
      await this.emit(tx, created, 'session.requested', evse.charge_box_id, now, {
        channel: input.channel,
        evseCode: evse.evse_code,
      });
      return created;
    });

    const payment = await this.payments.authorize(session);
    if (!payment.ok) {
      return this.fail(session, evse.charge_box_id, payment.code, payment.message);
    }
    await this.sql.begin(async (tx) => {
      await tx`
        UPDATE sessions.charging_session SET state = 'AUTHORIZED', state_changed_at = ${now}, authorized_at = ${now},
               preauth_minor = ${payment.preauthMinor === undefined ? null : String(payment.preauthMinor)}::bigint,
               app_seq = app_seq + 1, updated_at = now()
        WHERE id = ${session.id}`;
      await this.emit(tx, session, 'session.authorized', evse.charge_box_id, now, {});
    });

    const result = await this.commands.send({
      chargePointId: evse.charge_point_id,
      action: 'RemoteStartTransaction',
      payload: { connectorId: evse.ocpp_connector_id, idTag: session.id_tag },
      requestedBy: input.requestedBy,
      correlationId: session.id,
    });
    const outcome = result.outcome;
    if (outcome.ok && outcome.result.status === 'Accepted') {
      const timeoutS = await this.connectionTimeoutS(evse.charge_point_id);
      const deadline = new Date(
        this.now().getTime() + (timeoutS + this.startTimeoutMarginS) * 1000,
      );
      await this.sql.begin(async (tx) => {
        await tx`
          UPDATE sessions.charging_session SET state = 'STARTING', state_changed_at = ${this.now()},
                 remote_start_command_id = ${result.command.id}, start_deadline_at = ${deadline},
                 app_seq = app_seq + 1, updated_at = now()
          WHERE id = ${session.id}`;
        await this.emit(tx, session, 'session.starting', evse.charge_box_id, this.now(), {
          commandId: result.command.id,
          startDeadlineAt: deadline.toISOString(),
        });
      });
      return this.get(session.id);
    }
    const code = outcome.ok
      ? 'REMOTE_START_REJECTED'
      : outcome.error.code === 'NOT_CONNECTED' || outcome.error.code === 'UNAVAILABLE'
        ? 'CHARGER_OFFLINE'
        : outcome.error.code === 'TIMEOUT'
          ? 'COMMAND_TIMEOUT'
          : 'COMMAND_ERROR';
    const message = outcome.ok
      ? `RemoteStartTransaction ${String(outcome.result.status)}`
      : outcome.error.description;
    return this.fail(
      { ...session, remote_start_command_id: result.command.id },
      evse.charge_box_id,
      code,
      message,
      result.command.id,
    );
  }

  async requestStop(sessionId: string, requestedBy: string): Promise<ChargingSessionRow> {
    const session = await this.get(sessionId);
    if (
      session.state !== 'CHARGING' &&
      session.state !== 'SUSPENDED_EV' &&
      session.state !== 'SUSPENDED_EVSE'
    ) {
      throw new ConflictError(
        `La sesión está en ${session.state}; solo se detiene una sesión en carga`,
        'SESSION_NOT_ACTIVE',
      );
    }
    const transaction = await this.getTransaction(session);
    const chargeBoxId = await this.chargeBoxIdOf(session.charge_point_id);
    const result = await this.commands.send({
      chargePointId: session.charge_point_id,
      action: 'RemoteStopTransaction',
      payload: { transactionId: transaction.ocpp_transaction_id },
      requestedBy,
      correlationId: session.id,
    });
    const outcome = result.outcome;
    if (!outcome.ok) {
      if (outcome.error.code === 'NOT_CONNECTED' || outcome.error.code === 'UNAVAILABLE') {
        throw new ChargePointOfflineError(chargeBoxId, outcome.error.description);
      }
      throw new ConflictError(
        `RemoteStopTransaction sin resultado: ${outcome.error.code}`,
        'COMMAND_FAILED',
        outcome.error,
      );
    }
    if (outcome.result.status !== 'Accepted') {
      throw new ConflictError('El cargador rechazó la parada remota', 'REMOTE_STOP_REJECTED');
    }
    await this.sql.begin(async (tx) => {
      const rows = await tx<
        ChargingSessionRow[]
      >`SELECT * FROM sessions.charging_session WHERE id = ${sessionId} FOR UPDATE`;
      const current = rows[0];
      if (
        !current ||
        (current.state !== 'CHARGING' &&
          current.state !== 'SUSPENDED_EV' &&
          current.state !== 'SUSPENDED_EVSE')
      )
        return;
      assertSessionTransition(current.state, 'STOPPING');
      await tx`
        UPDATE sessions.charging_session SET state = 'STOPPING', state_changed_at = ${this.now()},
               stop_requested_by = ${requestedBy}, remote_stop_command_id = ${result.command.id},
               app_seq = app_seq + 1, updated_at = now()
        WHERE id = ${sessionId}`;
      await this.emit(tx, current, 'session.stop_requested', chargeBoxId, this.now(), {
        requestedBy,
        commandId: result.command.id,
      });
    });
    return this.get(sessionId);
  }

  async cancel(sessionId: string, requestedBy: string): Promise<ChargingSessionRow> {
    const chargeBoxId = await this.sql.begin(async (tx) => {
      const rows = await tx<
        ChargingSessionRow[]
      >`SELECT * FROM sessions.charging_session WHERE id = ${sessionId} FOR UPDATE`;
      const session = rows[0];
      if (!session) throw new NotFoundError('session', sessionId);
      if (
        session.state !== 'REQUESTED' &&
        session.state !== 'AUTHORIZED' &&
        session.state !== 'STARTING'
      ) {
        throw new ConflictError(
          `No se puede cancelar una sesión en ${session.state}`,
          'SESSION_NOT_CANCELLABLE',
        );
      }
      assertSessionTransition(session.state, 'CANCELLED');
      await tx`
        UPDATE sessions.charging_session SET state = 'CANCELLED', state_changed_at = ${this.now()}, end_kind = 'FAILED',
               stop_requested_by = ${requestedBy}, app_seq = app_seq + 1, updated_at = now()
        WHERE id = ${sessionId}`;
      if (session.id_token_id) await setTokenStatus(tx, session.id_token_id, 'INVALID');
      const identity = await this.chargeBoxIdOf(session.charge_point_id, tx);
      await this.emit(tx, session, 'session.cancelled', identity, this.now(), { requestedBy });
      return identity;
    });
    this.logger.info({ sessionId, chargeBoxId, requestedBy }, 'sesión cancelada');
    return this.get(sessionId);
  }

  async get(sessionId: string): Promise<ChargingSessionRow> {
    const rows = await this.sql<
      ChargingSessionRow[]
    >`SELECT * FROM sessions.charging_session WHERE id = ${sessionId}`;
    const row = rows[0];
    if (!row) throw new NotFoundError('session', sessionId);
    return row;
  }

  async list(filter: SessionFilter): Promise<ChargingSessionRow[]> {
    return this.sql<ChargingSessionRow[]>`
      SELECT * FROM sessions.charging_session
      WHERE tenant_id = ${filter.tenantId}
        AND (${filter.driverId ?? null}::uuid IS NULL OR driver_id = ${filter.driverId ?? null})
        AND (${filter.chargePointId ?? null}::uuid IS NULL OR charge_point_id = ${filter.chargePointId ?? null})
        AND (${filter.state ?? null}::text IS NULL OR state::text = ${filter.state ?? null})
      ORDER BY requested_at DESC LIMIT ${filter.limit ?? 50}`;
  }

  async getTransaction(session: ChargingSessionRow): Promise<OcppTransactionRow> {
    if (!session.ocpp_transaction_id)
      throw new ConflictError('La sesión no tiene transacción OCPP', 'NO_TRANSACTION');
    const rows = await this.sql<
      OcppTransactionRow[]
    >`SELECT * FROM sessions.ocpp_transaction WHERE id = ${session.ocpp_transaction_id}`;
    const row = rows[0];
    if (!row) throw new NotFoundError('ocpp_transaction', session.ocpp_transaction_id);
    return row;
  }

  async listTransactions(chargePointId: string, limit = 50): Promise<OcppTransactionRow[]> {
    return this.sql<OcppTransactionRow[]>`
      SELECT * FROM sessions.ocpp_transaction WHERE charge_point_id = ${chargePointId}
      ORDER BY started_received_at DESC LIMIT ${limit}`;
  }

  // ---- internos ----

  private assertStartable(evse: EvseLiveRow, channel: RequestChannel): void {
    const lifecycle = evse.lifecycle_status;
    const allowed =
      channel === 'TEST'
        ? ['CONFIGURED', 'TESTED', 'OPERATIONAL', 'MAINTENANCE']
        : channel === 'OPERATOR'
          ? ['OPERATIONAL', 'MAINTENANCE']
          : ['OPERATIONAL'];
    if (!allowed.includes(lifecycle)) {
      throw new ConflictError(
        `El cargador está en ${lifecycle}; no admite sesiones ${channel}`,
        'CHARGER_NOT_OPERATIONAL',
      );
    }
    if (!evse.connected || evse.status === 'Offline')
      throw new ChargePointOfflineError(evse.charge_box_id);
    if (evse.status !== 'Available' && evse.status !== 'Preparing') {
      throw new ConflictError(`El conector está ${evse.status}`, 'EVSE_BUSY', {
        status: evse.status,
      });
    }
  }

  private async connectionTimeoutS(chargePointId: string): Promise<number> {
    const rows = await this.sql<{ observed_value: string | null }[]>`
      SELECT observed_value FROM assets.charge_point_config WHERE charge_point_id = ${chargePointId} AND key = 'ConnectionTimeOut'`;
    const parsed = Number.parseInt(rows[0]?.observed_value ?? '', 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : this.defaultConnectionTimeoutS;
  }

  private async chargeBoxIdOf(chargePointId: string, db: ISql = this.sql): Promise<string> {
    const rows = await db<
      { charge_box_id: string }[]
    >`SELECT charge_box_id FROM assets.charge_point WHERE id = ${chargePointId}`;
    return rows[0]?.charge_box_id ?? chargePointId;
  }

  private async fail(
    session: ChargingSessionRow,
    chargeBoxId: string,
    code: string,
    message: string,
    commandId?: string,
  ): Promise<ChargingSessionRow> {
    await this.sql.begin(async (tx) => {
      await tx`
        UPDATE sessions.charging_session SET state = 'FAILED', state_changed_at = ${this.now()}, end_kind = 'FAILED',
               failure_code = ${code}, remote_start_command_id = COALESCE(${commandId ?? null}, remote_start_command_id),
               app_seq = app_seq + 1, updated_at = now()
        WHERE id = ${session.id}`;
      if (session.id_token_id) await setTokenStatus(tx, session.id_token_id, 'INVALID');
      await this.emit(tx, session, 'session.failed', chargeBoxId, this.now(), { code, message });
    });
    this.logger.warn({ sessionId: session.id, chargeBoxId, code, message }, 'sesión fallida');
    return this.get(session.id);
  }

  private async emit(
    db: ISql,
    session: ChargingSessionRow,
    name:
      | 'session.requested'
      | 'session.authorized'
      | 'session.starting'
      | 'session.stop_requested'
      | 'session.cancelled'
      | 'session.failed',
    chargeBoxId: string,
    occurredAt: Date,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await appendEvent(db, {
      name,
      tenantId: session.tenant_id,
      aggregate: { type: 'session', id: session.id },
      orderingKey: chargeBoxId,
      occurredAt,
      payload: { sessionId: session.id, chargeBoxId, ...payload },
    });
  }
}
