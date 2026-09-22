/**
 * Cobro de sesiones con la pasarela (ADR 0002, puntos 5 a 7; ADR 0020): una transacción por intento
 * con referencia única, resultado por respuesta directa, webhook idempotente o consulta; cobro
 * rechazado → deuda con reintentos programados y bloqueo del conductor; enlace de pago para
 * saldar la deuda; anulación o reembolso; conciliación diaria con alarma; recibo al pagar.
 */
import { randomUUID } from 'node:crypto';
import { type GatewayTransaction, type PaymentGateway, PaymentGatewayError } from '@volt/payments';
import type { ISql, Sql } from 'postgres';
import { raiseAlarm, resolveAlarm } from '../alarms.ts';
import { ConflictError, NotFoundError } from '../errors.ts';
import { resolveParam } from '../pricing/params.ts';
import { currencyExponent } from '../pricing/snapshot.ts';
import { appendEvent } from '../sessions/outbox.ts';
import type { ChargingSessionRow } from '../sessions/rows.ts';
import { type CsmsLogger, silentLogger, toJson } from '../types.ts';
import { findChargeablePaymentMethod, type PaymentMethodRow } from './payment-methods.ts';
import { issueReceipt } from './receipts.ts';
import type { DebtRow, PaymentRow, WebhookInboxRow } from './rows.ts';

export interface BillingServiceOptions {
  logger?: CsmsLogger;
  clock?: () => Date;
}

export type ChargeOutcome =
  | { status: 'charged'; payment: PaymentRow; pspStatus: string }
  | { status: 'waived'; reason: string }
  | { status: 'waiting'; reason: string; until: Date | null }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

export interface WebhookOutcome {
  accepted: boolean;
  outcome:
    | 'APPLIED'
    | 'DUPLICATE'
    | 'INVALID_CHECKSUM'
    | 'IGNORED'
    | 'UNKNOWN_TRANSACTION'
    | 'UNKNOWN_LINK'
    | 'ERROR';
  inboxId: string | null;
}

export interface ReconciliationReport {
  day: string;
  discrepancies: {
    kind: string;
    sessionId: string | null;
    paymentId: string | null;
    detail: string;
  }[];
  counts: {
    sessionsSettled: number;
    sessionsPaid: number;
    paymentsSucceeded: number;
    debtsOpen: number;
  };
}

type PspResult = { id: string | null; status: GatewayTransaction['status'] } & Partial<
  Omit<GatewayTransaction, 'id' | 'status'>
>;

/** Subconjunto del objeto del PSP que se guarda (sin datos del titular). */
function pspSnapshot(transaction: PspResult): Record<string, unknown> {
  return {
    id: transaction.id,
    status: transaction.status,
    status_message: transaction.statusMessage ?? null,
    reference: transaction.reference ?? null,
    payment_method_type: transaction.paymentMethodType ?? null,
    payment_link_id: transaction.paymentLinkId ?? null,
    finalized_at: transaction.finalizedAt ?? null,
  };
}

export class BillingService {
  private readonly logger: CsmsLogger;
  private readonly now: () => Date;

  constructor(
    private readonly sql: Sql,
    readonly gateway: PaymentGateway,
    options: BillingServiceOptions = {},
  ) {
    this.logger = options.logger ?? silentLogger;
    this.now = options.clock ?? (() => new Date());
  }

  // ---- cobro de sesiones liquidadas ----

  /** Sesiones SETTLED sin cobrar (worker). Los fallos técnicos se reintentan cada 10 minutos. */
  async chargePending(limit = 100): Promise<Record<ChargeOutcome['status'], number>> {
    const now = this.now();
    const rows = await this.sql<{ id: string }[]>`
      SELECT s.id FROM sessions.charging_session s
      WHERE s.state = 'SETTLED' AND s.payment_status = 'NONE'
        AND (s.last_payment_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM billing.payment p WHERE p.id = s.last_payment_id AND p.created_at > ${now} - interval '10 minutes'))
      ORDER BY s.settled_at LIMIT ${limit}`;
    const counts: Record<ChargeOutcome['status'], number> = {
      charged: 0,
      waived: 0,
      waiting: 0,
      skipped: 0,
      failed: 0,
    };
    for (const row of rows) {
      const outcome = await this.chargeSession(row.id, { requestedBy: 'system:billing' });
      counts[outcome.status] += 1;
    }
    return counts;
  }

