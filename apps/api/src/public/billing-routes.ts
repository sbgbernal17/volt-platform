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
  renderReceiptPdf,
  setDefaultPaymentMethod,
} from '@volt/csms';
import { formatScaled } from '@volt/domain';
import type { FakeGateway } from '@volt/payments';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { driverOf } from './auth.ts';
import { assertDriverReady } from './readiness.ts';

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

  /**
   * Solo con el emulador (PAYMENTS_PROVIDER=fake): la app "tokeniza" la tarjeta de prueba contra la
   * API en lugar del widget de Wompi. Con Wompi real el número de tarjeta nunca pasa por la API.
   */
  app.post('/payment-methods/tokens', async (request, reply) => {
    const gateway = requireBilling().gateway as FakeGateway;
    if (gateway.environment !== 'fake' || typeof gateway.tokenizeCard !== 'function') {
      throw new CsmsError(
        'La tokenización en la API solo existe con el emulador de pagos',
        404,
        'NOT_FOUND',
      );
    }
    const body = z
      .object({
        number: z.string().regex(/^[0-9 ]{13,23}$/),
        expMonth: z.string().regex(/^(0[1-9]|1[0-2])$/),
        expYear: z.string().regex(/^[0-9]{2}$/),
        cvc: z.string().regex(/^[0-9]{3,4}$/),
        cardHolder: z.string().trim().min(2).max(80),
      })
      .parse(request.body);
    reply.code(201);
    return { token: gateway.tokenizeCard(body) };
  });

  app.post('/payment-methods', async (request, reply) => {
    const driver = driverOf(request);
    await assertDriverReady(sql, driver);
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

  // Movimientos del conductor (pantalla Transacciones): cobros, pagos de deuda, devoluciones.
  app.get('/payments', async (request) => {
    const driver = driverOf(request);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).optional() })
      .parse(request.query ?? {});
    const rows = await requireBilling().listPayments({
      tenantId,
      driverId: driver.driverId,
      limit: query.limit ?? 50,
    });
    const sessionIds = [...new Set(rows.map((r) => r.session_id).filter((s): s is string => !!s))];
    const methodIds = [
      ...new Set(rows.map((r) => r.payment_method_id).filter((m): m is string => !!m)),
    ];
    const sessions = sessionIds.length
      ? await sql<
          { id: string; session_no: string }[]
        >`SELECT id, session_no FROM sessions.charging_session WHERE id = ANY(${sessionIds}::uuid[])`
      : [];
    const methods = methodIds.length
      ? await sql<
          { id: string; label: string | null }[]
        >`SELECT id, label FROM billing.payment_method WHERE id = ANY(${methodIds}::uuid[])`
      : [];
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        pspStatus: r.psp_status,
        statusMessage: r.status_message,
        amount: formatScaled(BigInt(r.amount_minor), currencyExponent(r.currency)),
        currency: r.currency,
        sessionId: r.session_id,
        sessionNo: sessions.find((s) => s.id === r.session_id)?.session_no ?? null,
        methodLabel: methods.find((m) => m.id === r.payment_method_id)?.label ?? null,
        reference: r.reference,
        pspReference: r.psp_reference,
        createdAt: r.created_at.toISOString(),
        finalizedAt: r.finalized_at?.toISOString() ?? null,
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

  /**
   * Reintento del cobro pendiente con el medio de pago guardado (petición del dueño del 02-10-2026):
   * el conductor registra una tarjeta válida y paga desde la app sin pasar por el checkout ni por
   * soporte. Un cobro en curso en la pasarela responde `pending` y no se duplica.
   */
  app.post('/debts/:id/retry', async (request) => {
    const driver = driverOf(request);
    const { id } = params.parse(request.params);
    const debt = await requireBilling().getDebt(id);
    if (debt.driver_id !== driver.driverId)
      throw new CsmsError(`debt ${id} no existe`, 404, 'NOT_FOUND');
    if (debt.status !== 'OPEN')
      throw new CsmsError(`La deuda está ${debt.status}`, 409, 'DEBT_NOT_OPEN');
    if (!debt.session_id)
      throw new CsmsError('La deuda no tiene sesión asociada', 409, 'DEBT_WITHOUT_SESSION');
    const outcome = await requireBilling().chargeSession(debt.session_id, {
      requestedBy: `driver:${driver.driverId}`,
      force: true,
    });
    // `charged` significa que la pasarela procesó un intento; el resultado va en `pspStatus`.
    switch (outcome.status) {
      case 'charged':
        if (outcome.pspStatus === 'APPROVED')
          return { status: 'charged', reason: null, message: null };
        if (outcome.pspStatus === 'PENDING')
          return { status: 'pending', reason: 'PENDING_PSP', message: null };
        return {
          status: 'failed',
          reason: outcome.pspStatus,
          message: outcome.payment.status_message ?? null,
        };
      case 'waiting':
        return { status: 'pending', reason: outcome.reason, message: null };
      case 'failed':
        return { status: 'failed', reason: outcome.reason, message: null };
      default:
        return { status: 'skipped', reason: outcome.reason, message: null };
    }
  });

  app.get('/sessions/:id/receipt', async (request, reply) => {
    const driver = driverOf(request);
    const { id } = params.parse(request.params);
    const view = await getSessionView(sql, id);
    if (view.driver_id !== driver.driverId)
      throw new CsmsError(`session ${id} no existe`, 404, 'NOT_FOUND');
    const receipt = await getReceipt(sql, id);
    const query = z
      .object({ format: z.enum(['json', 'html', 'pdf']).default('json') })
      .parse(request.query ?? {});
    if (query.format === 'html') {
      reply.type('text/html; charset=utf-8');
      return renderReceiptHtml(receipt);
    }
    if (query.format === 'pdf') {
      reply.type('application/pdf');
      reply.header(
        'content-disposition',
        `attachment; filename="${receiptFilename(receipt.invoice.number)}"`,
      );
      reply.header('cache-control', 'private, no-store');
      return Buffer.from(await renderReceiptPdf(receipt));
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
      pdf: `/v1/sessions/${id}/receipt?format=pdf`,
    };
  });
}

