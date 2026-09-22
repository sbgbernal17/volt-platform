/**
 * Cobros sobre la base de datos con el emulador de pasarela: validación previa (tarjeta, deuda,
 * bloqueo), cobro aprobado al liquidar con recibo, cobro rechazado con deuda, reintentos programados
 * y bloqueo, enlace de pago que salda la deuda, webhooks idempotentes y con checksum, transacciones
 * pendientes resueltas por webhook o por consulta, devolución, condonación y conciliación.
 */
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { CallOutcome, SendCallInput } from '@volt/gateway-client';
import { FAKE_ACCEPTANCE_TOKENS, FAKE_CARDS, FakeGateway } from '@volt/payments';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommandService, type GatewaySender } from '../commands.ts';
import { createChargePoint, createSite } from '../inventory.ts';
import { ensureBaseTariff } from '../pricing/bootstrap.ts';
import { PricingService } from '../pricing/pricing-service.ts';
import { createDriver } from '../sessions/drivers.ts';
import { listAggregateEvents } from '../sessions/outbox.ts';
import { SessionService } from '../sessions/session-service.ts';
import { type InboundContext, TransactionService } from '../sessions/transaction-service.ts';
import { VOLT_TENANT_ID } from '../types.ts';
import { BillingAuthorizer } from './authorizer.ts';
import { BillingService } from './billing-service.ts';
import { listPaymentMethods, registerPaymentMethod } from './payment-methods.ts';
import { getReceipt, renderReceiptHtml } from './receipts.ts';

const baseUrl = process.env.DATABASE_URL;

class FakeOcpp implements GatewaySender {
  readonly calls: SendCallInput[] = [];
  async sendCall(input: SendCallInput): Promise<CallOutcome> {
    this.calls.push(input);
    return {
      ok: true,
      uniqueId: `u-${this.calls.length}`,
      rttMs: 1,
      podId: 'fake',
      result: { status: 'Accepted' },
    };
  }
}

const T0 = Date.parse('2026-10-06T15:00:00Z');
const at = (minutes: number): Date => new Date(T0 + minutes * 60_000);
const acceptance = {
  acceptanceToken: FAKE_ACCEPTANCE_TOKENS.acceptanceToken,
  personalDataAuthToken: FAKE_ACCEPTANCE_TOKENS.personalDataAuthToken,
};