  /** Cobra una sesión liquidada. `force` salta la espera configurada y el calendario de reintentos. */
  async chargeSession(
    sessionId: string,
    options: { requestedBy: string; force?: boolean | undefined },
  ): Promise<ChargeOutcome> {
    const now = this.now();
    const prepared = await this.sql.begin(
      async (
        tx,
      ): Promise<
        | ChargeOutcome
        | {
            payment: PaymentRow;
            session: ChargingSessionRow;
            method: PaymentMethodRow;
            email: string;
          }
      > => {
        const rows = await tx<
          ChargingSessionRow[]
        >`SELECT * FROM sessions.charging_session WHERE id = ${sessionId} FOR UPDATE`;
        const session = rows[0];
        if (!session) throw new NotFoundError('session', sessionId);
        if (session.state === 'PAID') return { status: 'skipped', reason: 'ya pagada' };
        if (session.state !== 'SETTLED')
          return { status: 'skipped', reason: `sesión en ${session.state}` };
        if (session.payment_status === 'CAPTURED' || session.payment_status === 'WAIVED') {
          return { status: 'skipped', reason: `pago ${session.payment_status}` };
        }
        if (session.payment_status === 'AUTHORIZED')
          return { status: 'waiting', reason: 'PENDING_PSP', until: null };
        const total = BigInt(session.total_minor ?? 0);
        const minCharge = BigInt(
          await resolveParam<number>(tx, 'billing.min_charge_minor', {
            tenantId: session.tenant_id,
          }),
        );
        if (!session.driver_id || total <= 0n || total < minCharge) {
          const reason = !session.driver_id
            ? 'SIN_CONDUCTOR'
            : total <= 0n
              ? 'IMPORTE_CERO'
              : 'IMPORTE_MINIMO';
          await this.waive(tx, session, reason, options.requestedBy);
          return { status: 'waived', reason };
        }
        if (!options.force) {
          const delayS = await resolveParam<number>(tx, 'billing.charge_delay_s', {
            tenantId: session.tenant_id,
          });
          const readyAt = new Date((session.settled_at ?? now).getTime() + delayS * 1000);
          if (now < readyAt) return { status: 'waiting', reason: 'CHARGE_DELAY', until: readyAt };
          const debts = await tx<
            DebtRow[]
          >`SELECT * FROM billing.debt WHERE session_id = ${sessionId} AND status = 'OPEN'`;
          const debt = debts[0];
          if (debt) {
            if (debt.next_attempt_at && debt.next_attempt_at > now)
              return { status: 'waiting', reason: 'RETRY_SCHEDULED', until: debt.next_attempt_at };
            if (!debt.next_attempt_at)
              return { status: 'waiting', reason: 'RETRIES_EXHAUSTED', until: null };
          }
        }
        const method = await findChargeablePaymentMethod(tx, session.driver_id);
        if (!method) {
          await this.registerDecline(
            tx,
            session,
            null,
            'NO_PAYMENT_METHOD',
            'Sin medio de pago disponible',
            now,
          );
          return { status: 'failed', reason: 'NO_PAYMENT_METHOD' };
        }
        const attempt = session.payment_attempts + 1;
        const reference = `${session.session_no}-${attempt}`;
        const debt = (
          await tx<
            { id: string }[]
          >`SELECT id FROM billing.debt WHERE session_id = ${sessionId} AND status = 'OPEN'`
        )[0];
        const payments = await tx<PaymentRow[]>`
        INSERT INTO billing.payment
          (id, tenant_id, session_id, driver_id, payment_method_id, kind, amount_minor, currency, status, psp, idempotency_key,
           reference, attempt, psp_status, psp_environment, debt_id, requested_by, created_at, updated_at)
        VALUES (${randomUUID()}, ${session.tenant_id}, ${sessionId}, ${session.driver_id}, ${method.id}, 'CAPTURE',
                ${total.toString()}::bigint, ${session.currency ?? 'COP'}, 'PENDING', ${this.gateway.provider},
                ${`session:${sessionId}:attempt:${attempt}`}, ${reference}, ${attempt}, 'PENDING', ${this.gateway.environment},
                ${debt?.id ?? null}, ${options.requestedBy}, ${now}, ${now})
        RETURNING *`;
        const payment = payments[0] as PaymentRow;
        await tx`
        UPDATE sessions.charging_session SET payment_attempts = ${attempt}, last_payment_id = ${payment.id},
               payment_status = 'AUTHORIZED', app_seq = app_seq + 1, updated_at = now()
        WHERE id = ${sessionId}`;
        const email =
          method.customer_email ??
          (
            await tx<
              { email: string | null }[]
            >`SELECT email FROM auth.driver WHERE id = ${session.driver_id}`
          )[0]?.email ??
          '';
        return { payment, session, method, email };
      },
    );
    if ('status' in prepared) return prepared;
    const { payment, session, method, email } = prepared;
    let transaction: GatewayTransaction;
    try {
      transaction = await this.gateway.charge({
        reference: payment.reference as string,
        amountMinor: BigInt(payment.amount_minor),
        currency: payment.currency,
        currencyExponent: currencyExponent(payment.currency),
        customerEmail: email,
        paymentSourceId: Number(method.psp_method_id),
        ...(method.kind === 'CARD' ? { installments: 1 } : {}),
        recurrent: false,
      });
    } catch (error) {
      if (error instanceof PaymentGatewayError && !error.retryable) {
        // La pasarela rechazó el cobro de forma definitiva (fuente no disponible, validación): cuenta como rechazo.
        return this.sql.begin((tx) =>
          this.applyOutcome(
            tx,
            payment.id,
            { id: null, status: 'DECLINED', statusMessage: error.message },
            'charge',
          ),
        );
      }
      await this.sql.begin(async (tx) => {
        await tx`
          UPDATE billing.payment SET status = 'FAILED', psp_status = 'ERROR', status_message = ${(error as Error).message.slice(0, 300)},
                 finalized_at = ${this.now()}, updated_at = now() WHERE id = ${payment.id}`;
        await tx`UPDATE sessions.charging_session SET payment_status = 'NONE', updated_at = now() WHERE id = ${session.id}`;
      });
      this.logger.warn(
        { sessionId, paymentId: payment.id, err: error },
        'fallo técnico al cobrar; se reintentará',
      );
      return { status: 'failed', reason: 'GATEWAY_ERROR' };
    }
    return this.sql.begin((tx) => this.applyOutcome(tx, payment.id, transaction, 'charge'));
  }

