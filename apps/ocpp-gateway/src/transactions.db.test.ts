/**
 * Transacciones de punta a punta en el gateway con PostgreSQL: arranque remoto (CU-02), parada
 * remota (CU-04), corte de red con mensajes encolados y reintentos sin duplicados (CU-05) y caída
 * de pod con reconexión a otro gateway.
 */
import {
  CommandService,
  createChargePoint,
  createSite,
  ensureBaseTariff,
  getChargePoint,
  issueCredential,
  issueIdToken,
  listAggregateEvents,
  SessionService,
  VOLT_TENANT_ID,
} from '@volt/csms';
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import { GatewayClient, StaticConnectionDirectory } from '@volt/gateway-client';
import { SimulatedChargePoint } from '@volt/ocpp-sim';
import { pino } from 'pino';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { DbRegistry } from './db-registry.ts';
import { Gateway } from './gateway.ts';
import { DbPersistence } from './persistence.ts';

const baseUrl = process.env.DATABASE_URL;
const TOKEN = 'token-interno-de-pruebas-0123456789';

async function until(condition: () => Promise<boolean> | boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`condición no cumplida en ${timeoutMs} ms`);
}

describe.skipIf(!baseUrl)('transacciones en el gateway con PostgreSQL', () => {
  let database: TemporaryDatabase;
  let sql: Sql;
  const logger = pino({ level: 'silent' });
  const gateways: Gateway[] = [];
  let gateway: Gateway;
  let internalUrl = '';
  let ocppPort = 0;
  let chargePointId = '';
  let key = '';
  let sim: SimulatedChargePoint;
  let sessions: SessionService;

  const newGateway = async (podId: string) => {
    const instance = new Gateway({
      config: loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        OCPP_GATEWAY_HOST: '127.0.0.1',
        OCPP_GATEWAY_PORT: '0',
        OCPP_GATEWAY_HEALTH_PORT: '0',
        OCPP_GATEWAY_INTERNAL_PORT: '0',
        OCPP_GATEWAY_INTERNAL_TOKEN: TOKEN,
        OCPP_GATEWAY_POD_ID: podId,
      }),
      registry: new DbRegistry(sql, logger),
      logger,
      persistence: new DbPersistence(sql, logger, { logFlushMs: 50 }),
    });
    gateways.push(instance);
    const addresses = await instance.start();
    return { instance, addresses };
  };

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    sql = createSql(database.url, { max: 5 });
    const first = await newGateway('gw-a');
    gateway = first.instance;
    internalUrl = first.addresses.internalUrl;
    ocppPort = first.addresses.ocppPort;
    const site = await createSite(sql, {
      tenantId: VOLT_TENANT_ID,
      code: 'TX',
      name: 'TX',
      address: 'a',
      latitude: 1,
      longitude: 1,
      timezone: 'America/Bogota',
    });
    const cp = await createChargePoint(sql, {
      tenantId: VOLT_TENANT_ID,
      siteId: site.id,
      chargeBoxId: 'CP-TX-1',
      vendor: 'VoltSim',
      model: 'SIM-DC180',
      connectors: [
        { ocppConnectorId: 1, standard: 'IEC_62196_T2_COMBO', powerType: 'DC' },
        { ocppConnectorId: 2, standard: 'IEC_62196_T2_COMBO', powerType: 'DC' },
      ],
    });
    chargePointId = cp.id;
    key = (await issueCredential(sql, { chargePointId, issuedBy: 'staff:test' })).authorizationKey;
    await sql`UPDATE assets.charge_point SET lifecycle_status = 'OPERATIONAL', visible_in_app = true WHERE id = ${chargePointId}`;
    await ensureBaseTariff(sql, { tenantId: VOLT_TENANT_ID, actor: 'staff:test' });
    const client = new GatewayClient({
      directory: new StaticConnectionDirectory(internalUrl),
      token: TOKEN,
      retryDelayMs: 10,
    });
    sessions = new SessionService(sql, new CommandService(sql, client), {
      defaultConnectionTimeoutS: 5,
      startTimeoutMarginS: 1,
    });
    sim = new SimulatedChargePoint({
      identity: 'CP-TX-1',
      password: key,
      endpoint: `ws://127.0.0.1:${ocppPort}/ocpp`,
      connectors: 2,
      meterValueIntervalMs: 100,
      chargingPowerW: 180_000,
      plugDelayMs: 20,
    });
    expect((await sim.start()).status).toBe('Accepted');
    await until(async () => (await getChargePoint(sql, chargePointId)).connected);
  }, 60_000);

  afterAll(async () => {
    await sim.close();
    for (const instance of gateways) await instance.stop();
    await sql.end();
    await database.drop();
  });

  it('CU-02 y CU-04: sesión remota completa con progreso y parada', async () => {
    const session = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-TX-1-1',
      channel: 'OPERATOR',
      requestedBy: 'staff:test',
    });
    expect(session.state).toBe('STARTING');
    await until(async () => (await sessions.get(session.id)).state === 'CHARGING');
    const transaction = sim.transactions.get(1);
    expect(transaction?.idTag).toBe(session.id_tag);
    await until(async () => Number((await sessions.get(session.id)).energy_wh ?? 0) > 0, 5000);
    const progress = await sessions.get(session.id);
    expect(progress.last_sample).toMatchObject({ powerW: 180_000 });
    expect(progress.last_sample?.soc).toBeGreaterThanOrEqual(20);

    const stopping = await sessions.requestStop(session.id, 'staff:test');
    expect(stopping.state).toBe('STOPPING');
    await until(async () => (await sessions.get(session.id)).state === 'ENDED');
    const ended = await sessions.get(session.id);
    expect(ended.stop_reason).toBe('Remote');
    expect(Number(ended.energy_wh)).toBeGreaterThan(0);
    expect(sim.transactions.size).toBe(0);
    const events = await listAggregateEvents(sql, 'session', session.id);
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        'session.requested',
        'session.starting',
        'session.started',
        'session.metered',
        'session.stop_requested',
        'session.ended',
      ]),
    );
  }, 20_000);

  it('CU-05: corte de red con arranque local, lecturas encoladas, reintento sin duplicados y cierre', async () => {
    // Token RFID emitido por la plataforma para el arranque local durante el corte.
    const rfid = await issueIdToken(sql, {
      tenantId: VOLT_TENANT_ID,
      tokenType: 'RFID',
      token: 'RFID0001',
    });
    expect(rfid.token).toBe('RFID0001');
    await sim.goOffline();
    await until(async () => !(await getChargePoint(sql, chargePointId)).connected);
    // Corte de 10 minutos: el vehículo se conectó al inicio y se desconectó 2 minutos antes de volver la red.
    const t0 = Date.now();
    const started = await sim.startTransaction(2, 'RFID0001', new Date(t0 - 10 * 60_000));
    expect(started.transactionId).toBeLessThan(0); // id local mientras está offline
    sim.recordOfflineSample(2, new Date(t0 - 8 * 60_000), 3000);
    sim.recordOfflineSample(2, new Date(t0 - 4 * 60_000), 3000);
    await sim.stopTransaction(2, 'EVDisconnected', new Date(t0 - 2 * 60_000));
    expect(sim.offlineQueue.map((m) => m.action)).toEqual([
      'StartTransaction',
      'MeterValues',
      'MeterValues',
      'StopTransaction',
    ]);

    await sim.goOnline();
    expect(sim.offlineQueue).toHaveLength(0);
    const rows = await sql<
      {
        ocpp_transaction_id: number;
        state: string;
        offline_start: boolean;
        offline_stop: boolean;
        meter_start_wh: bigint;
        meter_stop_wh: bigint;
        session_id: string;
      }[]
    >`
      SELECT ocpp_transaction_id, state, offline_start, offline_stop, meter_start_wh, meter_stop_wh, session_id
      FROM sessions.ocpp_transaction WHERE charge_point_id = ${chargePointId} AND ocpp_connector_id = 2 ORDER BY started_received_at`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'STOPPED', offline_start: true, offline_stop: true });
    expect(Number(rows[0]?.meter_stop_wh) - Number(rows[0]?.meter_start_wh)).toBe(6000);
    const samples = await sql<
      { count: bigint }[]
    >`SELECT count(*)::bigint AS count FROM sessions.meter_value WHERE charge_point_id = ${chargePointId} AND ocpp_connector_id = 2`;
    expect(Number(samples[0]?.count)).toBe(3); // 2 encoladas + Transaction.End
    const session = await sessions.get(rows[0]?.session_id ?? '');
    expect(session).toMatchObject({
      start_channel: 'UNSOLICITED',
      state: 'ENDED',
      stop_reason: 'EVDisconnected',
    });
    expect(Number(session.energy_wh)).toBe(6000);

    // El cargador no recibió la respuesta y reenvía StartTransaction y StopTransaction: mismo id, sin duplicados.
    const retry = (await sim.resend('StartTransaction')) as { transactionId: number };
    expect(retry.transactionId).toBe(rows[0]?.ocpp_transaction_id);
    await sim.resend('StopTransaction');
    const again = await sql<
      { count: bigint }[]
    >`SELECT count(*)::bigint AS count FROM sessions.ocpp_transaction WHERE charge_point_id = ${chargePointId} AND ocpp_connector_id = 2`;
    expect(Number(again[0]?.count)).toBe(1);
    const flags = await sql<
      { anomaly_flags: string[] }[]
    >`SELECT anomaly_flags FROM sessions.ocpp_transaction WHERE ocpp_transaction_id = ${rows[0]?.ocpp_transaction_id ?? 0}`;
    expect(flags[0]?.anomaly_flags).toEqual([]);
  }, 30_000);

  it('caída de pod: la transacción sigue en otro gateway y termina con StopTransaction', async () => {
    const session = await sessions.requestStart({
      tenantId: VOLT_TENANT_ID,
      evseCode: 'CP-TX-1-1',
      channel: 'OPERATOR',
      requestedBy: 'staff:test',
    });
    await until(async () => (await sessions.get(session.id)).state === 'CHARGING');
    const generationBefore = (await getChargePoint(sql, chargePointId)).connection_generation;

    // Muere el pod A: el cargador reconecta contra el pod B con la misma transacción viva.
    const second = await newGateway('gw-b');
    sim.setEndpoint(`ws://127.0.0.1:${second.addresses.ocppPort}/ocpp`);
    await gateway.stop();
    await until(() => !sim.connected);
    await sim.connect();
    await sim.boot();
    await until(async () => {
      const cp = await getChargePoint(sql, chargePointId);
      return cp.connected && cp.connection_generation > generationBefore;
    });
    expect((await sessions.get(session.id)).interrupted_at).toBeInstanceOf(Date);
    expect(sim.transactions.get(1)?.transactionId).toBeGreaterThan(0);

    // Parada remota a través del nuevo pod.
    const clientB = new GatewayClient({
      directory: new StaticConnectionDirectory(second.addresses.internalUrl),
      token: TOKEN,
      retryDelayMs: 10,
    });
    const sessionsB = new SessionService(sql, new CommandService(sql, clientB));
    await sim.sendMeterValues(1, 500);
    expect((await sessionsB.requestStop(session.id, 'staff:test')).state).toBe('STOPPING');
    await until(async () => (await sessions.get(session.id)).state === 'ENDED');
    expect((await sessions.get(session.id)).end_kind).toBe('NORMAL');
    const connections = await sql<{ pod: string; disconnected_at: Date | null }[]>`
      SELECT pod, disconnected_at FROM ops.charge_point_connection WHERE charge_point_id = ${chargePointId} ORDER BY generation`;
    expect(connections.at(-1)).toMatchObject({ pod: 'gw-b', disconnected_at: null });
  }, 30_000);
});
