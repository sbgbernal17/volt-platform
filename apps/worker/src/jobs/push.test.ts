/**
 * Notificaciones push (iteración 7): a partir de los eventos del outbox se avisa al conductor en el
 * idioma de cada dispositivo, una sola vez por evento (bandeja idempotente) y una sola vez por sesión
 * en las clases que lo exigen; los tokens rechazados por Expo quedan inválidos; las clases se
 * habilitan por parámetro; un envío fallido se reintenta pasado un minuto. Además, el adaptador de
 * Expo Push arma la petición y lee los tickets.
 */

import {
  BillingAuthorizer,
  BillingService,
  CommandService,
  createChargePoint,
  createDriver,
  createSite,
  ensureBaseTariff,
  formatMoney,
  type GatewaySender,
  type InboundContext,
  PricingService,
  registerDriverDevice,
  registerPaymentMethod,
  SessionService,
  setParam,
  TransactionService,
  VOLT_TENANT_ID,
} from '@volt/csms';
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { CallOutcome, SendCallInput } from '@volt/gateway-client';
import { FAKE_ACCEPTANCE_TOKENS, FAKE_CARDS, FakeGateway } from '@volt/payments';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deliverPushNotifications, ExpoPushSender, MemoryPushSender } from './push.ts';

const baseUrl = process.env.DATABASE_URL;

class FakeOcpp implements GatewaySender {
  async sendCall(_input: SendCallInput): Promise<CallOutcome> {
    return { ok: true, uniqueId: 'u', rttMs: 1, podId: 'fake', result: { status: 'Accepted' } };
  }
}

const T0 = Date.parse('2026-10-06T15:00:00Z');
const at = (minutes: number): Date => new Date(T0 + minutes * 60_000);
const TOKEN_ES = 'ExponentPushToken[esesesesesesesesesesese]';
const TOKEN_EN = 'ExponentPushToken[enenenenenenenenenenene]';