  /** Aplica el resultado del PSP a un pago (respuesta directa, webhook o consulta). Idempotente por estado. */
  private async applyOutcome(
    tx: ISql,
    paymentId: string,
    transaction: PspResult,
    source: 'charge' | 'webhook' | 'poll' | 'link',
  ): Promise<ChargeOutcome> {
    const rows = await tx<
      PaymentRow[]
    >`SELECT * FROM billing.payment WHERE id = ${paymentId} FOR UPDATE`;
    const payment = rows[0];
    if (!payment) throw new NotFoundError('payment', paymentId);
    if (payment.status !== 'PENDING' && payment.psp_status === transaction.status) {
      return { status: 'skipped', reason: 'resultado ya aplicado' };
    }
    if (payment.status === 'SUCCEEDED' && transaction.status !== 'VOIDED') {
      return { status: 'skipped', reason: 'pago ya aprobado' };
    }
    const now = this.now();
    const finalized =
      transaction.status === 'PENDING'
        ? null
        : transaction.finalizedAt
          ? new Date(transaction.finalizedAt)
          : now;
    await tx`
      UPDATE billing.payment SET
        psp_reference = COALESCE(${transaction.id}, psp_reference), psp_status = ${transaction.status},
        status_message = ${transaction.statusMessage ?? null}, raw = ${toJson(tx as never, pspSnapshot(transaction))},
        payment_link_id = COALESCE(${transaction.paymentLinkId ?? null}, payment_link_id),
        status = ${transaction.status === 'APPROVED' ? 'SUCCEEDED' : transaction.status === 'PENDING' ? 'PENDING' : transaction.status === 'VOIDED' ? 'CANCELLED' : 'FAILED'},
        finalized_at = ${finalized}, updated_at = now()
      WHERE id = ${paymentId}`;
    const updated = (
      await tx<PaymentRow[]>`SELECT * FROM billing.payment WHERE id = ${paymentId}`
    )[0] as PaymentRow;
    const session = payment.session_id
      ? (
          await tx<
            ChargingSessionRow[]
          >`SELECT * FROM sessions.charging_session WHERE id = ${payment.session_id} FOR UPDATE`
        )[0]
      : undefined;
    const chargeBoxId = session ? await this.identityOf(tx, session.charge_point_id) : 'billing';
    const eventBase = {
      paymentId,
      sessionId: payment.session_id,
      driverId: payment.driver_id,
      amountMinor: String(payment.amount_minor),
      currency: payment.currency,
      psp: payment.psp,
      pspReference: transaction.id,
      kind: payment.kind,
      attempt: payment.attempt,
      source,
    };
    if (transaction.status === 'APPROVED') {
      if (session) {
        await tx`
          UPDATE sessions.charging_session SET
            state = CASE WHEN state = 'SETTLED' THEN 'PAID'::sessions.session_state ELSE state END,
            state_changed_at = CASE WHEN state = 'SETTLED' THEN ${now} ELSE state_changed_at END,
            paid_at = COALESCE(paid_at, ${now}), payment_status = 'CAPTURED', last_payment_id = ${paymentId},
            app_seq = app_seq + 1, updated_at = now()
          WHERE id = ${session.id}`;
        await tx`
          UPDATE billing.debt SET status = 'PAID', paid_payment_id = ${paymentId}, closed_at = ${now}, updated_at = now()
          WHERE status = 'OPEN' AND (id = ${payment.debt_id ?? null}::uuid OR session_id = ${session.id})`;
        const refreshed = (
          await tx<
            ChargingSessionRow[]
          >`SELECT * FROM sessions.charging_session WHERE id = ${session.id}`
        )[0] as ChargingSessionRow;
        await issueReceipt(tx, refreshed, chargeBoxId);
      } else if (payment.debt_id) {
        await tx`UPDATE billing.debt SET status = 'PAID', paid_payment_id = ${paymentId}, closed_at = ${now}, updated_at = now() WHERE id = ${payment.debt_id} AND status = 'OPEN'`;
      }
      if (payment.driver_id) await this.unblockIfClear(tx, payment.driver_id, now);
      await appendEvent(tx, {
        name: 'payment.captured',
        tenantId: payment.tenant_id,
        aggregate: { type: 'payment', id: paymentId },
        orderingKey: chargeBoxId,
        occurredAt: now,
        payload: eventBase,
      });
      this.logger.info(
        { paymentId, sessionId: payment.session_id, amount: String(payment.amount_minor) },
        'cobro aprobado',
      );
      return { status: 'charged', payment: updated, pspStatus: 'APPROVED' };
    }
    if (transaction.status === 'DECLINED' || transaction.status === 'ERROR') {
      if (session) {
        await this.registerDecline(
          tx,
          session,
          paymentId,
          transaction.status,
          transaction.statusMessage ?? transaction.status,
          now,
        );
      }
      await appendEvent(tx, {
        name: 'payment.failed',
        tenantId: payment.tenant_id,
        aggregate: { type: 'payment', id: paymentId },
        orderingKey: chargeBoxId,
        occurredAt: now,
        payload: {
          ...eventBase,
          status: transaction.status,
          message: transaction.statusMessage ?? null,
        },
      });
      return { status: 'charged', payment: updated, pspStatus: transaction.status };
    }
    if (transaction.status === 'VOIDED') {
      if (session && payment.status === 'SUCCEEDED') {
        await tx`UPDATE sessions.charging_session SET payment_status = 'REFUNDED', app_seq = app_seq + 1, updated_at = now() WHERE id = ${session.id}`;
      }
      await appendEvent(tx, {
        name: 'payment.voided',
        tenantId: payment.tenant_id,
        aggregate: { type: 'payment', id: paymentId },
        orderingKey: chargeBoxId,
        occurredAt: now,
        payload: eventBase,
      });
      return { status: 'charged', payment: updated, pspStatus: 'VOIDED' };
    }
    return { status: 'charged', payment: updated, pspStatus: 'PENDING' };
  }