/** Nombre de archivo del recibo: solo letras, dígitos y guiones. */
export function receiptFilename(number: string): string {
  return `recibo-${number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`;
}

/** Webhook de Wompi: sin autenticación, verificado por checksum, idempotente. */
export async function billingWebhookRoutes(
  app: FastifyInstance,
  options: { billing: BillingService | undefined; redirectUrl?: string | undefined },
): Promise<void> {
  // Algunos paneles comprueban la URL de eventos con un GET antes de guardarla: responde 200 sin
  // tocar nada (los eventos llegan solo por POST).
  app.get('/webhooks/wompi', async () => ({ ok: true, accepts: 'POST' }));
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

  // Checkout emulado (solo con PAYMENTS_PROVIDER=fake): la página que abre "Pagar ahora" en dev.
  // Reproduce lo que hace el checkout de Wompi: cobra el enlace, dispara el webhook y vuelve a la app.
  const fakeGateway = (): FakeGateway | undefined => {
    const gateway = options.billing?.gateway as FakeGateway | undefined;
    return gateway && gateway.environment === 'fake' && typeof gateway.payLink === 'function'
      ? gateway
      : undefined;
  };
  const linkParams = z.object({ linkId: z.string().min(6).max(400) });
  app.get('/pay/emulado/:linkId', async (request, reply) => {
    const gateway = fakeGateway();
    if (!gateway)
      throw new CsmsError('El checkout emulado no existe en este ambiente', 404, 'NOT_FOUND');
    const { linkId } = linkParams.parse(request.params);
    let info: { amountMinor: bigint; currency: string; reference: string; paid: boolean };
    try {
      info = gateway.linkInfo(linkId);
    } catch {
      throw new CsmsError('El enlace de pago no existe', 404, 'NOT_FOUND');
    }
    reply.type('text/html; charset=utf-8');
    return renderFakeCheckout(linkId, info);
  });
  app.post('/pay/emulado/:linkId/:outcome', async (request, reply) => {
    const gateway = fakeGateway();
    if (!gateway || !options.billing)
      throw new CsmsError('El checkout emulado no existe en este ambiente', 404, 'NOT_FOUND');
    const { linkId, outcome } = linkParams
      .extend({ outcome: z.enum(['aprobar', 'rechazar']) })
      .parse(request.params);
    const status = outcome === 'aprobar' ? 'APPROVED' : 'DECLINED';
    let event: Record<string, unknown>;
    try {
      event = gateway.payLink(linkId, status);
    } catch {
      throw new CsmsError('El enlace de pago no existe', 404, 'NOT_FOUND');
    }
    const result = await options.billing.processWebhook(event);
    const reference = gateway.linkInfo(linkId).reference;
    const resultado = status === 'APPROVED' ? 'aprobado' : 'rechazado';
    if (options.redirectUrl) {
      const url = new URL(options.redirectUrl);
      url.searchParams.set('resultado', resultado);
      url.searchParams.set('referencia', reference);
      url.searchParams.set('emulado', '1');
      reply.redirect(url.toString(), 303);
      return;
    }
    reply.type('text/html; charset=utf-8');
    return renderFakeCheckoutDone(resultado, reference, result.outcome);
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FAKE_CHECKOUT_STYLE = `body{margin:0;font-family:Roboto,Arial,sans-serif;background:#f5f5f5;color:#0b0b0b}
.card{max-width:420px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5}
.head{background:#dc2626;color:#fff;padding:20px 24px;font-weight:700;font-size:20px}.body{padding:24px}
.amount{font-size:32px;font-weight:700;margin:8px 0 16px}.muted{color:#525252;font-size:14px;line-height:1.5}
form{display:inline-block;margin:8px 8px 0 0}button{padding:14px 20px;border:0;border-radius:6px;font-weight:700;font-size:15px;cursor:pointer}
.pay{background:#dc2626;color:#fff}.decline{background:#e5e5e5;color:#0b0b0b}`;

/** Página del checkout emulado: importe, referencia y dos botones (pagar o rechazar). */
export function renderFakeCheckout(
  linkId: string,
  info: { amountMinor: bigint; currency: string; reference: string; paid: boolean },
): string {
  const amount = `${formatScaled(info.amountMinor, currencyExponent(info.currency))} ${info.currency}`;
  const action = (outcome: string) => `/v1/pay/emulado/${encodeURIComponent(linkId)}/${outcome}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pago de prueba · VOLT</title><style>${FAKE_CHECKOUT_STYLE}</style></head>
<body><div class="card"><div class="head">Pasarela emulada · VOLT</div><div class="body">
<p class="muted">Ambiente de pruebas: este pago no mueve dinero. En staging y producción esta página es el checkout de Wompi.</p>
<div class="amount">$ ${escapeHtml(amount)}</div>
<p class="muted">Referencia ${escapeHtml(info.reference)}${info.paid ? ' · ya pagado' : ''}</p>
<form method="post" action="${action('aprobar')}"><button class="pay" type="submit">Pagar</button></form>
<form method="post" action="${action('rechazar')}"><button class="decline" type="submit">Rechazar</button></form>
</div></div></body></html>`;
}

function renderFakeCheckoutDone(resultado: string, reference: string, outcome: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Pago ${escapeHtml(resultado)} · VOLT</title><style>${FAKE_CHECKOUT_STYLE}</style></head>
<body><div class="card"><div class="head">Pasarela emulada · VOLT</div><div class="body"><div class="amount">Pago ${escapeHtml(resultado)}</div>
<p class="muted">Referencia ${escapeHtml(reference)} · webhook ${escapeHtml(outcome)}. Vuelva a la app para ver el resultado.</p></div></div></body></html>`;
}
