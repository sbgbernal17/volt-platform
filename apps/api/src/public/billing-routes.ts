/**
 * Rutas de pagos de la app Volt (iteración 5, ADR 0002): medios de pago (token del widget de Wompi
 * → fuente de pago, estado 3DS), estado de cobro y deudas con enlace de pago, recibos y el webhook
 * de Wompi (sin autenticación, verificado por checksum).
 */
import {
  type BillingAuthorizer,
  type BillingService,
  CsmsError,
  currencyExponent,
  getReceipt,
  getSessionView,
  listPaymentMethods,
  type PaymentMethodRow,
  refreshPaymentMethod,
  registerPaymentMethod,
  removePaymentMethod,
  renderReceiptHtml,
  setDefaultPaymentMethod,
} from '@volt/csms';
import { formatScaled } from '@volt/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import { z } from 'zod';

export interface BillingPublicOptions {
  sql: Sql;
  billing: BillingService | undefined;
  authorizer: BillingAuthorizer | undefined;
  tenantId: string;
  redirectUrl?: string | undefined;
}

const params = z.object({ id: z.string().uuid() });
const registerBody = z.object({
  type: z.enum(['CARD', 'NEQUI']).default('CARD'),
  token: z.string().min(4).max(200),
  acceptanceToken: z.string().min(4).max(4000),
  personalDataAuthToken: z.string().min(4).max(4000),
});

export function toPublicPaymentMethod(row: PaymentMethodRow, defaultId: string | null) {
  return {
    id: row.id,
    kind: row.kind,
    brand: row.brand,
    last4: row.last4,
    expiresMonth: row.expires_month,
    expiresYear: row.expires_year,
    label: row.label,
    status: row.status,
    sourceStatus: row.psp_source_status,
    threeDs: row.three_ds,
    isDefault: row.id === defaultId,
    createdAt: row.created_at.toISOString(),
  };
}

const driverOf = (request: FastifyRequest) =>
  request.driver as NonNullable<FastifyRequest['driver']>;