  /** Cobro rechazado: deuda abierta con calendario de reintentos y bloqueo del conductor (ADR 0002, punto 6). */
  private async registerDecline(
    tx: ISql,
    session: ChargingSessionRow,
    paymentId: string | null,
    code: string,
    message: string,
    now: Date,
  ): Promise<void> {
    const schedule = await resolveParam<number[]>(tx, 'billing.retry_schedule_h', {
      tenantId: session.tenant_id,
    });
    const existing = (
      await tx<DebtRow[]>`SELECT * FROM billing.debt WHERE session_id = ${session.id} FOR UPDATE`
    )[0];
    const attempts = (existing?.attempts ?? 0) + 1;
    const waitH = Array.isArray(schedule) ? schedule[attempts - 1] : undefined;
    const nextAttempt =
      typeof waitH === 'number' ? new Date(now.getTime() + waitH * 3_600_000) : null;
    if (existing) {
      await tx`
        UPDATE billing.debt SET status = 'OPEN', attempts = ${attempts}, next_attempt_at = ${nextAttempt}, last_error = ${`${code}: ${message}`.slice(0, 300)},
               amount_minor = ${String(session.total_minor ?? 0n)}::bigint, updated_at = now(), closed_at = NULL
        WHERE id = ${existing.id}`;
    } else {
      await tx`
        INSERT INTO billing.debt (id, tenant_id, driver_id, session_id, amount_minor, currency, status, attempts, next_attempt_at, last_error)
        VALUES (${randomUUID()}, ${session.tenant_id}, ${session.driver_id}, ${session.id}, ${String(session.total_minor ?? 0n)}::bigint,
                ${session.currency ?? 'COP'}, 'OPEN', ${attempts}, ${nextAttempt}, ${`${code}: ${message}`.slice(0, 300)})`;
    }
    await tx`
      UPDATE sessions.charging_session SET payment_status = 'FAILED', last_payment_id = COALESCE(${paymentId}, last_payment_id),
             app_seq = app_seq + 1, updated_at = now() WHERE id = ${session.id}`;
    const blockOnDebt = await resolveParam<boolean>(tx, 'billing.block_on_debt', {
      tenantId: session.tenant_id,
    });
    if (blockOnDebt && session.driver_id) {
      await tx`
        UPDATE auth.driver SET billing_status = 'BLOCKED_DEBT', blocked_reason = ${`Cobro pendiente de la sesión ${session.session_no}`},
               blocked_at = COALESCE(blocked_at, ${now}), updated_at = now()
        WHERE id = ${session.driver_id} AND billing_status = 'OK'`;
    }
    this.logger.warn(
      { sessionId: session.id, attempts, nextAttempt, code },
      'cobro rechazado; deuda registrada',
    );
  }

  private async waive(
    tx: ISql,
    session: ChargingSessionRow,
    reason: string,
    actor: string,
  ): Promise<void> {
    const now = this.now();
    await tx`
      UPDATE sessions.charging_session SET state = 'PAID', state_changed_at = ${now}, paid_at = ${now}, payment_status = 'WAIVED',
             app_seq = app_seq + 1, updated_at = now() WHERE id = ${session.id}`;
    const refreshed = (
      await tx<
        ChargingSessionRow[]
      >`SELECT * FROM sessions.charging_session WHERE id = ${session.id}`
    )[0] as ChargingSessionRow;
    await issueReceipt(tx, refreshed, await this.identityOf(tx, session.charge_point_id));
    this.logger.info({ sessionId: session.id, reason, actor }, 'sesión sin cobro');
  }

  private async unblockIfClear(tx: ISql, driverId: string, now: Date): Promise<boolean> {
    const open =
      await tx`SELECT 1 FROM billing.debt WHERE driver_id = ${driverId} AND status = 'OPEN' LIMIT 1`;
    if (open.length > 0) return false;
    const result = await tx`
      UPDATE auth.driver SET billing_status = 'OK', blocked_reason = NULL, blocked_at = NULL, updated_at = now()
      WHERE id = ${driverId} AND billing_status = 'BLOCKED_DEBT'`;
    if (result.count > 0)
      this.logger.info({ driverId, at: now.toISOString() }, 'conductor desbloqueado: sin deuda');
    return true;
  }

  // ---- webhooks ----

  async processWebhook(body: unknown): Promise<WebhookOutcome> {
    const parsed = this.gateway.parseWebhook(body);
    const inserted = await this.sql<{ id: string }[]>`
      INSERT INTO billing.webhook_inbox (id, psp, dedupe_key, event, psp_environment, checksum_valid, payload, transaction_id)
      VALUES (${randomUUID()}, ${this.gateway.provider}, ${parsed.dedupeKey}, ${parsed.event}, ${parsed.environment},
              ${parsed.checksumValid}, ${toJson(this.sql as never, body ?? {})}, ${parsed.transaction?.id ?? null})
      ON CONFLICT (psp, dedupe_key) DO UPDATE SET received_at = now()
      WHERE billing.webhook_inbox.processed_at IS NULL
      RETURNING id`;
    const inboxId = inserted[0]?.id ?? null;
    if (!inboxId) return { accepted: true, outcome: 'DUPLICATE', inboxId: null };
    const finish = async (outcome: WebhookOutcome['outcome'], error?: string) => {
      await this.sql`
        UPDATE billing.webhook_inbox SET processed_at = ${outcome === 'ERROR' ? null : this.now()}, outcome = ${outcome}, error = ${error ?? null}
        WHERE id = ${inboxId}`;
    };
    if (!parsed.checksumValid) {
      await finish('INVALID_CHECKSUM');
      this.logger.warn({ inboxId, event: parsed.event }, 'webhook con checksum inválido');
      return { accepted: false, outcome: 'INVALID_CHECKSUM', inboxId };
    }
    if (parsed.event !== 'transaction.updated' || !parsed.transaction) {
      await finish('IGNORED');
      return { accepted: true, outcome: 'IGNORED', inboxId };
    }
    try {
      const outcome = await this.sql.begin((tx) =>
        this.applyFromPsp(tx, parsed.transaction as GatewayTransaction, 'webhook'),
      );
      await finish(outcome);
      return { accepted: true, outcome, inboxId };
    } catch (error) {
      await finish('ERROR', (error as Error).message.slice(0, 300));
      this.logger.error({ err: error, inboxId }, 'error procesando el webhook');
      return { accepted: false, outcome: 'ERROR', inboxId };
    }
  }

