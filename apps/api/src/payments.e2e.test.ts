/**
 * Prueba de aceptación de la iteración 5 por la API con el simulador de cargador y el emulador de
 * pasarela: sin tarjeta no se carga; alta de tarjeta (token del widget + tokens de aceptación); carga,
 * liquidación y cobro aprobado con recibo; cobro rechazado con deuda, bloqueo y enlace de pago; el
 * webhook (con checksum, idempotente) salda la deuda y desbloquea; devolución desde el back-office.
 */
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import {
  DbPersistence,
  DbRegistry,
  Gateway,
  loadConfig as loadGatewayConfig,
} from '@volt/ocpp-gateway';
import { SimulatedChargePoint } from '@volt/ocpp-sim';
import { FAKE_CARDS, FakeGateway } from '@volt/payments';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { pino } from 'pino';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const baseUrl = process.env.DATABASE_URL;
const ADMIN_TOKEN = 'token-admin-de-pruebas-0123456789';
const INTERNAL_TOKEN = 'token-interno-de-pruebas-0123456789';

async function until(
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`condición no cumplida en ${timeoutMs} ms`);
}

type Json = Record<string, unknown>;

describe.skipIf(!baseUrl)('aceptación iteración 5: pagos con Wompi (emulador)', () => {
  let database: TemporaryDatabase;
  let sql: Sql;
  let gateway: Gateway;
  let app: FastifyInstance;
  let sim: SimulatedChargePoint;
  const psp = new FakeGateway({ eventsSecret: 'secreto-e2e' });
  let anaId = '';
  let luisId = '';
  let anaSessionId = '';

  const admin = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => {
    const options: InjectOptions = {
      method,
      url,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'x-actor': 'staff:ana' },
    };
    if (body !== undefined) options.payload = body as NonNullable<InjectOptions['payload']>;
    return app.inject(options);
  };
  const as =
    (driverId: string) => (method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown) => {
      const options: InjectOptions = {
        method,
        url,
        headers: { authorization: `Bearer dev:${driverId}` },
      };
      if (body !== undefined) options.payload = body as NonNullable<InjectOptions['payload']>;
      return app.inject(options);
    };
  const session = async (driverId: string, id: string) =>
    (await as(driverId)('GET', `/v1/sessions/${id}`)).json() as Json;

  /** Carga completa en el conector dado hasta quedar SETTLED (liquidación forzada desde el back-office). */
  const chargeAndSettle = async (driverId: string, connector: number): Promise<string> => {
    const started = await as(driverId)('POST', '/v1/sessions', {
      evseId: `VOLT-BOG05-CP01-${connector}`,
    });
    expect(started.statusCode).toBe(202);
    const id = (started.json() as { id: string }).id;
    await until(async () => (await session(driverId, id)).state === 'ACTIVE');
    await until(async () => Number((await session(driverId, id)).energyKwh ?? 0) > 0);
    expect((await as(driverId)('POST', `/v1/sessions/${id}/stop`)).statusCode).toBe(202);
    await until(async () => (await session(driverId, id)).state === 'ENDED');
    await until(async () => (await session(driverId, id)).idleEndedAt !== null);
    const settled = (
      await admin('POST', `/admin/v1/sessions/${id}/settle`, { force: true })
    ).json() as { status: string };
    expect(settled.status).toBe('settled');
    return id;
  };

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    sql = createSql(database.url, { max: 5 });
    const logger = pino({ level: 'silent' });
    gateway = new Gateway({
      config: loadGatewayConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        OCPP_GATEWAY_HOST: '127.0.0.1',
        OCPP_GATEWAY_PORT: '0',
        OCPP_GATEWAY_HEALTH_PORT: '0',
        OCPP_GATEWAY_INTERNAL_PORT: '0',
        OCPP_GATEWAY_INTERNAL_TOKEN: INTERNAL_TOKEN,
        OCPP_GATEWAY_POD_ID: 'gw-e2e-5',
      }),
      registry: new DbRegistry(sql, logger),
      logger,
      persistence: new DbPersistence(sql, logger, { logFlushMs: 50 }),
    });
    const addresses = await gateway.start();
    app = buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: database.url,
        API_ADMIN_TOKEN: ADMIN_TOKEN,
        OCPP_GATEWAY_INTERNAL_TOKEN: INTERNAL_TOKEN,
        OCPP_GATEWAY_INTERNAL_URL: addresses.internalUrl,
        API_DEV_DRIVER_AUTH: 'true',
        API_SSE_POLL_MS: '100',
        PAYMENTS_PROVIDER: 'fake',
      }),
      gateway: psp,
    });
    await app.ready();
    const siteId = (
      (
        await admin('POST', '/admin/v1/sites', {
          code: 'BOG-05',
          name: 'Estación 5',
          address: 'Calle 26',
          latitude: 4.65,
          longitude: -74.1,
        })
      ).json() as { id: string }
    ).id;
    const cp = (
      await admin('POST', '/admin/v1/charge-points', {
        siteId,
        chargeBoxId: 'VOLT-BOG05-CP01',
        vendor: 'VoltSim',
        model: 'SIM-DC180',
        connectors: [1, 2, 3].map((n) => ({
          ocppConnectorId: n,
          standard: 'IEC_62196_T2_COMBO',
          powerType: 'DC',
          maxPowerW: 180000,
        })),
      })
    ).json() as { id: string };
    const issued = (await admin('POST', `/admin/v1/charge-points/${cp.id}/credentials`)).json() as {
      authorizationKey: string;
    };
    await sql`UPDATE assets.charge_point SET lifecycle_status = 'OPERATIONAL', visible_in_app = true WHERE id = ${cp.id}`;
    expect((await admin('POST', '/admin/v1/tariffs/bootstrap')).statusCode).toBe(200);
    expect(
      (
        await admin('PUT', '/admin/v1/parameters/session.settle_delay_s', {
          scopeType: 'PLATFORM',
          value: 0,
          reason: 'prueba',
        })
      ).statusCode,
    ).toBe(200);
    sim = new SimulatedChargePoint({
      identity: 'VOLT-BOG05-CP01',
      password: issued.authorizationKey,
      endpoint: `ws://127.0.0.1:${addresses.ocppPort}/ocpp`,
      vendor: 'VoltSim',
      model: 'SIM-DC180',
      connectors: 3,
      meterValueIntervalMs: 200,
      chargingPowerW: 180_000,
      plugDelayMs: 20,
    });
    expect((await sim.start()).status).toBe('Accepted');
    anaId = (
      (
        await admin('POST', '/admin/v1/drivers', { email: 'ana@example.com', displayName: 'Ana' })
      ).json() as { id: string }
    ).id;
    luisId = (
      (
        await admin('POST', '/admin/v1/drivers', { email: 'luis@example.com', displayName: 'Luis' })
      ).json() as { id: string }
    ).id;
    await until(async () => {
      const body = (await app.inject({ method: 'GET', url: '/v1/locations' })).json() as {
        items: { evses: { status: string }[] }[];
      };
      return body.items[0]?.evses.every((e) => e.status === 'Available') ?? false;
    });
  }, 60_000);

  afterAll(async () => {
    await sim.close();
    await app.close();
    await gateway.stop();
    await sql.end();
    await database.drop();
  });

  it('sin tarjeta no se puede cargar; el alta de tarjeta usa el token del widget y los tokens de aceptación', async () => {
    const ana = as(anaId);
    const billing = (await ana('GET', '/v1/billing')).json() as {
      canCharge: boolean;
      reason: { code: string };
      paymentsConfigured: boolean;
    };
    expect(billing).toMatchObject({
      canCharge: false,
      reason: { code: 'NO_PAYMENT_METHOD' },
      paymentsConfigured: true,
    });
    const denied = await ana('POST', '/v1/sessions', { evseId: 'VOLT-BOG05-CP01-1' });
    expect(denied.statusCode).toBe(409);
    expect((denied.json() as { error: { code: string } }).error.code).toBe('NO_PAYMENT_METHOD');

    const acceptance = (await ana('GET', '/v1/payment-methods/acceptance')).json() as {
      acceptanceToken: string;
      personalDataAuthToken: string;
      provider: string;
    };
    expect(acceptance.provider).toBe('FAKE');
    const token = psp.tokenizeCard({
      number: FAKE_CARDS.approved,
      expMonth: '12',
      expYear: '30',
      cvc: '123',
      cardHolder: 'ANA',
    });
    const created = await ana('POST', '/v1/payment-methods', {
      type: 'CARD',
      token,
      acceptanceToken: acceptance.acceptanceToken,
      personalDataAuthToken: acceptance.personalDataAuthToken,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      brand: 'VISA',
      last4: '4242',
      sourceStatus: 'AVAILABLE',
      isDefault: true,
      label: 'VISA terminada en 4242',
    });
    const list = (await ana('GET', '/v1/payment-methods')).json() as { items: unknown[] };
    expect(list.items).toHaveLength(1);
    expect((await ana('GET', '/v1/billing')).json()).toMatchObject({
      canCharge: true,
      status: 'OK',
      debts: [],
    });
    // Un token inválido se rechaza con 400.
    expect(
      (
        await ana('POST', '/v1/payment-methods', {
          type: 'CARD',
          token: 'tok_invalido',
          acceptanceToken: acceptance.acceptanceToken,
          personalDataAuthToken: acceptance.personalDataAuthToken,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('carga, liquidación y cobro aprobado: la sesión queda pagada con recibo', async () => {
    anaSessionId = await chargeAndSettle(anaId, 1);
    const run = (await admin('POST', '/admin/v1/billing/jobs/run', { job: 'charge' })).json() as {
      charge: { charged: number };
    };
    expect(run.charge.charged).toBe(1);
    const paid = await session(anaId, anaSessionId);
    expect(paid).toMatchObject({
      state: 'SETTLED',
      detailedState: 'PAID',
      paymentStatus: 'CAPTURED',
      receipt: `/v1/sessions/${anaSessionId}/receipt`,
    });
    expect((paid.cost as { isFinal: boolean }).isFinal).toBe(true);
    const receipt = (await as(anaId)('GET', `/v1/sessions/${anaSessionId}/receipt`)).json() as {
      number: string;
      totals: { total: string; currency: string };
      payment: { provider: string };
      lines: { dimension: string }[];
    };
    expect(receipt.number).toBe(paid.sessionNo);
    expect(receipt.totals.currency).toBe('COP');
    expect(Number(receipt.totals.total)).toBeGreaterThan(0);
    expect(receipt.payment.provider).toBe('FAKE');
    expect(receipt.lines.map((l) => l.dimension)).toEqual(['ENERGY']);
    const html = await as(anaId)('GET', `/v1/sessions/${anaSessionId}/receipt?format=html`);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.payload).toContain(receipt.number);
    const payments = (
      await admin('GET', `/admin/v1/payments?sessionId=${anaSessionId}`)
    ).json() as { items: { kind: string; status: string; reference: string }[] };
    expect(payments.items).toEqual([
      expect.objectContaining({
        kind: 'CAPTURE',
        status: 'SUCCEEDED',
        reference: `${paid.sessionNo}-1`,
      }),
    ]);
    // Otro conductor no ve el recibo.
    expect((await as(luisId)('GET', `/v1/sessions/${anaSessionId}/receipt`)).statusCode).toBe(404);
  });

  it('cobro rechazado: deuda, bloqueo, enlace de pago y webhook idempotente que salda la deuda', async () => {
    const luis = as(luisId);
    const acceptance = (await luis('GET', '/v1/payment-methods/acceptance')).json() as {
      acceptanceToken: string;
      personalDataAuthToken: string;
    };
    const token = psp.tokenizeCard({
      number: FAKE_CARDS.declined,
      expMonth: '12',
      expYear: '30',
      cvc: '123',
      cardHolder: 'LUIS',
    });
    expect(
      (
        await luis('POST', '/v1/payment-methods', {
          token,
          acceptanceToken: acceptance.acceptanceToken,
          personalDataAuthToken: acceptance.personalDataAuthToken,
        })
      ).statusCode,
    ).toBe(201);
    const sessionId = await chargeAndSettle(luisId, 2);
    const run = (await admin('POST', '/admin/v1/billing/jobs/run', { job: 'charge' })).json() as {
      charge: { charged: number };
    };
    expect(run.charge.charged).toBe(1);
    const failed = await session(luisId, sessionId);
    expect(failed).toMatchObject({ state: 'SETTLED', paymentStatus: 'FAILED' });
    const billing = (await luis('GET', '/v1/billing')).json() as {
      status: string;
      canCharge: boolean;
      reason: { code: string };
      debts: {
        id: string;
        status: string;
        attempts: number;
        sessionNo: string;
        paymentLink: unknown;
      }[];
    };
    expect(billing).toMatchObject({
      status: 'BLOCKED_DEBT',
      canCharge: false,
      reason: { code: 'DRIVER_BLOCKED' },
    });
    expect(billing.debts).toHaveLength(1);
    expect(billing.debts[0]).toMatchObject({
      status: 'OPEN',
      attempts: 1,
      sessionNo: failed.sessionNo,
      paymentLink: null,
    });
    const denied = await luis('POST', '/v1/sessions', { evseId: 'VOLT-BOG05-CP01-3' });
    expect(denied.statusCode).toBe(409);
    expect((denied.json() as { error: { code: string } }).error.code).toBe('DRIVER_BLOCKED');

    const link = (await luis('POST', `/v1/debts/${billing.debts[0]?.id}/pay-link`)).json() as {
      url: string;
      expiresAt: string;
    };
    expect(link.url).toMatch(/^https:\/\/checkout\.fake\/l\//);
    const linkId = link.url.split('/l/')[1] as string;
    const event = psp.payLink(linkId);
    const webhook = await app.inject({ method: 'POST', url: '/v1/webhooks/wompi', payload: event });
    expect(webhook.statusCode).toBe(200);
    expect(webhook.json()).toMatchObject({ received: true, outcome: 'APPLIED' });
    expect(
      (await app.inject({ method: 'POST', url: '/v1/webhooks/wompi', payload: event })).json(),
    ).toMatchObject({ outcome: 'DUPLICATE' });
    const tampered = JSON.parse(JSON.stringify(event)) as { timestamp: number };
    tampered.timestamp += 5;
    expect(
      (await app.inject({ method: 'POST', url: '/v1/webhooks/wompi', payload: tampered }))
        .statusCode,
    ).toBe(401);
    expect(await session(luisId, sessionId)).toMatchObject({
      detailedState: 'PAID',
      paymentStatus: 'CAPTURED',
    });
    const after = (await luis('GET', '/v1/billing')).json() as {
      status: string;
      canCharge: boolean;
      debts: { status: string }[];
    };
    expect(after).toMatchObject({ status: 'OK', canCharge: true });
    expect(after.debts[0]?.status).toBe('PAID');
    const inbox = (await admin('GET', '/admin/v1/billing/webhooks')).json() as {
      items: { outcome: string }[];
    };
    expect(inbox.items.map((i) => i.outcome)).toEqual(['INVALID_CHECKSUM', 'APPLIED']);
    const debts = (await admin('GET', '/admin/v1/debts?status=PAID')).json() as {
      items: unknown[];
    };
    expect(debts.items).toHaveLength(1);
  });

  it('el back-office devuelve un cobro y concilia el día', async () => {
    const payments = (
      await admin('GET', `/admin/v1/payments?sessionId=${anaSessionId}`)
    ).json() as { items: { id: string }[] };
    const reversed = await admin('POST', `/admin/v1/payments/${payments.items[0]?.id}/reverse`, {
      reason: 'prueba de devolución',
    });
    expect(reversed.statusCode).toBe(200);
    expect(reversed.json()).toMatchObject({ kind: 'VOID', status: 'SUCCEEDED' });
    expect((await session(anaId, anaSessionId)).paymentStatus).toBe('REFUNDED');
    const report = (await admin('POST', '/admin/v1/billing/reconcile', {})).json() as {
      day: string;
      discrepancies: unknown[];
      counts: { paymentsSucceeded: number };
    };
    expect(report.discrepancies).toEqual([]);
    expect(report.counts.paymentsSucceeded).toBeGreaterThanOrEqual(2);
  });
});
