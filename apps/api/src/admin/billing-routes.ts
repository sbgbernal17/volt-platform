/**
 * Rutas de administración de pagos (iteración 5): cobros, devoluciones, deudas, bloqueo de
 * conductores, medios de pago, bandeja de webhooks, conciliación y ejecución manual de los trabajos.
 */
import {
  type BillingService,
  CsmsError,
  ForbiddenError,
  getReceipt,
  listPaymentMethods,
  renderReceiptHtml,
  resolveParam,
} from '@volt/csms';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { actorOf, serialize } from './routes.ts';
import { hasPermission, staffOf } from './staff-auth.ts';

export interface BillingAdminOptions {
  sql: Sql;
  billing: BillingService | undefined;
  tenantId: string;
}

const params = z.object({ id: z.string().uuid() });

export async function billingAdminRoutes(
  app: FastifyInstance,
  options: BillingAdminOptions,
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

  app.get('/payments', async (request) => {
    const query = z
      .object({
        sessionId: z.string().uuid().optional(),
        driverId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(request.query ?? {});
    return { items: serialize(await requireBilling().listPayments({ tenantId, ...query })) };
  });
  app.get('/payments/:id', async (request) =>
    serialize(await requireBilling().getPayment(params.parse(request.params).id)),
  );
  /**
   * SUPPORT devuelve o condona solo hasta `billing.support_refund_limit_minor`; por encima hace falta
   * un administrador (OPS §7.4, "reembolsos hasta un límite").
   */
  const assertRefundWithinLimit = async (request: FastifyRequest, amountMinor: bigint) => {
    if (hasPermission(request, 'billing:operate') && staffOf(request).role !== 'SUPPORT') return;
    const limit = await resolveParam<unknown>(sql, 'billing.support_refund_limit_minor', {
      tenantId,
    });
    const limitMinor = BigInt(typeof limit === 'number' ? Math.trunc(limit) : String(limit ?? 0));
    if (amountMinor > limitMinor) {
      throw new ForbiddenError(
        `El importe supera el límite de ${limitMinor.toString()} para el rol SUPPORT`,
        'REFUND_LIMIT',
        { limitMinor: limitMinor.toString(), amountMinor: amountMinor.toString() },
      );
    }
  };

  app.post('/payments/:id/reverse', async (request) => {
    const { id } = params.parse(request.params);
    const body = z
      .object({
        reason: z.string().min(3).max(300),
        amountMinor: z.coerce.number().int().positive().optional(),
      })
      .parse(request.body);
    const payment = await requireBilling().getPayment(id);
    await assertRefundWithinLimit(
      request,
      body.amountMinor === undefined ? BigInt(payment.amount_minor) : BigInt(body.amountMinor),
    );
    return serialize(
      await requireBilling().reversePayment(id, {
        actor: actorOf(request),
        reason: body.reason,
        amountMinor: body.amountMinor === undefined ? undefined : BigInt(body.amountMinor),
      }),
    );
  });
  app.post('/sessions/:id/charge', async (request) => {
    const { id } = params.parse(request.params);
    return serialize(
      await requireBilling().chargeSession(id, { requestedBy: actorOf(request), force: true }),
    );
  });
  app.get('/sessions/:id/receipt', async (request, reply) => {
    const { id } = params.parse(request.params);
    const receipt = await getReceipt(sql, id);
    const query = z
      .object({ format: z.enum(['json', 'html']).default('json') })
      .parse(request.query ?? {});
    if (query.format === 'html') {
      reply.type('text/html; charset=utf-8');
      return renderReceiptHtml(receipt);
    }
    return serialize({
      invoice: receipt.invoice,
      lines: receipt.lines,
      totals: receipt.totals,
      payment: receipt.payment,
    });
  });

  app.get('/debts', async (request) => {
    const query = z
      .object({
        driverId: z.string().uuid().optional(),
        status: z.enum(['OPEN', 'PAID', 'WAIVED']).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(request.query ?? {});
    return { items: serialize(await requireBilling().listDebts({ tenantId, ...query })) };
  });
  app.get('/debts/:id', async (request) =>
    serialize(await requireBilling().getDebt(params.parse(request.params).id)),
  );
  app.post('/debts/:id/pay-link', async (request) => {
    const { id } = params.parse(request.params);
    return serialize(
      await requireBilling().createDebtPaymentLink(id, { requestedBy: actorOf(request) }),
    );
  });
  app.post('/debts/:id/waive', async (request) => {
    const { id } = params.parse(request.params);
    const body = z.object({ reason: z.string().min(3).max(300) }).parse(request.body);
    const debt = await requireBilling().getDebt(id);
    await assertRefundWithinLimit(request, BigInt(debt.amount_minor));
    return serialize(
      await requireBilling().waiveDebt(id, { actor: actorOf(request), reason: body.reason }),
    );
  });
  app.post('/debts/:id/retry', async (request) => {
    const { id } = params.parse(request.params);
    const debt = await requireBilling().getDebt(id);
    if (!debt.session_id)
      throw new CsmsError('La deuda no tiene sesión asociada', 409, 'DEBT_WITHOUT_SESSION');
    return serialize(
      await requireBilling().chargeSession(debt.session_id, {
        requestedBy: actorOf(request),
        force: true,
      }),
    );
  });

  app.post('/drivers/:id/block', async (request) => {
    const { id } = params.parse(request.params);
    const body = z.object({ reason: z.string().min(3).max(300) }).parse(request.body);
    await requireBilling().blockDriver(id, { actor: actorOf(request), reason: body.reason });
    return { blocked: true };
  });
  app.post('/drivers/:id/unblock', async (request) => {
    const { id } = params.parse(request.params);
    const body = z.object({ force: z.boolean().optional() }).parse(request.body ?? {});
    await requireBilling().unblockDriver(id, { actor: actorOf(request), force: body.force });
    return { blocked: false };
  });
  app.get('/drivers/:id/payment-methods', async (request) => ({
    items: serialize(await listPaymentMethods(sql, params.parse(request.params).id)),
  }));

  app.get('/billing/webhooks', async (request) => {
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(500).optional() })
      .parse(request.query ?? {});
    return { items: serialize(await requireBilling().listWebhooks(query.limit)) };
  });
  app.post('/billing/reconcile', async (request) => {
    const body = z
      .object({
        day: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(request.body ?? {});
    return serialize(
      await requireBilling().reconcile(
        body.day ? new Date(`${body.day}T12:00:00Z`) : new Date(),
        tenantId,
      ),
    );
  });
  app.post('/billing/jobs/run', async (request) => {
    const body = z
      .object({ job: z.enum(['charge', 'retry', 'poll', 'all']).default('all') })
      .parse(request.body ?? {});
    const billing = requireBilling();
    const result: Record<string, unknown> = {};
    if (body.job === 'charge' || body.job === 'all') result.charge = await billing.chargePending();
    if (body.job === 'retry' || body.job === 'all') result.retry = await billing.retryDueDebts();
    if (body.job === 'poll' || body.job === 'all')
      result.poll = await billing.pollPendingPayments();
    return serialize(result);
  });
}