  private async applyFromPsp(
    tx: ISql,
    transaction: GatewayTransaction,
    source: 'webhook' | 'poll',
  ): Promise<WebhookOutcome['outcome']> {
    const payments = await tx<PaymentRow[]>`
      SELECT * FROM billing.payment WHERE psp = ${this.gateway.provider}
        AND (psp_reference = ${transaction.id} OR (psp_reference IS NULL AND reference = ${transaction.reference}))
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE`;
    const payment = payments[0];
    if (payment) {
      await this.applyOutcome(tx, payment.id, transaction, source);
      return 'APPLIED';
    }
    if (transaction.paymentLinkId) {
      const debts = await tx<
        DebtRow[]
      >`SELECT * FROM billing.debt WHERE payment_link_id = ${transaction.paymentLinkId} FOR UPDATE`;
      const debt = debts[0];
      if (!debt) return 'UNKNOWN_LINK';
      const created = await tx<PaymentRow[]>`
        INSERT INTO billing.payment
          (id, tenant_id, session_id, driver_id, kind, amount_minor, currency, status, psp, psp_reference, idempotency_key, reference,
           attempt, psp_status, psp_environment, payment_link_id, debt_id, requested_by, created_at, updated_at)
        VALUES (${randomUUID()}, ${debt.tenant_id}, ${debt.session_id}, ${debt.driver_id}, 'DEBT', ${transaction.amountMinor.toString()}::bigint,
                ${transaction.currency}, 'PENDING', ${this.gateway.provider}, ${transaction.id}, ${`link:${transaction.id}`}, ${transaction.reference},
                ${debt.attempts + 1}, 'PENDING', ${this.gateway.environment}, ${transaction.paymentLinkId}, ${debt.id}, 'driver:link', ${this.now()}, ${this.now()})
        ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now()
        RETURNING *`;
      await this.applyOutcome(tx, (created[0] as PaymentRow).id, transaction, 'link');
      return 'APPLIED';
    }
    return 'UNKNOWN_TRANSACTION';
  }

  /** Pagos PENDING sin webhook: consulta al PSP (worker). */
  async pollPendingPayments(limit = 50): Promise<number> {
    const now = this.now();
    const rows = await this.sql<PaymentRow[]>`
      SELECT p.* FROM billing.payment p
      WHERE p.status = 'PENDING' AND p.psp = ${this.gateway.provider}
        AND p.created_at < ${now} - make_interval(secs => (SELECT COALESCE((config.resolve('billing.pending_poll_after_s', NULL))::int, 120)))
      ORDER BY p.created_at LIMIT ${limit}`;
    let applied = 0;
    for (const payment of rows) {
      if (!payment.psp_reference) {
        await this.sql.begin(async (tx) => {
          await tx`UPDATE billing.payment SET status = 'FAILED', psp_status = 'ERROR', status_message = 'Sin respuesta del PSP', finalized_at = ${now}, updated_at = now() WHERE id = ${payment.id} AND status = 'PENDING'`;
          if (payment.session_id)
            await tx`UPDATE sessions.charging_session SET payment_status = 'NONE', updated_at = now() WHERE id = ${payment.session_id} AND payment_status = 'AUTHORIZED'`;
        });
        continue;
      }
      try {
        const transaction = await this.gateway.getTransaction(payment.psp_reference);
        if (transaction.status === 'PENDING') continue;
        await this.sql.begin((tx) => this.applyOutcome(tx, payment.id, transaction, 'poll'));
        applied += 1;
      } catch (error) {
        this.logger.warn(
          { paymentId: payment.id, err: error },
          'no se pudo consultar el pago pendiente',
        );
      }
    }
    return applied;
  }

  // ---- deudas ----

  async retryDueDebts(limit = 50): Promise<number> {
    const now = this.now();
    const rows = await this.sql<DebtRow[]>`
      SELECT * FROM billing.debt WHERE status = 'OPEN' AND session_id IS NOT NULL AND next_attempt_at IS NOT NULL AND next_attempt_at <= ${now}
      ORDER BY next_attempt_at LIMIT ${limit}`;
    let retried = 0;
    for (const debt of rows) {
      const outcome = await this.chargeSession(debt.session_id as string, {
        requestedBy: 'system:retry',
        force: true,
      });
      if (outcome.status === 'charged') retried += 1;
    }
    return retried;
  }

  async listDebts(filter: {
    tenantId: string;
    driverId?: string | undefined;
    status?: string | undefined;
    limit?: number | undefined;
  }): Promise<DebtRow[]> {
    return this.sql<DebtRow[]>`
      SELECT * FROM billing.debt WHERE tenant_id = ${filter.tenantId}
        AND (${filter.driverId ?? null}::uuid IS NULL OR driver_id = ${filter.driverId ?? null})
        AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      ORDER BY created_at DESC LIMIT ${filter.limit ?? 100}`;
  }

  async getDebt(id: string): Promise<DebtRow> {
    const rows = await this.sql<DebtRow[]>`SELECT * FROM billing.debt WHERE id = ${id}`;
    const row = rows[0];
    if (!row) throw new NotFoundError('debt', id);
    return row;
  }

