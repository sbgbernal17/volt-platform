/**
 * Resumen de ingresos y estado del proveedor de pagos (ADR 0029). Todo sale de las tablas de
 * cobro: lo cobrado (CAPTURE y DEBT aprobados), lo devuelto, lo pendiente, lo rechazado, por día
 * y por medio de pago, más la deuda abierta y lo facturado en sesiones liquidadas. El día contable
 * es el de Colombia (America/Bogota, sin horario de verano).
 */
import type { GatewayHealth, PaymentGateway } from '@volt/payments';
import type { ISql } from 'postgres';

export const BOGOTA_TIMEZONE = 'America/Bogota';
const BOGOTA_OFFSET_MS = -5 * 3_600_000;

/** Fecha `YYYY-MM-DD` en hora de Colombia. */
export function bogotaDayKey(date: Date): string {
  return new Date(date.getTime() + BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Ventana [00:00, 24:00) en hora de Colombia del día que contiene `date`. */
export function bogotaDayWindow(date: Date): { key: string; from: Date; to: Date } {
  const key = bogotaDayKey(date);
  const from = new Date(`${key}T00:00:00.000Z`);
  from.setTime(from.getTime() - BOGOTA_OFFSET_MS);
  return { key, from, to: new Date(from.getTime() + 86_400_000) };
}

/** Inicio (UTC) de un día `YYYY-MM-DD` de Colombia. */
export function bogotaDayStart(key: string): Date {
  const start = new Date(`${key}T00:00:00.000Z`);
  start.setTime(start.getTime() - BOGOTA_OFFSET_MS);
  return start;
}

export interface PaymentsSummaryInput {
  tenantId: string;
  from: Date;
  to: Date;
  /** `sandbox`, `production` o `fake`; sin valor no filtra (mezcla ambientes). */
  environment?: string | null | undefined;
  timezone?: string | undefined;
}

export interface PaymentsSummary {
  from: string;
  to: string;
  timezone: string;
  environment: string | null;
  totals: {
    collectedMinor: bigint;
    collectedCount: number;
    refundedMinor: bigint;
    refundedCount: number;
    voidedMinor: bigint;
    pendingMinor: bigint;
    pendingCount: number;
    declinedMinor: bigint;
    declinedCount: number;
    errorCount: number;
    netMinor: bigint;
  };
  byDay: { day: string; collectedMinor: bigint; refundedMinor: bigint; count: number }[];
  byMethod: { method: string; collectedMinor: bigint; count: number }[];
  debts: { openCount: number; openMinor: bigint };
  sessions: { settledCount: number; billedMinor: bigint; paidMinor: bigint };
}

export async function summarizePayments(
  db: ISql,
  input: PaymentsSummaryInput,
): Promise<PaymentsSummary> {
  const timezone = input.timezone ?? BOGOTA_TIMEZONE;
  const environment = input.environment ?? null;
  const totals = (
    await db<
      {
        collected_minor: bigint;
        collected_count: number;
        refunded_minor: bigint;
        refunded_count: number;
        voided_minor: bigint;
        pending_minor: bigint;
        pending_count: number;
        declined_minor: bigint;
        declined_count: number;
        error_count: number;
      }[]
    >`
    SELECT
      COALESCE(SUM(amount_minor) FILTER (WHERE kind IN ('CAPTURE','DEBT') AND status = 'SUCCEEDED'), 0)::bigint AS collected_minor,
      COUNT(*) FILTER (WHERE kind IN ('CAPTURE','DEBT') AND status = 'SUCCEEDED')::int AS collected_count,
      COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'REFUND' AND status = 'SUCCEEDED'), 0)::bigint AS refunded_minor,
      COUNT(*) FILTER (WHERE kind = 'REFUND' AND status = 'SUCCEEDED')::int AS refunded_count,
      COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'VOID' AND status = 'SUCCEEDED'), 0)::bigint AS voided_minor,
      COALESCE(SUM(amount_minor) FILTER (WHERE status = 'PENDING'), 0)::bigint AS pending_minor,
      COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending_count,
      COALESCE(SUM(amount_minor) FILTER (WHERE status = 'FAILED' AND psp_status = 'DECLINED'), 0)::bigint AS declined_minor,
      COUNT(*) FILTER (WHERE status = 'FAILED' AND psp_status = 'DECLINED')::int AS declined_count,
      COUNT(*) FILTER (WHERE status = 'FAILED' AND psp_status = 'ERROR')::int AS error_count
    FROM billing.payment
    WHERE tenant_id = ${input.tenantId}
      AND COALESCE(finalized_at, created_at) >= ${input.from} AND COALESCE(finalized_at, created_at) < ${input.to}
      AND (${environment}::text IS NULL OR psp_environment = ${environment})`
  )[0];
  const byDay = await db<
    { day: string; collected_minor: bigint; refunded_minor: bigint; count: number }[]
  >`
    SELECT to_char((COALESCE(finalized_at, created_at) AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS day,
           COALESCE(SUM(amount_minor) FILTER (WHERE kind IN ('CAPTURE','DEBT') AND status = 'SUCCEEDED'), 0)::bigint AS collected_minor,
           COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'REFUND' AND status = 'SUCCEEDED'), 0)::bigint AS refunded_minor,
           COUNT(*) FILTER (WHERE kind IN ('CAPTURE','DEBT') AND status = 'SUCCEEDED')::int AS count
    FROM billing.payment
    WHERE tenant_id = ${input.tenantId}
      AND COALESCE(finalized_at, created_at) >= ${input.from} AND COALESCE(finalized_at, created_at) < ${input.to}
      AND (${environment}::text IS NULL OR psp_environment = ${environment})
    GROUP BY 1 ORDER BY 1`;
  const byMethod = await db<{ method: string; collected_minor: bigint; count: number }[]>`
    SELECT COALESCE(pm.kind, CASE WHEN p.kind = 'DEBT' THEN 'LINK' END, p.raw->>'payment_method_type', 'UNKNOWN') AS method,
           COALESCE(SUM(p.amount_minor), 0)::bigint AS collected_minor,
           COUNT(*)::int AS count
    FROM billing.payment p
    LEFT JOIN billing.payment_method pm ON pm.id = p.payment_method_id
    WHERE p.tenant_id = ${input.tenantId} AND p.kind IN ('CAPTURE','DEBT') AND p.status = 'SUCCEEDED'
      AND COALESCE(p.finalized_at, p.created_at) >= ${input.from} AND COALESCE(p.finalized_at, p.created_at) < ${input.to}
      AND (${environment}::text IS NULL OR p.psp_environment = ${environment})
    GROUP BY 1 ORDER BY 2 DESC`;
  const debts = (
    await db<{ open_count: number; open_minor: bigint }[]>`
    SELECT COUNT(*)::int AS open_count, COALESCE(SUM(amount_minor), 0)::bigint AS open_minor
    FROM billing.debt WHERE tenant_id = ${input.tenantId} AND status = 'OPEN'`
  )[0];
  const sessions = (
    await db<{ settled_count: number; billed_minor: bigint; paid_minor: bigint }[]>`
    SELECT COUNT(*)::int AS settled_count,
           COALESCE(SUM(total_minor), 0)::bigint AS billed_minor,
           COALESCE(SUM(total_minor) FILTER (WHERE state = 'PAID'), 0)::bigint AS paid_minor
    FROM sessions.charging_session
    WHERE tenant_id = ${input.tenantId} AND state IN ('SETTLED', 'PAID') AND is_test = false
      AND settled_at >= ${input.from} AND settled_at < ${input.to}`
  )[0];
  const t = totals ?? {
    collected_minor: 0n,
    collected_count: 0,
    refunded_minor: 0n,
    refunded_count: 0,
    voided_minor: 0n,
    pending_minor: 0n,
    pending_count: 0,
    declined_minor: 0n,
    declined_count: 0,
    error_count: 0,
  };
  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    timezone,
    environment,
    totals: {
      collectedMinor: BigInt(t.collected_minor),
      collectedCount: t.collected_count,
      refundedMinor: BigInt(t.refunded_minor),
      refundedCount: t.refunded_count,
      voidedMinor: BigInt(t.voided_minor),
      pendingMinor: BigInt(t.pending_minor),
      pendingCount: t.pending_count,
      declinedMinor: BigInt(t.declined_minor),
      declinedCount: t.declined_count,
      errorCount: t.error_count,
      netMinor: BigInt(t.collected_minor) - BigInt(t.refunded_minor),
    },
    byDay: byDay.map((d) => ({
      day: d.day,
      collectedMinor: BigInt(d.collected_minor),
      refundedMinor: BigInt(d.refunded_minor),
      count: d.count,
    })),
    byMethod: byMethod.map((m) => ({
      method: m.method,
      collectedMinor: BigInt(m.collected_minor),
      count: m.count,
    })),
    debts: { openCount: debts?.open_count ?? 0, openMinor: BigInt(debts?.open_minor ?? 0n) },
    sessions: {
      settledCount: sessions?.settled_count ?? 0,
      billedMinor: BigInt(sessions?.billed_minor ?? 0n),
      paidMinor: BigInt(sessions?.paid_minor ?? 0n),
    },
  };
}

export interface ProviderStatus {
  provider: string;
  environment: string;
  configured: boolean;
  health: GatewayHealth | null;
  lastWebhookAt: Date | null;
  lastWebhookOutcome: string | null;
  webhooks24h: { applied: number; invalidChecksum: number; other: number };
  lastCaptureAt: Date | null;
  pending: { count: number; oldestAt: Date | null };
  last24h: { approved: number; declined: number; errors: number };
  openReconciliationAlarms: number;
  /** Medios de pago activos cuya fuente sigue PENDING o ERROR en el proveedor (3DS sin terminar). */
  unconfirmedSources: number;
  checkedAt: Date;
}

/** Señales de que el proveedor funciona: respuesta del comercio, webhooks recientes y cobros. */
export async function providerStatus(
  db: ISql,
  input: { tenantId: string; gateway: PaymentGateway | undefined; now?: Date | undefined },
): Promise<ProviderStatus> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const gateway = input.gateway;
  const environment = gateway?.environment ?? 'none';
  const health = gateway?.health ? await gateway.health() : null;
  const lastWebhook = (
    await db<{ received_at: Date; outcome: string | null }[]>`
    SELECT received_at, outcome FROM billing.webhook_inbox
    WHERE (${gateway ? environment : null}::text IS NULL OR psp_environment = ${environment})
    ORDER BY received_at DESC LIMIT 1`
  )[0];
  const webhooks = (
    await db<{ applied: number; invalid: number; other: number }[]>`
    SELECT COUNT(*) FILTER (WHERE outcome = 'APPLIED')::int AS applied,
           COUNT(*) FILTER (WHERE checksum_valid = false)::int AS invalid,
           COUNT(*) FILTER (WHERE checksum_valid = true AND COALESCE(outcome, '') <> 'APPLIED')::int AS other
    FROM billing.webhook_inbox WHERE received_at >= ${since}
      AND (${gateway ? environment : null}::text IS NULL OR psp_environment = ${environment})`
  )[0];
  const lastCapture = (
    await db<{ finalized_at: Date | null }[]>`
    SELECT finalized_at FROM billing.payment
    WHERE tenant_id = ${input.tenantId} AND status = 'SUCCEEDED' AND kind IN ('CAPTURE','DEBT')
      AND (${gateway ? environment : null}::text IS NULL OR psp_environment = ${environment})
    ORDER BY finalized_at DESC NULLS LAST LIMIT 1`
  )[0];
  const pending = (
    await db<{ count: number; oldest: Date | null }[]>`
    SELECT COUNT(*)::int AS count, MIN(created_at) AS oldest FROM billing.payment
    WHERE tenant_id = ${input.tenantId} AND status = 'PENDING'`
  )[0];
  const last24h = (
    await db<{ approved: number; declined: number; errors: number }[]>`
    SELECT COUNT(*) FILTER (WHERE status = 'SUCCEEDED' AND kind IN ('CAPTURE','DEBT'))::int AS approved,
           COUNT(*) FILTER (WHERE status = 'FAILED' AND psp_status = 'DECLINED')::int AS declined,
           COUNT(*) FILTER (WHERE status = 'FAILED' AND psp_status = 'ERROR')::int AS errors
    FROM billing.payment
    WHERE tenant_id = ${input.tenantId} AND COALESCE(finalized_at, created_at) >= ${since}
      AND (${gateway ? environment : null}::text IS NULL OR psp_environment = ${environment})`
  )[0];
  const alarms = (
    await db<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM ops.alarm
    WHERE tenant_id = ${input.tenantId} AND kind = 'PAYMENT_RECONCILIATION' AND status <> 'RESOLVED'`
  )[0];
  const sources = (
    await db<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM billing.payment_method
    WHERE tenant_id = ${input.tenantId} AND status = 'ACTIVE' AND psp_source_status IN ('PENDING', 'ERROR')`
  )[0];
  return {
    provider: gateway?.provider ?? 'none',
    environment,
    configured: gateway !== undefined,
    health,
    lastWebhookAt: lastWebhook?.received_at ?? null,
    lastWebhookOutcome: lastWebhook?.outcome ?? null,
    webhooks24h: {
      applied: webhooks?.applied ?? 0,
      invalidChecksum: webhooks?.invalid ?? 0,
      other: webhooks?.other ?? 0,
    },
    lastCaptureAt: lastCapture?.finalized_at ?? null,
    pending: { count: pending?.count ?? 0, oldestAt: pending?.oldest ?? null },
    last24h: {
      approved: last24h?.approved ?? 0,
      declined: last24h?.declined ?? 0,
      errors: last24h?.errors ?? 0,
    },
    openReconciliationAlarms: alarms?.count ?? 0,
    unconfirmedSources: sources?.count ?? 0,
    checkedAt: now,
  };
}
