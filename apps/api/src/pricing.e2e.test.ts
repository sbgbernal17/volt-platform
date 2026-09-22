/**
 * Prueba de aceptación de la iteración 4 por la API y el simulador: la app ve la tarifa antes de
 * iniciar, el costo avanza durante la carga, la carga termina (SuspendedEV), corre la gracia y la
 * ocupación se cobra por unidad de tiempo; el tope de exposición detiene la sesión con un solo
 * RemoteStopTransaction; la liquidación deja líneas de costo y el recálculo es idempotente.
 */
import { CommandService, SessionService, stopSessionsOverLimits } from '@volt/csms';
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import { GatewayClient, StaticConnectionDirectory } from '@volt/gateway-client';
import {
  DbPersistence,
  DbRegistry,
  Gateway,
  loadConfig as loadGatewayConfig,
} from '@volt/ocpp-gateway';
import { SimulatedChargePoint } from '@volt/ocpp-sim';
import { VOLT_BASE_TARIFF } from '@volt/tariff-engine';
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Json = Record<string, unknown>;

describe.skipIf(!baseUrl)(
  'aceptación iteración 4: tarifas, ocupación con gracia y tope de exposición',
  () => {
    let database: TemporaryDatabase;
    let sql: Sql;
    let gateway: Gateway;
    let app: FastifyInstance;
    let sim: SimulatedChargePoint;
    let sessions: SessionService;
    let chargePointId = '';
    let driverId = '';
    let connector2Id = '';
    let tariffId = '';

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
    ) => {
      const options: InjectOptions = {
        method,
        url,
        headers: { authorization: `Bearer dev:${driverId}`, ...headers },
      };
      if (body !== undefined) options.payload = body as NonNullable<InjectOptions['payload']>;
      return app.inject(options);
    };
    const session = async (id: string) =>
      (await driver('GET', `/v1/sessions/${id}`)).json() as Json;
    const adminSession = async (id: string) =>
      (await admin('GET', `/admin/v1/sessions/${id}`)).json() as Json;

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
          OCPP_GATEWAY_POD_ID: 'gw-e2e-4',
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
        }),
      });
      await app.ready();
      const client = new GatewayClient({
        directory: new StaticConnectionDirectory(addresses.internalUrl),
        token: INTERNAL_TOKEN,
        retryDelayMs: 10,
      });
      sessions = new SessionService(sql, new CommandService(sql, client));

      const siteId = (
        (
          await admin('POST', '/admin/v1/sites', {
            code: 'BOG-04',
            name: 'Estación 4',
            address: 'Carrera 7',
            latitude: 4.65,
            longitude: -74.06,
          })
        ).json() as { id: string }
      ).id;
      const cp = (
        await admin('POST', '/admin/v1/charge-points', {
          siteId,
          chargeBoxId: 'VOLT-BOG04-CP01',
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
      ).json() as { id: string; connectors: { id: string; ocpp_connector_id: number }[] };
      chargePointId = cp.id;
      connector2Id = (
        await sql<
          { id: string }[]
        >`SELECT id FROM assets.connector WHERE charge_point_id = ${chargePointId} AND ocpp_connector_id = 2`
      )[0]?.id as string;
      const issued = (
        await admin('POST', `/admin/v1/charge-points/${chargePointId}/credentials`)
      ).json() as {
        authorizationKey: string;
      };
      await sql`UPDATE assets.charge_point SET lifecycle_status = 'OPERATIONAL', visible_in_app = true WHERE id = ${chargePointId}`;

      // Tarifa base (bootstrap) y una versión 2 apta para la prueba: gracia de 2 s y ocupación por segundo.
      const bootstrap = (await admin('POST', '/admin/v1/tariffs/bootstrap')).json() as {
        tariff: { id: string };
      };
      tariffId = bootstrap.tariff.id;
      const definition = {
        ...VOLT_BASE_TARIFF,
        elements: VOLT_BASE_TARIFF.elements.map((element) =>
          element.price_components.some((c) => c.type === 'PARKING_TIME')
            ? {
                price_components: [
                  { type: 'PARKING_TIME', price: '90000', vat: '19', step_size: 1 },
                ],
                x_volt: { grace_period_s: 2, idle_start: 'EARLIEST', max_idle_s: 14400 },
              }
            : element,
        ),
      };
      const version = (
        await admin('POST', `/admin/v1/tariffs/${tariffId}/versions`, {
          definition,
          notes: 'gracia corta para la prueba',
        })
      ).json() as {
        version: number;
        warnings: string[];
      };
      expect(version.version).toBe(2);
      const published = await admin(
        'POST',
        `/admin/v1/tariffs/${tariffId}/versions/${version.version}/publish`,
        {},
      );
      expect(published.statusCode).toBe(200);
      expect((published.json() as { status: string }).status).toBe('ACTIVE');
      // Liquidación inmediata y tope de exposición de 200 COP en el conector 2.
      expect(
        (
          await admin('PUT', '/admin/v1/parameters/session.settle_delay_s', {
            scopeType: 'PLATFORM',
            value: 0,
            reason: 'prueba',
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await admin('PUT', '/admin/v1/parameters/pricing.exposure_limit_minor', {
            scopeType: 'CONNECTOR',
            scopeId: connector2Id,
            value: 200,
            reason: 'prueba de tope',
          })
        ).statusCode,
      ).toBe(200);

      sim = new SimulatedChargePoint({
        identity: 'VOLT-BOG04-CP01',
        password: issued.authorizationKey,
        endpoint: `ws://127.0.0.1:${addresses.ocppPort}/ocpp`,
        vendor: 'VoltSim',
        model: 'SIM-DC180',
        connectors: 2,
        meterValueIntervalMs: 200,
        chargingPowerW: 180_000,
        plugDelayMs: 20,
        stayPluggedAfterStop: true,
      });
      expect((await sim.start()).status).toBe('Accepted');
      driverId = (
        (
          await admin('POST', '/admin/v1/drivers', { email: 'ana@example.com', displayName: 'Ana' })
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

    it('la app ve la tarifa del EVSE antes de iniciar (precio por kWh ahora, ocupación y gracia)', async () => {
      const evse = (
        await app.inject({ method: 'GET', url: '/v1/evses/VOLT-BOG04-CP01-1' })
      ).json() as {
        tariff: {
          quoteId: string;
          currency: string;
          taxIncluded: boolean;
          tariffCode: string;
          tariffVersion: number;
          energy: { pricePerKwhNow: string; elements: unknown[] };
          idleFee: { pricePerMinute: string };
        };
        tariffError: string | null;
      };
      expect(evse.tariffError).toBeNull();
      expect(evse.tariff).toMatchObject({
        currency: 'COP',
        taxIncluded: true,
        tariffCode: 'VOLT-BASE',
        tariffVersion: 2,
      });
      expect(['1600', '2200', '1900']).toContain(evse.tariff.energy.pricePerKwhNow);
      expect(evse.tariff.energy.elements).toHaveLength(3);
      expect(evse.tariff.idleFee.pricePerMinute).toBe('1500');
      expect(evse.tariff.quoteId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('carga termina, corre la gracia y la ocupación se cobra; la liquidación deja líneas y el recálculo es idempotente', async () => {
      const preview = (
        await app.inject({ method: 'GET', url: '/v1/evses/VOLT-BOG04-CP01-1' })
      ).json() as { tariff: { quoteId: string } };
      const started = await driver('POST', '/v1/sessions', {
        evseId: 'VOLT-BOG04-CP01-1',
        quoteId: preview.tariff.quoteId,
      });
      expect(started.statusCode).toBe(202);
      const body = started.json() as { id: string; exposureLimit: string; links: { cost: string } };
      expect(body.exposureLimit).toBe('200000');
      expect(body.links.cost).toBe(`/v1/sessions/${body.id}/cost`);
      await until(async () => (await session(body.id)).state === 'ACTIVE');
      await until(async () => {
        const cost = (await session(body.id)).cost as { total: string } | null;
        return cost !== null && Number(cost.total) > 0;
      });
      const running = (await session(body.id)).cost as {
        currency: string;
        isFinal: boolean;
        taxIncluded: boolean;
        total: string;
        alerts: string[];
      };
      expect(running).toMatchObject({
        currency: 'COP',
        isFinal: false,
        taxIncluded: true,
        alerts: [],
      });

      // El vehículo se llena: SuspendedEV. Desde aquí cuenta la ocupación (gracia de 2 s en esta versión).
      const suspendedAt = Date.now();
      await sim.suspendEv(1);
      await until(async () => (await session(body.id)).detailedState === 'SUSPENDED_EV');
      await sleep(3500);
      const stopping = await driver('POST', `/v1/sessions/${body.id}/stop`);
      expect(stopping.statusCode).toBe(202);
      await until(async () => (await session(body.id)).state === 'ENDED');
      // Sigue conectado: la liquidación espera el fin de la ocupación.
      const waiting = (
        await admin('POST', `/admin/v1/sessions/${body.id}/settle`, { force: false })
      ).json() as { status: string; reason: string };
      expect(waiting).toMatchObject({ status: 'waiting', reason: 'IDLE_OPEN' });
      await sleep(1000);
      await sim.unplug(1);
      const unpluggedAt = Date.now();
      await until(async () => (await session(body.id)).idleEndedAt !== null);
      const settled = (
        await admin('POST', `/admin/v1/sessions/${body.id}/settle`, { force: false })
      ).json() as {
        status: string;
        calc: {
          total_minor: number;
          summary: { billable_idle_s: number; idle_time_s: number; energy_wh: number };
        };
        lines: { dimension: string; amount_minor: number; tax_minor: number; quantity: string }[];
      };
      expect(settled.status).toBe('settled');
      const parking = settled.lines.find((l) => l.dimension === 'PARKING_TIME');
      const energy = settled.lines.find((l) => l.dimension === 'ENERGY');
      expect(energy).toBeDefined();
      expect(parking).toBeDefined();
      const observedIdleS = (unpluggedAt - suspendedAt) / 1000;
      expect(settled.calc.summary.idle_time_s).toBeGreaterThanOrEqual(
        Math.floor(observedIdleS) - 1,
      );
      expect(settled.calc.summary.idle_time_s).toBeLessThanOrEqual(Math.ceil(observedIdleS) + 1);
      expect(settled.calc.summary.billable_idle_s).toBe(
        Math.max(0, settled.calc.summary.idle_time_s - 2),
      );
      // 90.000 COP/h = 25 COP por segundo, con IVA incluido.
      expect((parking?.amount_minor ?? 0) + (parking?.tax_minor ?? 0)).toBe(
        settled.calc.summary.billable_idle_s * 25,
      );
      expect(settled.calc.summary.energy_wh).toBeGreaterThan(0);

      const final = await session(body.id);
      expect(final.state).toBe('SETTLED');
      expect(final.cost).toMatchObject({
        isFinal: true,
        currency: 'COP',
        tariffCode: 'VOLT-BASE',
        tariffVersion: 2,
      });
      const cost = (await driver('GET', `/v1/sessions/${body.id}/cost`)).json() as {
        final: { lines: { dimension: string }[]; total: string };
        tariff: { snapshot_hash: string };
      };
      expect(cost.final.lines.map((l) => l.dimension)).toEqual(['ENERGY', 'PARKING_TIME']);
      expect(cost.final.total).toBe(String(settled.calc.total_minor));
      expect(cost.tariff.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
      const recalc = (
        await admin('POST', `/admin/v1/sessions/${body.id}/cost/recalculate`, { reason: 'prueba' })
      ).json() as { created: boolean };
      expect(recalc.created).toBe(false);
      const detail = await adminSession(body.id);
      expect((detail.events as { type: string }[]).map((e) => e.type)).toEqual(
        expect.arrayContaining([
          'session.suspended',
          'session.idle_ended',
          'session.priced',
          'session.settled',
        ]),
      );
    }, 40_000);

    it('el tope de exposición detiene la sesión con un solo RemoteStopTransaction y la liquidación queda cerca del tope', async () => {
      const started = await driver('POST', '/v1/sessions', { evseId: 'VOLT-BOG04-CP01-2' });
      expect(started.statusCode).toBe(202);
      const body = started.json() as { id: string; exposureLimit: string };
      expect(body.exposureLimit).toBe('200');
      await until(async () => (await session(body.id)).state === 'ACTIVE');
      await until(async () => {
        const cost = (await session(body.id)).cost as { alerts: string[] } | null;
        return cost?.alerts.includes('PREAUTH_EXHAUSTED') ?? false;
      }, 15_000);
      const sweep = await stopSessionsOverLimits(sql, sessions);
      expect(sweep).toMatchObject({ exposure: 1, failed: 0 });
      await until(async () => (await session(body.id)).state === 'ENDED');
      expect(await stopSessionsOverLimits(sql, sessions)).toMatchObject({
        exposure: 0,
        duration: 0,
      });
      const ended = await adminSession(body.id);
      expect(ended).toMatchObject({
        stop_requested_by: 'system:exposure-limit',
        stop_reason: 'Remote',
      });
      const events = (ended.events as { type: string }[]).map((e) => e.type);
      // Con 180 kW y muestras cada 200 ms la proyección agota el tope en la primera lectura: el aviso
      // previo puede no existir, pero nunca se repite; el agotamiento se emite exactamente una vez.
      expect(events.filter((e) => e === 'session.exposure_warning').length).toBeLessThanOrEqual(1);
      expect(events.filter((e) => e === 'session.exposure_exhausted')).toHaveLength(1);
      expect(events.filter((e) => e === 'session.stop_requested')).toHaveLength(1);
      await sim.unplug(2);
      await until(async () => (await session(body.id)).idleEndedAt !== null);
      const settled = (
        await admin('POST', `/admin/v1/sessions/${body.id}/settle`, { force: false })
      ).json() as {
        status: string;
        calc: { total_minor: number; alerts: string[] };
      };
      expect(settled.status).toBe('settled');
      expect(settled.calc.total_minor).toBeGreaterThan(0);
      expect(settled.calc.total_minor).toBeLessThan(600);
      // En FINAL las alertas comparan solo el total (sin proyección): el rastro del agotamiento queda en la sesión.
      expect((await adminSession(body.id)).exposure_exhausted_at).not.toBeNull();
    }, 40_000);

    it('el back-office lista tarifas, explica la resolución, simula escenarios y audita', async () => {
      const tariffs = (await admin('GET', '/admin/v1/tariffs')).json() as {
        items: { code: string; active_version: number; versions: number }[];
      };
      expect(tariffs.items).toEqual([
        expect.objectContaining({ code: 'VOLT-BASE', active_version: 2, versions: 2 }),
      ]);
      const resolution = (
        await admin(
          'GET',
          '/admin/v1/tariff-assignments/resolve?evseCode=VOLT-BOG04-CP01-1&segment=MEMBER:GOLD',
        )
      ).json() as {
        kind: string;
        segmentUsed: string;
        assignment: { scope_type: string };
        candidates: { chosen: boolean; reason: string }[];
      };
      expect(resolution).toMatchObject({
        kind: 'TARIFF',
        segmentUsed: 'PUBLIC',
        assignment: { scope_type: 'PLATFORM' },
      });
      expect(resolution.candidates[0]).toMatchObject({ chosen: true, reason: 'respaldo PUBLIC' });
      // Martes 10:00 en Bogotá, 60 min, 10 kWh a 1.900; 20 min conectado tras la parada: 5 min cobrables a 1.500 = 7.500.
      const simulated = (
        await admin('POST', '/admin/v1/pricing/simulate', {
          tariff: VOLT_BASE_TARIFF,
          taxIncluded: true,
          scenario: {
            startAt: '2026-10-06T10:00:00-05:00',
            durationMin: 60,
            energyWh: 10000,
            idleMin: 20,
          },
        })
      ).json() as { total: string; lines: { dimension: string; total: string }[] };
      expect(simulated.total).toBe('26500');
      expect(simulated.lines.map((l) => [l.dimension, l.total])).toEqual([
        ['ENERGY', '19000'],
        ['PARKING_TIME', '7500'],
      ]);
      const invalid = await admin('POST', `/admin/v1/tariffs/${tariffId}/versions/validate`, {
        definition: { ...VOLT_BASE_TARIFF, elements: VOLT_BASE_TARIFF.elements.slice(0, 2) },
      });
      expect(invalid.statusCode).toBe(400);
      const parameters = (await admin('GET', '/admin/v1/parameters')).json() as {
        items: { key: string; values: unknown[] }[];
      };
      expect(
        parameters.items.find((p) => p.key === 'pricing.exposure_limit_minor')?.values,
      ).toHaveLength(1);
      const effective = (
        await admin(
          'GET',
          `/admin/v1/parameters/pricing.exposure_limit_minor/effective?connectorId=${connector2Id}`,
        )
      ).json() as { value: number };
      expect(effective.value).toBe(200);
      const audit = (await admin('GET', '/admin/v1/pricing/audit')).json() as {
        items: { entity: string; action: string }[];
      };
      expect(audit.items.map((a) => a.action)).toEqual(
        expect.arrayContaining(['CREATE', 'PUBLISH', 'SET']),
      );
      const noTariffEvse = await admin('POST', '/admin/v1/sessions', {
        evseId: 'VOLT-BOG04-CP01-1',
        channel: 'OPERATOR',
        segment: 'INTERNAL',
      });
      expect(noTariffEvse.statusCode).toBe(202);
      const internal = noTariffEvse.json() as { id: string; tariff_segment: string };
      expect(internal.tariff_segment).toBe('INTERNAL');
      await admin('POST', `/admin/v1/sessions/${internal.id}/cancel`);
    });
  },
);
