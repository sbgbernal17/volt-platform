/**
 * Prueba de aceptación de la iteración 3 por la API: un conductor inicia una carga desde la app
 * (CU-02), sigue el progreso por SSE, la detiene (CU-04); el operador lanza una sesión de prueba
 * que lleva el cargador a TESTED; y el histórico y la separación por conductor funcionan.
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
import type { FastifyInstance, InjectOptions } from 'fastify';
import { pino } from 'pino';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const baseUrl = process.env.DATABASE_URL;
const ADMIN_TOKEN = 'token-admin-de-pruebas-0123456789';
const INTERNAL_TOKEN = 'token-interno-de-pruebas-0123456789';

async function until(condition: () => Promise<boolean> | boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`condición no cumplida en ${timeoutMs} ms`);
}

describe.skipIf(!baseUrl)('aceptación iteración 3: sesiones por la API', () => {
  let database: TemporaryDatabase;
  let sql: Sql;
  let gateway: Gateway;
  let app: FastifyInstance;
  let ocppPort = 0;
  let sim: SimulatedChargePoint;
  let siteId = '';
  let chargePointId = '';
  let driverId = '';
  let otherDriverId = '';

  const admin = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => {
    const options: InjectOptions = {
      method,
      url,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'x-actor': 'staff:ana' },
    };
    if (body !== undefined) options.payload = body as NonNullable<InjectOptions['payload']>;
    return app.inject(options);
  };
  const driver = (
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
    who = () => driverId,
  ) => {
    const options: InjectOptions = {
      method,
      url,
      headers: { authorization: `Bearer dev:${who()}`, ...headers },
    };
    if (body !== undefined) options.payload = body as NonNullable<InjectOptions['payload']>;
    return app.inject(options);
  };
  const session = async (id: string) =>
    (await driver('GET', `/v1/sessions/${id}`)).json() as Record<string, unknown>;

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
        OCPP_GATEWAY_POD_ID: 'gw-e2e-3',
      }),
      registry: new DbRegistry(sql, logger),
      logger,
      persistence: new DbPersistence(sql, logger, { logFlushMs: 50 }),
    });
    const addresses = await gateway.start();
    ocppPort = addresses.ocppPort;
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
      }),
    });
    await app.ready();

    siteId = (
      (
        await admin('POST', '/admin/v1/sites', {
          code: 'BOG-02',
          name: 'Estación 2',
          address: 'Calle 100',
          latitude: 4.68,
          longitude: -74.05,
        })
      ).json() as { id: string }
    ).id;
    const cp = (
      await admin('POST', '/admin/v1/charge-points', {
        siteId,
        chargeBoxId: 'VOLT-BOG02-CP01',
        vendor: 'VoltSim',
        model: 'SIM-DC180',
        connectors: [
          {
            ocppConnectorId: 1,
            standard: 'IEC_62196_T2_COMBO',
            powerType: 'DC',
            maxPowerW: 180000,
          },
          {
            ocppConnectorId: 2,
            standard: 'IEC_62196_T2_COMBO',
            powerType: 'DC',
            maxPowerW: 180000,
          },
        ],
      })
    ).json() as { id: string };
    chargePointId = cp.id;
    const issued = (
      await admin('POST', `/admin/v1/charge-points/${chargePointId}/credentials`)
    ).json() as { authorizationKey: string };
    // Atajo de la prueba: el comisionamiento completo ya se verifica en commissioning.e2e.test.ts.
    await sql`UPDATE assets.charge_point SET lifecycle_status = 'OPERATIONAL', visible_in_app = true WHERE id = ${chargePointId}`;
    // Tarifa base y asignación PLATFORM/PUBLIC: sin ellas ninguna sesión de app arranca (fail-closed).
    expect((await admin('POST', '/admin/v1/tariffs/bootstrap')).statusCode).toBe(200);
    sim = new SimulatedChargePoint({
      identity: 'VOLT-BOG02-CP01',
      password: issued.authorizationKey,
      endpoint: `ws://127.0.0.1:${ocppPort}/ocpp`,
      vendor: 'VoltSim',
      model: 'SIM-DC180',
      connectors: 2,
      meterValueIntervalMs: 100,
      chargingPowerW: 150_000,
      plugDelayMs: 20,
    });
    expect((await sim.start()).status).toBe('Accepted');
    driverId = (
      (
        await admin('POST', '/admin/v1/drivers', { email: 'ana@example.com', displayName: 'Ana' })
      ).json() as { id: string }
    ).id;
    otherDriverId = (
      (
        await admin('POST', '/admin/v1/drivers', { email: 'luis@example.com', displayName: 'Luis' })
      ).json() as { id: string }
    ).id;
  }, 60_000);

  afterAll(async () => {
    await sim.close();
    await app.close();
    await gateway.stop();
    await sql.end();
    await database.drop();
  });

  it('la app ve las sedes con estado en vivo y necesita identidad para las sesiones', async () => {
    await until(async () => {
      const body = (await app.inject({ method: 'GET', url: '/v1/locations' })).json() as {
        items: { evses: { status: string }[] }[];
      };
      return body.items[0]?.evses.every((e) => e.status === 'Available') ?? false;
    });
    const locations = (await app.inject({ method: 'GET', url: '/v1/locations' })).json() as {
      items: { code: string; evses: { evseId: string; status: string; maxPowerKw: number }[] }[];
    };
    expect(locations.items.map((l) => l.code)).toEqual(['BOG-02']);
    expect(locations.items[0]?.evses.map((e) => [e.evseId, e.status, e.maxPowerKw])).toEqual([
      ['VOLT-BOG02-CP01-1', 'Available', 180],
      ['VOLT-BOG02-CP01-2', 'Available', 180],
    ]);
    const evse = (
      await app.inject({ method: 'GET', url: '/v1/evses/VOLT-BOG02-CP01-1' })
    ).json() as { status: string; chargeBoxId: string };
    expect(evse).toMatchObject({ status: 'Available', chargeBoxId: 'VOLT-BOG02-CP01' });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/sessions',
          payload: { evseId: 'VOLT-BOG02-CP01-1' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/sessions',
          payload: { evseId: 'x' },
          headers: { authorization: 'Bearer dev:00000000-0000-4000-8000-000000000000' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('CU-02 y CU-04: carga completa desde la app con progreso por SSE', async () => {
    const started = await driver(
      'POST',
      '/v1/sessions',
      { evseId: 'VOLT-BOG02-CP01-1' },
      { 'idempotency-key': 'app-1' },
    );
    expect(started.statusCode).toBe(202);
    const body = started.json() as {
      id: string;
      state: string;
      evseId: string;
      links: { events: string; stop: string };
    };
    expect(body).toMatchObject({ state: 'STARTING', evseId: 'VOLT-BOG02-CP01-1' });
    expect(body.links.stop).toBe(`/v1/sessions/${body.id}/stop`);
    // Misma Idempotency-Key: misma sesión.
    expect(
      (
        (
          await driver(
            'POST',
            '/v1/sessions',
            { evseId: 'VOLT-BOG02-CP01-1' },
            { 'idempotency-key': 'app-1' },
          )
        ).json() as { id: string }
      ).id,
    ).toBe(body.id);
    // Otro conductor no la ve.
    expect(
      (await driver('GET', `/v1/sessions/${body.id}`, undefined, {}, () => otherDriverId))
        .statusCode,
    ).toBe(404);

    const sse = driver('GET', `/v1/sessions/${body.id}/events`);
    await until(async () => (await session(body.id)).state === 'ACTIVE');
    await until(async () => Number((await session(body.id)).energyKwh ?? 0) > 0);
    const progress = await session(body.id);
    expect(progress).toMatchObject({
      state: 'ACTIVE',
      detailedState: 'CHARGING',
      powerKw: 150,
      connectorId: 1,
    });
    expect(progress.ocppTransactionId).toEqual(expect.any(Number));
    expect(progress.soc).toEqual(expect.any(Number));

    const stopping = await driver('POST', `/v1/sessions/${body.id}/stop`);
    expect(stopping.statusCode).toBe(202);
    expect((stopping.json() as { state: string }).state).toBe('STOPPING');
    await until(async () => (await session(body.id)).state === 'ENDED');
    const ended = await session(body.id);
    expect(ended).toMatchObject({ state: 'ENDED', stopReason: 'Remote', endKind: 'NORMAL' });
    expect(Number(ended.energyKwh)).toBeGreaterThan(0);
    expect(Number(ended.elapsedSeconds)).toBeGreaterThanOrEqual(0);

    const stream = await sse;
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    const events = stream.payload
      .split('\n')
      .filter((line) => line.startsWith('event: '))
      .map((line) => line.slice(7));
    expect(events).toEqual(
      expect.arrayContaining([
        'session.started',
        'session.metered',
        'session.stop_requested',
        'session.ended',
        'end',
      ]),
    );
    expect(events.at(-1)).toBe('end');
    const ids = stream.payload
      .split('\n')
      .filter((line) => line.startsWith('id: '))
      .map((line) => Number(line.slice(4)));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));

    // Reanudación con Last-Event-ID: solo llegan los eventos posteriores. Tras cerrar el primer flujo
    // pueden seguir llegando eventos de la sesión (fin de la ocupación, liquidación), así que se
    // comprueba el orden y no la cantidad exacta.
    const lastEventId = ids[ids.length - 2] as number;
    const resumed = await driver('GET', `/v1/sessions/${body.id}/events`, undefined, {
      'last-event-id': String(lastEventId),
    });
    const resumedIds = resumed.payload
      .split('\n')
      .filter((line) => line.startsWith('id: '))
      .map((line) => Number(line.slice(4)));
    expect(resumedIds.length).toBeGreaterThanOrEqual(1);
    expect(resumedIds[0]).toBe(ids[ids.length - 1]);
    expect(resumedIds.every((id) => id > lastEventId)).toBe(true);

    const history = (await driver('GET', '/v1/sessions')).json() as { items: { id: string }[] };
    expect(history.items.map((s) => s.id)).toEqual([body.id]);
    expect(
      (
        (await driver('GET', '/v1/sessions', undefined, {}, () => otherDriverId)).json() as {
          items: unknown[];
        }
      ).items,
    ).toEqual([]);
  }, 30_000);

  it('el operador lanza una sesión de prueba que lleva el cargador a TESTED y consulta transacciones', async () => {
    await sql`UPDATE assets.charge_point SET lifecycle_status = 'CONFIGURED' WHERE id = ${chargePointId}`;
    // Reconectar para que el gateway tome el nuevo ciclo de vida.
    await sim.close();
    await sim.start();
    const busy = await admin('POST', '/admin/v1/sessions', {
      evseId: 'VOLT-BOG02-CP01-2',
      channel: 'OPERATOR',
    });
    expect(busy.statusCode).toBe(409);
    expect((busy.json() as { error: { code: string } }).error.code).toBe('CHARGER_NOT_OPERATIONAL');
    const test = await admin('POST', '/admin/v1/sessions', {
      evseId: 'VOLT-BOG02-CP01-2',
      channel: 'TEST',
    });
    expect(test.statusCode).toBe(202);
    const testSession = test.json() as { id: string; is_test: boolean; state: string };
    expect(testSession.is_test).toBe(true);
    await until(
      async () =>
        ((await admin('GET', `/admin/v1/sessions/${testSession.id}`)).json() as { state: string })
          .state === 'CHARGING',
    );
    await until(
      async () =>
        Number(
          (
            (await admin('GET', `/admin/v1/sessions/${testSession.id}`)).json() as {
              energy_wh: number | null;
            }
          ).energy_wh ?? 0,
        ) > 0,
    );
    expect((await admin('POST', `/admin/v1/sessions/${testSession.id}/stop`)).statusCode).toBe(202);
    await until(
      async () =>
        ((await admin('GET', `/admin/v1/sessions/${testSession.id}`)).json() as { state: string })
          .state === 'ENDED',
    );
    await until(
      async () =>
        (
          (await admin('GET', `/admin/v1/charge-points/${chargePointId}`)).json() as {
            lifecycle_status: string;
          }
        ).lifecycle_status === 'TESTED',
    );

    const list = (
      await admin('GET', `/admin/v1/sessions?chargePointId=${chargePointId}`)
    ).json() as { items: { id: string; evse_code: string }[] };
    expect(list.items.length).toBe(2);
    const transactions = (
      await admin('GET', `/admin/v1/charge-points/${chargePointId}/transactions`)
    ).json() as { items: { state: string }[] };
    expect(transactions.items.map((t) => t.state)).toEqual(['STOPPED', 'STOPPED']);
    const detail = (await admin('GET', `/admin/v1/sessions/${testSession.id}`)).json() as {
      events: { type: string }[];
      public: { state: string };
    };
    expect(detail.events.map((e) => e.type)).toContain('session.ended');
    expect(detail.public.state).toBe('ENDED');
  }, 30_000);
});