describe('adaptador de Expo Push', () => {
  it('arma la petición por lotes y traduce los tickets', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          data: [
            { status: 'ok', id: 'ticket-1' },
            {
              status: 'error',
              message: 'not registered',
              details: { error: 'DeviceNotRegistered' },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const sender = new ExpoPushSender({ accessToken: 'token-de-expo', fetchImpl });
    const tickets = await sender.send([
      { to: TOKEN_ES, title: 'a', body: 'b', data: { kind: 'X' } },
      { to: TOKEN_EN, title: 'c', body: 'd', data: {} },
    ]);
    expect(tickets).toEqual([
      { ok: true, id: 'ticket-1' },
      { ok: false, message: 'not registered', error: 'DeviceNotRegistered' },
    ]);
    expect(calls).toHaveLength(1);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer token-de-expo');
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>[];
    expect(body[0]).toMatchObject({
      to: TOKEN_ES,
      title: 'a',
      body: 'b',
      data: { kind: 'X' },
      sound: 'default',
      priority: 'high',
      channelId: 'volt',
    });
    const failing = new ExpoPushSender({
      fetchImpl: (async () => new Response('nope', { status: 500 })) as typeof fetch,
    });
    await expect(failing.send([{ to: TOKEN_ES, title: 'a', body: 'b', data: {} }])).rejects.toThrow(
      /500/,
    );
  });
});

describe.skipIf(!baseUrl)('notificaciones push desde el outbox', () => {
  let database: TemporaryDatabase;
  let sql: Sql;
  let chargePointId = '';
  let clock = at(0);
  let minute = 0;
  const psp = new FakeGateway({ eventsSecret: 'secreto' });
  const sender = new MemoryPushSender();
  let sessions: SessionService;
  let transactions: TransactionService;
  let pricing: PricingService;
  let billing: BillingService;
  let anaId = '';
  const ctx = (receivedAt: Date): InboundContext => ({
    chargePoint: {
      id: chargePointId,
      identity: 'CP-PUSH-1',
      tenantId: VOLT_TENANT_ID,
      lifecycle: 'OPERATIONAL',
    },
    uniqueId: `msg-${Math.random().toString(16).slice(2)}`,
    receivedAt,
    connectedAt: at(-60),
    heartbeatIntervalS: 1_000_000,
    generation: 1,
  });
  const tick = (minutes: number) => {
    minute += minutes;
    clock = at(minute);
    return clock;
  };
  const inbox = async () =>
    sql<{ event_id: string; outcome: string }[]>`
      SELECT i.event_id, i.outcome FROM ops.consumer_inbox i JOIN ops.event_outbox e ON e.event_id = i.event_id
      WHERE i.consumer = 'push' ORDER BY e.id`;
  /** Mensajes enviados ordenados por token (los dispositivos no tienen orden definido). */
  const sent = () =>
    [...sender.sent]
      .sort((a, b) => a.to.localeCompare(b.to))
      .map((m) => [m.to, m.title, m.body] as const);
  const notifications = async () =>
    sql<{ kind: string; status: string; devices: number; error: string | null; locale: string }[]>`
      SELECT kind, status, devices, error, locale FROM auth.driver_notification ORDER BY created_at`;

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    sql = createSql(database.url, { max: 4 });
    const site = await createSite(sql, {
      tenantId: VOLT_TENANT_ID,
      code: 'PUSH',
      name: 'Sede avisos',
      address: 'a',
      latitude: 4.6,
      longitude: -74,
      timezone: 'America/Bogota',
    });
    const cp = await createChargePoint(sql, {
      tenantId: VOLT_TENANT_ID,
      siteId: site.id,
      chargeBoxId: 'CP-PUSH-1',
      connectors: [1, 2].map((n) => ({
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
    sessions = new SessionService(sql, new CommandService(sql, new FakeOcpp()), {
      clock: () => clock,
      paymentAuthorizer: new BillingAuthorizer(sql),
    });
    pricing = new PricingService(sql, { clock: () => clock });
    transactions = new TransactionService(sql, { pricing, clock: () => clock });
    billing = new BillingService(sql, psp, { clock: () => clock });
    const ana = await createDriver(sql, {
      tenantId: VOLT_TENANT_ID,
      email: 'ana@example.com',
      displayName: 'Ana',
    });
    anaId = ana.id;
    await registerPaymentMethod(sql, psp, {
      tenantId: VOLT_TENANT_ID,
      driverId: anaId,
      type: 'CARD',
      token: psp.tokenizeCard({
        number: FAKE_CARDS.approved,
        expMonth: '12',
        expYear: '30',
        cvc: '123',
        cardHolder: 'ANA',
      }),
      acceptanceToken: FAKE_ACCEPTANCE_TOKENS.acceptanceToken,
      personalDataAuthToken: FAKE_ACCEPTANCE_TOKENS.personalDataAuthToken,
    });
    for (const [token, locale, platform] of [
      [TOKEN_ES, 'es', 'android'],
      [TOKEN_EN, 'en', 'ios'],
    ] as const) {
      await registerDriverDevice(sql, {
        tenantId: VOLT_TENANT_ID,
        driverId: anaId,
        pushToken: token,
        platform,
        locale,
      });
    }
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await database.drop();
  });

  it('avisa el inicio de la carga en el idioma de cada dispositivo, una sola vez por evento', async () => {
    tick(10);
    const session = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-PUSH-1-1',
      driverId: anaId,
      channel: 'APP',
      requestedBy: `driver:${anaId}`,
    });
    expect(session.state).toBe('STARTING');
    const start = await transactions.startTransaction(ctx(tick(1)), {
      connectorId: 1,
      idTag: session.id_tag,
      meterStart: 0,
      timestamp: clock.toISOString(),
    });
    expect(start.transactionId).toBeGreaterThan(0);
    const result = await deliverPushNotifications(sql, sender);
    expect(result).toMatchObject({ processed: 1, queued: 2, sent: 1 });
    expect(sent()).toEqual([
      [
        TOKEN_EN,
        'Charging started',
        'Your vehicle started charging at charger CP-PUSH-1, connector 1. Follow the progress in the app.',
      ],
      [
        TOKEN_ES,
        'Carga iniciada',
        'Su vehículo empezó a cargar en el cargador CP-PUSH-1, conector 1. Siga el progreso en la app.',
      ],
    ]);
    expect(sender.sent[0]?.data).toMatchObject({
      kind: 'SESSION_STARTED',
      sessionId: session.id,
      notificationId: expect.any(String),
    });
    expect(await notifications()).toEqual([
      { kind: 'SESSION_STARTED', status: 'SENT', devices: 2, error: null, locale: 'es' },
    ]);
    // Segundo ciclo: nada nuevo.
    expect(await deliverPushNotifications(sql, sender)).toEqual({
      processed: 0,
      queued: 0,
      sent: 0,
    });
    expect(sender.sent).toHaveLength(2);
    sender.sent.length = 0;

    // El vehículo deja de cargar: aviso de ocupación con la gracia y el precio de la tarifa, una vez por sesión.
    await transactions.onConnectorStatus(ctx(tick(5)), 1, 'SuspendedEV', 'Charging');
    await deliverPushNotifications(sql, sender);
    expect(sent().map((m) => m[2])).toEqual([
      '0 kWh charged. You have 15 minutes of courtesy to unplug your vehicle. After that, idle time costs $ 1.500 per minute.',
      '0 kWh cargados. Tiene 15 minutos de cortesía para desconectar el vehículo. Después se cobra ocupación de $ 1.500 por minuto.',
    ]);
    sender.sent.length = 0;
    await transactions.onConnectorStatus(ctx(tick(1)), 1, 'Charging', 'SuspendedEV');
    await transactions.onConnectorStatus(ctx(tick(1)), 1, 'SuspendedEV', 'Charging');
    await deliverPushNotifications(sql, sender);
    expect(sender.sent).toHaveLength(0);
    expect((await inbox()).map((r) => r.outcome)).toEqual([
      'QUEUED',
      'QUEUED',
      'SKIPPED:DUPLICATE',
    ]);
  });

  it('al liquidar y cobrar avisa el total y el recibo; un token rechazado por Expo queda inválido', async () => {
    const [row] = await sql<{ id: string; ocpp_transaction_id: string }[]>`
      SELECT s.id, t.ocpp_transaction_id FROM sessions.charging_session s
      JOIN sessions.ocpp_transaction t ON t.id = s.ocpp_transaction_id ORDER BY s.requested_at LIMIT 1`;
    const sessionId = row?.id as string;
    sender.respond = (message) =>
      message.to === TOKEN_EN
        ? { ok: false, message: 'not registered', error: 'DeviceNotRegistered' }
        : { ok: true };
    await transactions.stopTransaction(ctx(tick(5)), {
      transactionId: Number(row?.ocpp_transaction_id),
      meterStop: 10_000,
      timestamp: clock.toISOString(),
      reason: 'EVDisconnected',
    });
    await transactions.onConnectorStatus(ctx(clock), 1, 'Available', 'Finishing');
    tick(1);
    const settled = await pricing.settle(sessionId, { actor: 'test', force: true });
    expect(settled.status).toBe('settled');
    const total = settled.status === 'settled' ? settled.calc.total_minor : 0n;
    expect(total).toBeGreaterThan(0n);
    await deliverPushNotifications(sql, sender);
    expect(sent()).toEqual([
      [
        TOKEN_EN,
        'Session ended',
        `Energy: 10 kWh, ${formatMoney(total)}. Total: ${formatMoney(total)}.`,
      ],
      [
        TOKEN_ES,
        'Sesión terminada',
        `Energía: 10 kWh, ${formatMoney(total)}. Total: ${formatMoney(total)}.`,
      ],
    ]);
    const devices = await sql<
      { push_token: string; status: string; invalid_reason: string | null }[]
    >`
      SELECT push_token, status, invalid_reason FROM auth.driver_device ORDER BY push_token`;
    expect(devices).toEqual([
      { push_token: TOKEN_EN, status: 'INVALID', invalid_reason: 'DeviceNotRegistered' },
      { push_token: TOKEN_ES, status: 'ACTIVE', invalid_reason: null },
    ]);
    const settledRow = (await notifications()).find((n) => n.kind === 'SESSION_SETTLED');
    expect(settledRow).toMatchObject({ status: 'SENT', devices: 1 });
    expect(settledRow?.error).toMatch(/DeviceNotRegistered/);
    sender.sent.length = 0;
    sender.respond = undefined;

    const outcome = await billing.chargeSession(sessionId, { requestedBy: 'test', force: true });
    expect(outcome.status).toBe('charged');
    await deliverPushNotifications(sql, sender);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe(TOKEN_ES);
    expect(sender.sent[0]?.body).toMatch(
      new RegExp(
        `^Cobro aprobado: ${formatMoney(total).replace(/[$.]/g, '\\$&')} a la tarjeta terminada en 4242\\. Recibo N\\.º \\S+ disponible en Historial\\.$`,
      ),
    );
    sender.sent.length = 0;
  });

  it('respeta las clases habilitadas por parámetro y reintenta un envío fallido pasado un minuto', async () => {
    await setParam(sql, {
      key: 'notifications.push_kinds',
      scopeType: 'PLATFORM',
      value: ['SESSION_STARTED'],
      updatedBy: 'staff:test',
      tenantId: VOLT_TENANT_ID,
    });
    tick(10);
    const expired = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-PUSH-1-2',
      driverId: anaId,
      channel: 'APP',
      requestedBy: `driver:${anaId}`,
    });
    expect(expired.state).toBe('STARTING');
    tick(30);
    expect(await transactions.expireStartTimeouts(clock)).toBe(1);
    await deliverPushNotifications(sql, sender);
    expect(sender.sent).toHaveLength(0);
    const rows = await inbox();
    expect(rows.at(-1)?.outcome).toBe('SKIPPED:DISABLED');

    // Envío fallido: la notificación queda pendiente y se reintenta cuando tiene más de un minuto.
    tick(5);
    const again = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-PUSH-1-2',
      driverId: anaId,
      channel: 'APP',
      requestedBy: `driver:${anaId}`,
    });
    await transactions.startTransaction(ctx(tick(1)), {
      connectorId: 2,
      idTag: again.id_tag,
      meterStart: 0,
      timestamp: clock.toISOString(),
    });
    sender.failNext = true;
    expect(await deliverPushNotifications(sql, sender)).toMatchObject({ processed: 1, sent: 0 });
    expect((await notifications()).at(-1)).toMatchObject({
      kind: 'SESSION_STARTED',
      status: 'PENDING',
    });
    expect(await deliverPushNotifications(sql, sender)).toMatchObject({ queued: 0 });
    await sql`UPDATE auth.driver_notification SET created_at = now() - interval '2 minutes' WHERE status = 'PENDING'`;
    expect(await deliverPushNotifications(sql, sender)).toMatchObject({ queued: 1, sent: 1 });
    expect((await notifications()).at(-1)).toMatchObject({ status: 'SENT', devices: 1 });
    expect(sender.sent.at(-1)?.title).toBe('Carga iniciada');
  });
});