describe.skipIf(!baseUrl)('cobros con Wompi (emulador)', () => {
  let database: TemporaryDatabase;
  let sql: Sql;
  let chargePointId = '';
  let clock = at(0);
  let minute = 0;
  const psp = new FakeGateway({ eventsSecret: 'secreto' });
  const pspAsync = new FakeGateway({
    provider: 'FAKE-ASYNC',
    eventsSecret: 'secreto-async',
    asyncTransactions: true,
    clock: () => clock,
  });
  let sessions: SessionService;
  let transactions: TransactionService;
  let pricing: PricingService;
  let billing: BillingService;
  let billingAsync: BillingService;
  let authorizer: BillingAuthorizer;
  const ctx = (receivedAt: Date): InboundContext => ({
    chargePoint: {
      id: chargePointId,
      identity: 'CP-BIL-1',
      tenantId: VOLT_TENANT_ID,
      lifecycle: 'OPERATIONAL',
    },
    uniqueId: `msg-${Math.random().toString(16).slice(2)}`,
    receivedAt,
    connectedAt: at(-60),
    heartbeatIntervalS: 1_000_000,
    generation: 1,
  });

  /** Carga completa de `wh` Wh en el conector dado, liquidada; devuelve el id de sesión. */
  const runSession = async (
    driverId: string,
    connectorId: number,
    wh: number,
    channel: 'APP' | 'TEST' = 'APP',
  ) => {
    minute += 10;
    clock = at(minute);
    const session = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: `CP-BIL-1-${connectorId}`,
      driverId: channel === 'TEST' ? null : driverId,
      channel,
      requestedBy: `driver:${driverId}`,
    });
    if (session.state !== 'STARTING') return session;
    const start = await transactions.startTransaction(ctx(at(minute)), {
      connectorId,
      idTag: session.id_tag,
      meterStart: 0,
      timestamp: at(minute).toISOString(),
    });
    minute += 30;
    clock = at(minute);
    await transactions.stopTransaction(ctx(at(minute)), {
      transactionId: start.transactionId,
      meterStop: wh,
      timestamp: at(minute).toISOString(),
      reason: 'EVDisconnected',
    });
    await transactions.onConnectorStatus(ctx(at(minute)), connectorId, 'Available', 'Finishing');
    minute += 1;
    clock = at(minute);
    const settled = await pricing.settle(session.id, { actor: 'test', force: true });
    expect(settled.status).toBe('settled');
    return sessions.get(session.id);
  };

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    sql = createSql(database.url, { max: 4 });
    const site = await createSite(sql, {
      tenantId: VOLT_TENANT_ID,
      code: 'BIL',
      name: 'Sede cobros',
      address: 'a',
      latitude: 4.6,
      longitude: -74,
      timezone: 'America/Bogota',
    });
    const cp = await createChargePoint(sql, {
      tenantId: VOLT_TENANT_ID,
      siteId: site.id,
      chargeBoxId: 'CP-BIL-1',
      connectors: [1, 2, 3, 4].map((n) => ({
        ocppConnectorId: n,
        standard: 'IEC_62196_T2_COMBO',
        powerType: 'DC',
        maxPowerW: 180_000,
      })),
    });
    chargePointId = cp.id;
    await sql`UPDATE assets.charge_point SET lifecycle_status = 'OPERATIONAL', visible_in_app = true, connected = true WHERE id = ${chargePointId}`;
    await sql`UPDATE assets.connector SET ocpp_status = 'Available' WHERE charge_point_id = ${chargePointId}`;
    await ensureBaseTariff(sql, { tenantId: VOLT_TENANT_ID, actor: 'staff:test', now: at(-60) });
    authorizer = new BillingAuthorizer(sql);
    sessions = new SessionService(sql, new CommandService(sql, new FakeOcpp()), {
      clock: () => clock,
      paymentAuthorizer: authorizer,
    });
    pricing = new PricingService(sql, { clock: () => clock });
    transactions = new TransactionService(sql, { pricing, clock: () => clock });
    billing = new BillingService(sql, psp, { clock: () => clock });
    billingAsync = new BillingService(sql, pspAsync, { clock: () => clock });
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await database.drop();
  });

  it('sin tarjeta no se puede cargar; con tarjeta aprobada la primera carga usa el tope reducido', async () => {
    const ana = await createDriver(sql, {
      tenantId: VOLT_TENANT_ID,
      email: 'ana@example.com',
      displayName: 'Ana',
    });
    const denied = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-BIL-1-1',
      driverId: ana.id,
      channel: 'APP',
      requestedBy: 'driver:ana',
    });
    expect(denied).toMatchObject({ state: 'FAILED', failure_code: 'NO_PAYMENT_METHOD' });
    expect(await authorizer.checkDriver(ana.id, VOLT_TENANT_ID)).toMatchObject({
      ok: false,
      code: 'NO_PAYMENT_METHOD',
    });

    const token = psp.tokenizeCard({
      number: FAKE_CARDS.approved,
      expMonth: '12',
      expYear: '30',
      cvc: '123',
      cardHolder: 'ANA',
    });
    const method = await registerPaymentMethod(sql, psp, {
      tenantId: VOLT_TENANT_ID,
      driverId: ana.id,
      type: 'CARD',
      token,
      ...acceptance,
    });
    expect(method).toMatchObject({
      kind: 'CARD',
      brand: 'VISA',
      last4: '4242',
      psp_source_status: 'AVAILABLE',
      label: 'VISA terminada en 4242',
    });
    expect(
      (
        await sql<
          { d: string }[]
        >`SELECT default_payment_method_id AS d FROM auth.driver WHERE id = ${ana.id}`
      )[0]?.d,
    ).toBe(method.id);
    expect(await authorizer.checkDriver(ana.id, VOLT_TENANT_ID)).toEqual({
      ok: true,
      preauthMinor: 100_000n,
    });
    // El token ya no sirve dos veces (la pasarela lo consume).
    await expect(
      registerPaymentMethod(sql, psp, {
        tenantId: VOLT_TENANT_ID,
        driverId: ana.id,
        type: 'CARD',
        token,
        ...acceptance,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    const session = await runSession(ana.id, 1, 10_000);
    expect(session.state).toBe('SETTLED');
    expect(BigInt(session.exposure_limit_minor ?? 0)).toBe(100_000n);
    expect(BigInt(session.total_minor ?? 0)).toBe(13_500n);

    // Cobro al liquidar: aprobado, sesión PAID con recibo, eventos y segunda ejecución sin efecto.
    const outcome = await billing.chargeSession(session.id, { requestedBy: 'system:billing' });
    expect(outcome).toMatchObject({ status: 'charged', pspStatus: 'APPROVED' });
    const paid = await sessions.get(session.id);
    expect(paid).toMatchObject({ state: 'PAID', payment_status: 'CAPTURED', payment_attempts: 1 });
    expect(paid.receipt_id).not.toBeNull();
    const receipt = await getReceipt(sql, session.id);
    expect(receipt.invoice).toMatchObject({
      kind: 'RECEIPT',
      number: session.session_no,
      series: 'R',
    });
    expect(receipt.totals.total).toBe('13500');
    expect(receipt.lines.map((l) => l.dimension)).toEqual(['ENERGY']);
    expect(renderReceiptHtml(receipt)).toContain(session.session_no);
    expect(psp.calls.filter((c) => c.method === 'charge')).toHaveLength(1);
    const lastCharge = psp.calls.at(-1)?.input as { reference?: string } | undefined;
    expect(lastCharge?.reference).toBe(`${session.session_no}-1`);
    expect(await billing.chargeSession(session.id, { requestedBy: 'x' })).toMatchObject({
      status: 'skipped',
    });
    const events = (await listAggregateEvents(sql, 'session', session.id)).map((e) => e.type);
    expect(events).toContain('session.settled');
    const paymentEvents = await sql<
      { type: string }[]
    >`SELECT type FROM ops.event_outbox WHERE type IN ('payment.captured','invoice.issued') ORDER BY id`;
    expect(paymentEvents.map((e) => e.type)).toEqual(['invoice.issued', 'payment.captured']);
    // La segunda carga ya no tiene tope reducido.
    expect(await authorizer.checkDriver(ana.id, VOLT_TENANT_ID)).toEqual({ ok: true });

    // Devolución: anulación el mismo día.
    const payment = (
      await billing.listPayments({ tenantId: VOLT_TENANT_ID, sessionId: session.id })
    )[0];
    const reversal = await billing.reversePayment(payment?.id ?? '', {
      actor: 'staff:ana',
      reason: 'prueba de devolución',
    });
    expect(reversal).toMatchObject({ kind: 'VOID', status: 'SUCCEEDED' });
    expect((await sessions.get(session.id)).payment_status).toBe('REFUNDED');
    expect((await billing.getPayment(payment?.id ?? '')).status).toBe('CANCELLED');
  });

  it('cobro rechazado: deuda, bloqueo, reintentos según calendario y pago por enlace con webhook idempotente', async () => {
    const luis = await createDriver(sql, {
      tenantId: VOLT_TENANT_ID,
      email: 'luis@example.com',
      displayName: 'Luis',
    });
    const token = psp.tokenizeCard({
      number: FAKE_CARDS.declined,
      expMonth: '12',
      expYear: '30',
      cvc: '123',
      cardHolder: 'LUIS',
    });
    await registerPaymentMethod(sql, psp, {
      tenantId: VOLT_TENANT_ID,
      driverId: luis.id,
      type: 'CARD',
      token,
      ...acceptance,
    });
    const session = await runSession(luis.id, 2, 20_000);
    const chargedAt = clock;
    const outcome = await billing.chargeSession(session.id, { requestedBy: 'system:billing' });
    expect(outcome).toMatchObject({ status: 'charged', pspStatus: 'DECLINED' });
    expect(await sessions.get(session.id)).toMatchObject({
      state: 'SETTLED',
      payment_status: 'FAILED',
    });
    const debt = (await billing.listDebts({ tenantId: VOLT_TENANT_ID, driverId: luis.id }))[0];
    expect(debt).toMatchObject({ status: 'OPEN', attempts: 1, session_id: session.id });
    expect(BigInt(debt?.amount_minor ?? 0)).toBe(27_000n);
    expect(debt?.next_attempt_at?.getTime()).toBe(chargedAt.getTime() + 2 * 3_600_000);
    expect(
      (
        await sql<
          { billing_status: string }[]
        >`SELECT billing_status FROM auth.driver WHERE id = ${luis.id}`
      )[0]?.billing_status,
    ).toBe('BLOCKED_DEBT');
    // Bloqueado: no puede iniciar otra carga.
    const denied = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-BIL-1-3',
      driverId: luis.id,
      channel: 'APP',
      requestedBy: 'driver:luis',
    });
    expect(denied).toMatchObject({ state: 'FAILED', failure_code: 'DRIVER_BLOCKED' });
    // El barrido respeta el calendario: nada antes de las 2 horas, reintento después (otra vez rechazado → 24 h).
    expect((await billing.chargePending()).charged).toBe(0); // las sesiones con deuda se reintentan por calendario
    clock = new Date(chargedAt.getTime() + 3_600_000);
    expect(await billing.retryDueDebts()).toBe(0);
    clock = new Date(chargedAt.getTime() + 2 * 3_600_000 + 1000);
    expect(await billing.retryDueDebts()).toBe(1);
    const retried = await billing.getDebt(debt?.id ?? '');
    expect(retried.attempts).toBe(2);
    expect(retried.next_attempt_at?.getTime()).toBe(clock.getTime() + 24 * 3_600_000);
    expect((await sessions.get(session.id)).payment_attempts).toBe(2);
    // Enlace de pago: el conductor paga por PSE; el webhook salda la deuda, paga la sesión y desbloquea.
    const withLink = await billing.createDebtPaymentLink(debt?.id ?? '', {
      requestedBy: 'driver:luis',
    });
    expect(withLink.payment_link_url).toContain(withLink.payment_link_id);
    expect(
      (await billing.createDebtPaymentLink(debt?.id ?? '', { requestedBy: 'driver:luis' }))
        .payment_link_id,
    ).toBe(withLink.payment_link_id);
    clock = new Date(clock.getTime() + 60_000);
    const event = psp.payLink(withLink.payment_link_id ?? '');
    const first = await billing.processWebhook(event);
    expect(first).toMatchObject({ accepted: true, outcome: 'APPLIED' });
    expect(await billing.processWebhook(event)).toMatchObject({
      accepted: true,
      outcome: 'DUPLICATE',
    });
    const tampered = JSON.parse(JSON.stringify(event)) as {
      data: { transaction: { amount_in_cents: number } };
      timestamp: number;
    };
    tampered.data.transaction.amount_in_cents = 1;
    tampered.timestamp += 1;
    expect(await billing.processWebhook(tampered)).toMatchObject({
      accepted: false,
      outcome: 'INVALID_CHECKSUM',
    });
    expect(await billing.getDebt(debt?.id ?? '')).toMatchObject({ status: 'PAID' });
    expect(await sessions.get(session.id)).toMatchObject({
      state: 'PAID',
      payment_status: 'CAPTURED',
    });
    expect(
      (
        await sql<
          { billing_status: string }[]
        >`SELECT billing_status FROM auth.driver WHERE id = ${luis.id}`
      )[0]?.billing_status,
    ).toBe('OK');
    const payments = await billing.listPayments({
      tenantId: VOLT_TENANT_ID,
      sessionId: session.id,
    });
    expect(payments.map((p) => [p.kind, p.status])).toEqual([
      ['DEBT', 'SUCCEEDED'],
      ['CAPTURE', 'FAILED'],
      ['CAPTURE', 'FAILED'],
    ]);
    expect((await billing.listWebhooks()).map((w) => w.outcome)).toEqual([
      'INVALID_CHECKSUM',
      'APPLIED',
    ]);
    expect(await authorizer.checkDriver(luis.id, VOLT_TENANT_ID)).toMatchObject({ ok: true });
  });

  it('transacciones pendientes: resueltas por webhook o por consulta al PSP; condonación de deuda', async () => {
    const carla = await createDriver(sql, {
      tenantId: VOLT_TENANT_ID,
      email: 'carla@example.com',
      displayName: 'Carla',
    });
    const token = pspAsync.tokenizeCard({
      number: FAKE_CARDS.approved,
      expMonth: '12',
      expYear: '30',
      cvc: '123',
      cardHolder: 'CARLA',
    });
    await registerPaymentMethod(sql, pspAsync, {
      tenantId: VOLT_TENANT_ID,
      driverId: carla.id,
      type: 'CARD',
      token,
      ...acceptance,
    });
    const first = await runSession(carla.id, 3, 5_000);
    const pending = await billingAsync.chargeSession(first.id, { requestedBy: 'system:billing' });
    expect(pending).toMatchObject({ status: 'charged', pspStatus: 'PENDING' });
    expect((await sessions.get(first.id)).payment_status).toBe('AUTHORIZED');
    expect(await billingAsync.chargeSession(first.id, { requestedBy: 'x' })).toMatchObject({
      status: 'waiting',
      reason: 'PENDING_PSP',
    });
    const paymentId =
      (await billingAsync.listPayments({ tenantId: VOLT_TENANT_ID, sessionId: first.id }))[0]?.id ??
      '';
    const pspReference = (await billingAsync.getPayment(paymentId)).psp_reference ?? '';
    expect(await billingAsync.processWebhook(pspAsync.finalize(pspReference))).toMatchObject({
      outcome: 'APPLIED',
    });
    expect(await sessions.get(first.id)).toMatchObject({
      state: 'PAID',
      payment_status: 'CAPTURED',
    });

    const second = await runSession(carla.id, 4, 6_000);
    expect(
      await billingAsync.chargeSession(second.id, { requestedBy: 'system:billing' }),
    ).toMatchObject({ pspStatus: 'PENDING' });
    const secondPayment = (
      await billingAsync.listPayments({ tenantId: VOLT_TENANT_ID, sessionId: second.id })
    )[0];
    pspAsync.finalize(secondPayment?.psp_reference ?? '');
    expect(await billingAsync.pollPendingPayments()).toBe(0); // aún no pasó el tiempo de espera
    clock = new Date(clock.getTime() + 3 * 60_000);
    expect(await billingAsync.pollPendingPayments()).toBe(1);
    expect(await sessions.get(second.id)).toMatchObject({
      state: 'PAID',
      payment_status: 'CAPTURED',
    });

    // Deuda condonada por el operador.
    const pepe = await createDriver(sql, {
      tenantId: VOLT_TENANT_ID,
      email: 'pepe@example.com',
      displayName: 'Pepe',
    });
    const declined = psp.tokenizeCard({
      number: FAKE_CARDS.declined,
      expMonth: '12',
      expYear: '30',
      cvc: '123',
      cardHolder: 'PEPE',
    });
    await registerPaymentMethod(sql, psp, {
      tenantId: VOLT_TENANT_ID,
      driverId: pepe.id,
      type: 'CARD',
      token: declined,
      ...acceptance,
    });
    const third = await runSession(pepe.id, 1, 4_000);
    await billing.chargeSession(third.id, { requestedBy: 'system:billing' });
    const debt = (await billing.listDebts({ tenantId: VOLT_TENANT_ID, driverId: pepe.id }))[0];
    expect(debt?.status).toBe('OPEN');
    const waived = await billing.waiveDebt(debt?.id ?? '', {
      actor: 'staff:ana',
      reason: 'cortesía',
    });
    expect(waived.status).toBe('WAIVED');
    expect(await sessions.get(third.id)).toMatchObject({ state: 'PAID', payment_status: 'WAIVED' });
    expect(
      (
        await sql<
          { billing_status: string }[]
        >`SELECT billing_status FROM auth.driver WHERE id = ${pepe.id}`
      )[0]?.billing_status,
    ).toBe('OK');
    expect((await sessions.get(third.id)).receipt_id).not.toBeNull();

    // Sesión de prueba: sin cobro.
    const test = await runSession(pepe.id, 2, 3_000, 'TEST');
    expect(test.state).toBe('SETTLED');
    expect(await billing.chargeSession(test.id, { requestedBy: 'system:billing' })).toMatchObject({
      status: 'skipped',
    });

    const report = await billing.reconcile(clock, VOLT_TENANT_ID);
    expect(report.day).toBe(clock.toISOString().slice(0, 10));
    expect(report.counts.debtsOpen).toBe(0);
    expect(report.discrepancies).toEqual([]);
    expect(await listPaymentMethods(sql, carla.id)).toHaveLength(1);
  });
});