/** Rutas privadas (se registran dentro del ámbito autenticado de /v1). */
export async function billingPrivateRoutes(
  app: FastifyInstance,
  options: BillingPublicOptions,
): Promise<void> {
  const { sql, tenantId } = options;
  const requireBilling = (): BillingService => {
    if (!options.billing)
      throw new CsmsError(
        'Los pagos no están configurados en este ambiente',
        503,
        'PAYMENTS_UNAVAILABLE',
      );
    return options.billing;
  };
  const defaultMethodId = async (driverId: string): Promise<string | null> =>
    (
      await sql<
        { default_payment_method_id: string | null }[]
      >`SELECT default_payment_method_id FROM auth.driver WHERE id = ${driverId}`
    )[0]?.default_payment_method_id ?? null;

  app.get('/payment-methods/acceptance', async () => {
    const tokens = await requireBilling().gateway.getAcceptanceTokens();
    return {
      acceptanceToken: tokens.acceptanceToken,
      acceptancePermalink: tokens.acceptancePermalink,
      personalDataAuthToken: tokens.personalDataAuthToken,
      personalDataPermalink: tokens.personalDataPermalink,
      provider: requireBilling().gateway.provider,
      environment: requireBilling().gateway.environment,
    };
  });

  app.get('/payment-methods', async (request) => {
    const driver = driverOf(request);
    const defaultId = await defaultMethodId(driver.driverId);
    return {
      items: (await listPaymentMethods(sql, driver.driverId)).map((m) =>
        toPublicPaymentMethod(m, defaultId),
      ),
    };
  });

  app.post('/payment-methods', async (request, reply) => {
    const driver = driverOf(request);
    const body = registerBody.parse(request.body);
    const row = await registerPaymentMethod(sql, requireBilling().gateway, {
      tenantId,
      driverId: driver.driverId,
      type: body.type,
      token: body.token,
      acceptanceToken: body.acceptanceToken,
      personalDataAuthToken: body.personalDataAuthToken,
    });
    reply.code(row.psp_source_status === 'PENDING' ? 202 : 201);
    return toPublicPaymentMethod(row, await defaultMethodId(driver.driverId));
  });

  app.get('/payment-methods/:id', async (request) => {
    const driver = driverOf(request);
    const { id } = params.parse(request.params);
    const current = (await listPaymentMethods(sql, driver.driverId)).find((m) => m.id === id);
    if (!current) throw new CsmsError(`payment_method ${id} no existe`, 404, 'NOT_FOUND');
    const row =
      current.psp_source_status === 'PENDING'
        ? await refreshPaymentMethod(sql, requireBilling().gateway, id)
        : current;
    return toPublicPaymentMethod(row, await defaultMethodId(driver.driverId));
  });

  app.post('/payment-methods/:id/default', async (request) => {
    const driver = driverOf(request);
    const { id } = params.parse(request.params);
    const row = await setDefaultPaymentMethod(sql, id, driver.driverId);
    return toPublicPaymentMethod(row, id);
  });

  app.delete('/payment-methods/:id', async (request) => {
    const driver = driverOf(request);
    const { id } = params.parse(request.params);
    await removePaymentMethod(sql, id, driver.driverId);
    return { removed: true };
  });

  app.get('/billing', async (request) => {
    const driver = driverOf(request);
    const row = (
      await sql<
        {
          billing_status: string;
          blocked_reason: string | null;
          default_payment_method_id: string | null;
        }[]
      >`
        SELECT billing_status, blocked_reason, default_payment_method_id FROM auth.driver WHERE id = ${driver.driverId}`
    )[0];
    const check = options.authorizer
      ? await options.authorizer.checkDriver(driver.driverId, tenantId)
      : { ok: true as const };
    const debts = options.billing
      ? await options.billing.listDebts({ tenantId, driverId: driver.driverId })
      : [];
    const sessionNos = debts.length
      ? await sql<
          { id: string; session_no: string }[]
        >`SELECT id, session_no FROM sessions.charging_session WHERE id = ANY(${debts.map((d) => d.session_id).filter((s): s is string => s !== null)}::uuid[])`
      : [];
    return {
      status: row?.billing_status ?? 'OK',
      blockedReason: row?.blocked_reason ?? null,
      canCharge: check.ok,
      reason: check.ok ? null : { code: check.code, message: check.message },
      defaultPaymentMethodId: row?.default_payment_method_id ?? null,
      paymentsConfigured: options.billing !== undefined,
      debts: debts.map((d) => ({
        id: d.id,
        sessionId: d.session_id,
        sessionNo: sessionNos.find((s) => s.id === d.session_id)?.session_no ?? null,
        amount: formatScaled(BigInt(d.amount_minor), currencyExponent(d.currency)),
        currency: d.currency,
        status: d.status,
        attempts: d.attempts,
        nextAttemptAt: d.next_attempt_at?.toISOString() ?? null,
        paymentLink:
          d.payment_link_url && d.payment_link_expires_at && d.payment_link_expires_at > new Date()
            ? { url: d.payment_link_url, expiresAt: d.payment_link_expires_at.toISOString() }
            : null,
        createdAt: d.created_at.toISOString(),
      })),
    };
  });

  app.post('/debts/:id/pay-link', async (request) => {
    const driver = driverOf(request);
    const { id } = params.parse(request.params);
    const debt = await requireBilling().getDebt(id);
    if (debt.driver_id !== driver.driverId)
      throw new CsmsError(`debt ${id} no existe`, 404, 'NOT_FOUND');
    const updated = await requireBilling().createDebtPaymentLink(id, {
      requestedBy: `driver:${driver.driverId}`,
      redirectUrl: options.redirectUrl,
    });
    return {
      url: updated.payment_link_url,
      expiresAt: updated.payment_link_expires_at?.toISOString() ?? null,
    };
  });

  app.get('/sessions/:id/receipt', async (request, reply) => {
    const driver = driverOf(request);
    const { id } = params.parse(request.params);
    const view = await getSessionView(sql, id);
    if (view.driver_id !== driver.driverId)
      throw new CsmsError(`session ${id} no existe`, 404, 'NOT_FOUND');
    const receipt = await getReceipt(sql, id);
    const query = z
      .object({ format: z.enum(['json', 'html']).default('json') })
      .parse(request.query ?? {});
    if (query.format === 'html') {
      reply.type('text/html; charset=utf-8');
      return renderReceiptHtml(receipt);
    }
    return {
      number: receipt.invoice.number,
      issuedAt: receipt.invoice.issued_at.toISOString(),
      sessionId: id,
      sessionNo: view.session_no,
      evseId: view.evse_code,
      chargeBoxId: view.charge_box_id,
      startedAt: view.started_at?.toISOString() ?? null,
      endedAt: view.ended_at?.toISOString() ?? null,
      energyKwh: view.energy_wh === null ? null : Number(view.energy_wh) / 1000,
      lines: receipt.lines,
      totals: receipt.totals,
      taxBreakdown: receipt.invoice.tax_breakdown,
      payment: receipt.payment
        ? {
            provider: receipt.payment.psp,
            reference: receipt.payment.psp_reference ?? receipt.payment.reference,
            paidAt: receipt.payment.finalized_at?.toISOString() ?? null,
          }
        : null,
      paymentStatus: view.payment_status,
      tariff: { code: view.tariff_code, version: view.tariff_version },
      html: `/v1/sessions/${id}/receipt?format=html`,
    };
  });
}

/** Webhook de Wompi: sin autenticación, verificado por checksum, idempotente. */
export async function billingWebhookRoutes(
  app: FastifyInstance,
  options: { billing: BillingService | undefined },
): Promise<void> {
  app.post('/webhooks/wompi', async (request, reply) => {
    if (!options.billing) {
      reply.code(503);
      return { received: false, outcome: 'PAYMENTS_UNAVAILABLE' };
    }
    const result = await options.billing.processWebhook(request.body);
    reply.code(
      result.outcome === 'INVALID_CHECKSUM' ? 401 : result.outcome === 'ERROR' ? 500 : 200,
    );
    return { received: result.accepted, outcome: result.outcome };
  });
}