  /** Enlace de checkout de Wompi para saldar la deuda (tarjeta, PSE o Nequi); reutiliza uno vigente. */
  async createDebtPaymentLink(
    debtId: string,
    options: { requestedBy: string; redirectUrl?: string | undefined },
  ): Promise<DebtRow> {
    const debt = await this.getDebt(debtId);
    if (debt.status !== 'OPEN')
      throw new ConflictError(`La deuda está ${debt.status}`, 'DEBT_NOT_OPEN');
    const now = this.now();
    if (debt.payment_link_url && debt.payment_link_expires_at && debt.payment_link_expires_at > now)
      return debt;
    const validityH = await resolveParam<number>(this.sql, 'billing.payment_link_validity_h', {
      tenantId: debt.tenant_id,
    });
    const expiresAt = new Date(now.getTime() + validityH * 3_600_000);
    const sessionNo = debt.session_id
      ? ((
          await this.sql<
            { session_no: string }[]
          >`SELECT session_no FROM sessions.charging_session WHERE id = ${debt.session_id}`
        )[0]?.session_no ?? '')
      : '';
    const link = await this.gateway.createPaymentLink({
      name: `Volt ${sessionNo || 'deuda'}`.trim(),
      description: `Pago pendiente de la carga ${sessionNo}`.trim(),
      amountMinor: BigInt(debt.amount_minor),
      currency: debt.currency,
      currencyExponent: currencyExponent(debt.currency),
      reference: `DEBT-${debt.id}`,
      singleUse: true,
      redirectUrl: options.redirectUrl,
      expiresAt: expiresAt.toISOString(),
    });
    const rows = await this.sql<DebtRow[]>`
      UPDATE billing.debt SET payment_link_id = ${link.id}, payment_link_url = ${link.url}, payment_link_expires_at = ${expiresAt}, updated_at = now()
      WHERE id = ${debtId} RETURNING *`;
    this.logger.info(
      { debtId, requestedBy: options.requestedBy },
      'enlace de pago de deuda creado',
    );
    return rows[0] as DebtRow;
  }

  async waiveDebt(debtId: string, options: { actor: string; reason: string }): Promise<DebtRow> {
    const now = this.now();
    return this.sql.begin(async (tx) => {
      const debts = await tx<DebtRow[]>`SELECT * FROM billing.debt WHERE id = ${debtId} FOR UPDATE`;
      const debt = debts[0];
      if (!debt) throw new NotFoundError('debt', debtId);
      if (debt.status !== 'OPEN')
        throw new ConflictError(`La deuda está ${debt.status}`, 'DEBT_NOT_OPEN');
      const rows = await tx<DebtRow[]>`
        UPDATE billing.debt SET status = 'WAIVED', waived_by = ${options.actor}, waived_reason = ${options.reason}, closed_at = ${now}, updated_at = now()
        WHERE id = ${debtId} RETURNING *`;
      if (debt.session_id) {
        const sessions = await tx<
          ChargingSessionRow[]
        >`SELECT * FROM sessions.charging_session WHERE id = ${debt.session_id} FOR UPDATE`;
        const session = sessions[0];
        if (session && session.state === 'SETTLED')
          await this.waive(tx, session, `DEUDA_CONDONADA: ${options.reason}`, options.actor);
      }
      await this.unblockIfClear(tx, debt.driver_id, now);
      return rows[0] as DebtRow;
    });
  }

  async blockDriver(driverId: string, options: { actor: string; reason: string }): Promise<void> {
    const result = await this.sql`
      UPDATE auth.driver SET billing_status = 'BLOCKED_MANUAL', blocked_reason = ${options.reason}, blocked_at = ${this.now()}, updated_at = now()
      WHERE id = ${driverId}`;
    if (result.count === 0) throw new NotFoundError('driver', driverId);
    this.logger.warn(
      { driverId, actor: options.actor, reason: options.reason },
      'conductor bloqueado manualmente',
    );
  }

  async unblockDriver(
    driverId: string,
    options: { actor: string; force?: boolean | undefined },
  ): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      if (!options.force) {
        const open =
          await tx`SELECT 1 FROM billing.debt WHERE driver_id = ${driverId} AND status = 'OPEN' LIMIT 1`;
        if (open.length > 0)
          throw new ConflictError(
            'El conductor tiene deuda abierta; condónala o usa force',
            'DEBT_PENDING',
          );
      }
      const result = await tx`
        UPDATE auth.driver SET billing_status = 'OK', blocked_reason = NULL, blocked_at = NULL, updated_at = now() WHERE id = ${driverId}`;
      if (result.count === 0) throw new NotFoundError('driver', driverId);
      this.logger.info({ driverId, actor: options.actor }, 'conductor desbloqueado');
      return true;
    });
  }

  // ---- anulación y reembolso ----

  /** Devuelve un cobro: anulación si el PSP lo permite (mismo día), reembolso en otro caso (ADR 0002, punto 7). */
  async reversePayment(
    paymentId: string,
    options: { actor: string; reason: string; amountMinor?: bigint | undefined },
  ): Promise<PaymentRow> {
    const payments = await this.sql<
      PaymentRow[]
    >`SELECT * FROM billing.payment WHERE id = ${paymentId}`;
    const payment = payments[0];
    if (!payment) throw new NotFoundError('payment', paymentId);
    if (
      payment.status !== 'SUCCEEDED' ||
      (payment.kind !== 'CAPTURE' && payment.kind !== 'DEBT') ||
      !payment.psp_reference
    ) {
      throw new ConflictError('Solo se devuelve un cobro aprobado', 'PAYMENT_NOT_REVERSIBLE');
    }
    const amount = options.amountMinor ?? BigInt(payment.amount_minor);
    if (amount <= 0n || amount > BigInt(payment.amount_minor))
      throw new ConflictError('Importe de devolución inválido', 'INVALID_AMOUNT');
    const full = amount === BigInt(payment.amount_minor);
    let kind: 'VOID' | 'REFUND' = 'REFUND';
    let pspReference: string | null = null;
    let status: 'SUCCEEDED' | 'FAILED' | 'PENDING' = 'FAILED';
    let message: string | null = null;
    if (full) {
      try {
        const voided = await this.gateway.voidTransaction(payment.psp_reference);
        kind = 'VOID';
        pspReference = voided.id;
        status = voided.status === 'VOIDED' ? 'SUCCEEDED' : 'FAILED';
        message = voided.statusMessage;
      } catch (error) {
        if (!(error instanceof PaymentGatewayError) || error.retryable) throw error;
        // La red ya no permite anular: reembolso.
      }
    }
    if (kind === 'REFUND') {
      const refund = await this.gateway.refund({
        transactionId: payment.psp_reference,
        amountMinor: amount,
        currency: payment.currency,
        currencyExponent: currencyExponent(payment.currency),
        reason: options.reason,
        reference: `REF-${paymentId.slice(0, 8)}-${payment.attempt}`,
      });
      pspReference = refund.id;
      status =
        refund.status === 'APPROVED'
          ? 'SUCCEEDED'
          : refund.status === 'PENDING'
            ? 'PENDING'
            : 'FAILED';
      message = refund.status;
    }
    return this.sql.begin(async (tx) => {
      const rows = await tx<PaymentRow[]>`
        INSERT INTO billing.payment
          (id, tenant_id, session_id, driver_id, payment_method_id, kind, amount_minor, currency, status, psp, psp_reference, idempotency_key,
           parent_payment_id, reference, psp_status, status_message, psp_environment, requested_by, finalized_at, raw, created_at, updated_at)
        VALUES (${randomUUID()}, ${payment.tenant_id}, ${payment.session_id}, ${payment.driver_id}, ${payment.payment_method_id}, ${kind},
                ${amount.toString()}::bigint, ${payment.currency}, ${status}, ${this.gateway.provider}, ${kind === 'VOID' ? null : pspReference},
                ${`${kind.toLowerCase()}:${paymentId}:${this.now().getTime()}`}, ${paymentId}, ${`${kind}-${payment.reference ?? paymentId}`},
                ${status === 'SUCCEEDED' ? (kind === 'VOID' ? 'VOIDED' : 'APPROVED') : status}, ${message}, ${this.gateway.environment},
                ${options.actor}, ${status === 'PENDING' ? null : this.now()},
                ${toJson(tx as never, { reason: options.reason, transaction_id: pspReference })}, ${this.now()}, ${this.now()})
        RETURNING *`;
      const reversal = rows[0] as PaymentRow;
      if (status === 'SUCCEEDED' && payment.session_id) {
        await tx`UPDATE sessions.charging_session SET payment_status = 'REFUNDED', app_seq = app_seq + 1, updated_at = now() WHERE id = ${payment.session_id}`;
      }
      if (status === 'SUCCEEDED' && kind === 'VOID') {
        await tx`UPDATE billing.payment SET status = 'CANCELLED', psp_status = 'VOIDED', updated_at = now() WHERE id = ${paymentId}`;
      }
      const chargeBoxId = payment.session_id
        ? await this.identityOf(
            tx,
            (
              await tx<
                { charge_point_id: string }[]
              >`SELECT charge_point_id FROM sessions.charging_session WHERE id = ${payment.session_id}`
            )[0]?.charge_point_id ?? '',
          )
        : 'billing';
      await appendEvent(tx, {
        name: kind === 'VOID' ? 'payment.voided' : 'payment.refunded',
        tenantId: payment.tenant_id,
        aggregate: { type: 'payment', id: reversal.id },
        orderingKey: chargeBoxId,
        occurredAt: this.now(),
        payload: {
          paymentId: reversal.id,
          parentPaymentId: paymentId,
          sessionId: payment.session_id,
          amountMinor: amount.toString(),
          currency: payment.currency,
          status,
          reason: options.reason,
          actor: options.actor,
        },
      });
      return reversal;
    });
  }

  // ---- consultas ----

  async listPayments(filter: {
    tenantId: string;
    sessionId?: string | undefined;
    driverId?: string | undefined;
    limit?: number | undefined;
  }): Promise<PaymentRow[]> {
    return this.sql<PaymentRow[]>`
      SELECT * FROM billing.payment WHERE tenant_id = ${filter.tenantId}
        AND (${filter.sessionId ?? null}::uuid IS NULL OR session_id = ${filter.sessionId ?? null})
        AND (${filter.driverId ?? null}::uuid IS NULL OR driver_id = ${filter.driverId ?? null})
      ORDER BY created_at DESC LIMIT ${filter.limit ?? 100}`;
  }

  async getPayment(id: string): Promise<PaymentRow> {
    const rows = await this.sql<PaymentRow[]>`SELECT * FROM billing.payment WHERE id = ${id}`;
    const row = rows[0];
    if (!row) throw new NotFoundError('payment', id);
    return row;
  }

  async listWebhooks(limit = 100): Promise<WebhookInboxRow[]> {
    return this.sql<
      WebhookInboxRow[]
    >`SELECT * FROM billing.webhook_inbox ORDER BY received_at DESC LIMIT ${limit}`;
  }

  // ---- conciliación ----

  /** Conciliación del día: sesiones liquidadas contra cobros; discrepancias → alarma PAYMENT_RECONCILIATION. */
  async reconcile(day: Date = this.now(), tenantId?: string): Promise<ReconciliationReport> {
    const dayKey = day.toISOString().slice(0, 10);
    const from = new Date(`${dayKey}T00:00:00.000Z`);
    const to = new Date(from.getTime() + 86_400_000);
    const discrepancies: ReconciliationReport['discrepancies'] = [];
    const notCharged = await this.sql<{ id: string; session_no: string }[]>`
      SELECT id, session_no FROM sessions.charging_session
      WHERE state = 'SETTLED' AND payment_status = 'NONE' AND driver_id IS NOT NULL AND total_minor > 0
        AND settled_at < ${this.now()} - interval '1 hour' AND settled_at >= ${from} AND settled_at < ${to}`;
    for (const s of notCharged)
      discrepancies.push({
        kind: 'NOT_CHARGED',
        sessionId: s.id,
        paymentId: null,
        detail: `${s.session_no} liquidada sin cobro`,
      });
    const stuck = await this.sql<{ id: string; session_id: string | null }[]>`
      SELECT id, session_id FROM billing.payment WHERE status = 'PENDING' AND created_at < ${this.now()} - interval '1 hour' AND created_at >= ${from} AND created_at < ${to}`;
    for (const p of stuck)
      discrepancies.push({
        kind: 'PENDING_TOO_LONG',
        sessionId: p.session_id,
        paymentId: p.id,
        detail: 'pago pendiente más de una hora',
      });
    const paidNotApplied = await this.sql<{ id: string; session_id: string }[]>`
      SELECT p.id, p.session_id FROM billing.payment p JOIN sessions.charging_session s ON s.id = p.session_id
      WHERE p.status = 'SUCCEEDED' AND p.kind IN ('CAPTURE','DEBT') AND s.state <> 'PAID' AND p.finalized_at >= ${from} AND p.finalized_at < ${to}`;
    for (const p of paidNotApplied)
      discrepancies.push({
        kind: 'PAID_NOT_APPLIED',
        sessionId: p.session_id,
        paymentId: p.id,
        detail: 'cobro aprobado con sesión no pagada',
      });
    const paidWithout = await this.sql<{ id: string; session_no: string }[]>`
      SELECT s.id, s.session_no FROM sessions.charging_session s
      WHERE s.state = 'PAID' AND s.payment_status = 'CAPTURED' AND s.paid_at >= ${from} AND s.paid_at < ${to}
        AND NOT EXISTS (SELECT 1 FROM billing.payment p WHERE p.session_id = s.id AND p.status = 'SUCCEEDED' AND p.kind IN ('CAPTURE','DEBT'))`;
    for (const s of paidWithout)
      discrepancies.push({
        kind: 'PAID_WITHOUT_PAYMENT',
        sessionId: s.id,
        paymentId: null,
        detail: `${s.session_no} pagada sin cobro aprobado`,
      });
    const stale = await this.sql<{ id: string; session_id: string | null }[]>`
      SELECT id, session_id FROM billing.debt WHERE status = 'OPEN' AND next_attempt_at IS NULL AND created_at < ${this.now()} - interval '7 days'`;
    for (const d of stale)
      discrepancies.push({
        kind: 'DEBT_STALE',
        sessionId: d.session_id,
        paymentId: null,
        detail: `deuda ${d.id} sin reintentos pendientes hace más de 7 días`,
      });
    const counts = (
      await this.sql<{ settled: number; paid: number; succeeded: number; open: number }[]>`
      SELECT
        (SELECT count(*)::int FROM sessions.charging_session WHERE state = 'SETTLED' AND settled_at >= ${from} AND settled_at < ${to}) AS settled,
        (SELECT count(*)::int FROM sessions.charging_session WHERE state = 'PAID' AND paid_at >= ${from} AND paid_at < ${to}) AS paid,
        (SELECT count(*)::int FROM billing.payment WHERE status = 'SUCCEEDED' AND finalized_at >= ${from} AND finalized_at < ${to}) AS succeeded,
        (SELECT count(*)::int FROM billing.debt WHERE status = 'OPEN') AS open`
    )[0] ?? { settled: 0, paid: 0, succeeded: 0, open: 0 };
    const report: ReconciliationReport = {
      day: dayKey,
      discrepancies,
      counts: {
        sessionsSettled: counts.settled,
        sessionsPaid: counts.paid,
        paymentsSucceeded: counts.succeeded,
        debtsOpen: counts.open,
      },
    };
    const tenant =
      tenantId ??
      (
        await this.sql<
          { tenant_id: string }[]
        >`SELECT tenant_id FROM sessions.charging_session ORDER BY requested_at DESC LIMIT 1`
      )[0]?.tenant_id;
    if (tenant) {
      const fingerprint = `PAYMENT_RECONCILIATION|${dayKey}`;
      if (discrepancies.length > 0) {
        await raiseAlarm(this.sql, {
          tenantId: tenant,
          kind: 'PAYMENT_RECONCILIATION',
          severity: 'WARNING',
          fingerprint,
          details: {
            day: dayKey,
            discrepancies: discrepancies.slice(0, 50),
            counts: report.counts,
          },
        });
      } else {
        await resolveAlarm(this.sql, fingerprint, 'conciliación sin discrepancias').catch(
          () => undefined,
        );
      }
    }
    return report;
  }

  private async identityOf(db: ISql, chargePointId: string): Promise<string> {
    const rows = await db<
      { charge_box_id: string }[]
    >`SELECT charge_box_id FROM assets.charge_point WHERE id = ${chargePointId}`;
    return rows[0]?.charge_box_id ?? chargePointId;
  }
}
