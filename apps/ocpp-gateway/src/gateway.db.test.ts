import {
  createChargePoint,
  createConfigTemplate,
  createSite,
  getChargePoint,
  issueCredential,
  listAlarms,
  listConnectors,
  listLifecycleEvents,
  VOLT_TENANT_ID,
} from '@volt/csms';
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import { RedisConnectionDirectory, StaticConnectionDirectory } from '@volt/gateway-client';
import { SimulatedChargePoint } from '@volt/ocpp-sim';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { DbRegistry } from './db-registry.ts';
import { Gateway } from './gateway.ts';
import { DbPersistence } from './persistence.ts';

const baseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

/** Espera (sondeando) a que una condición asíncrona se cumpla; falla al vencer el plazo. */
async function until(condition: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`condición no cumplida en ${timeoutMs} ms`);
}

describe.skipIf(!baseUrl)('gateway con registro y persistencia en PostgreSQL', () => {
  let database: TemporaryDatabase;
  let sql: Sql;
  let gateway: Gateway;
  let persistence: DbPersistence;
  let ocppPort = 0;
  const redis = redisUrl ? new Redis(redisUrl, { lazyConnect: true }) : undefined;
  const directory = redis
    ? new RedisConnectionDirectory(redis)
    : new StaticConnectionDirectory('http://127.0.0.1:0');
  const sims: SimulatedChargePoint[] = [];
  let siteId = '';
  let templateId = '';
  let chargePointId = '';
  let authorizationKey = '';

  const endpoint = () => `ws://127.0.0.1:${ocppPort}/ocpp`;
  const simulator = (identity: string, password: string, extra: Record<string, unknown> = {}) => {
    const sim = new SimulatedChargePoint({
      identity,
      password,
      endpoint: endpoint(),
      vendor: 'Acme',
      model: 'DC180',
      ...extra,
    });
    sims.push(sim);
    return sim;
  };

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    sql = createSql(database.url, { max: 5 });
    if (redis) await redis.connect();
    const logger = pino({ level: 'silent' });
    persistence = new DbPersistence(sql, logger, { logFlushMs: 50 });
    gateway = new Gateway({
      config: loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        OCPP_GATEWAY_HOST: '127.0.0.1',
        OCPP_GATEWAY_PORT: '0',
        OCPP_GATEWAY_HEALTH_PORT: '0',
        OCPP_GATEWAY_INTERNAL_PORT: '0',
        OCPP_GATEWAY_POD_ID: 'gw-db-test',
        OCPP_SEEN_WRITE_INTERVAL_S: '1',
      }),
      registry: new DbRegistry(sql, logger, { maxFailures: 3 }),
      logger,
      persistence,
      directory,
    });
    ocppPort = (await gateway.start()).ocppPort;

    const site = await createSite(sql, {
      tenantId: VOLT_TENANT_ID,
      code: 'LAB',
      name: 'Laboratorio',
      address: 'Cra 1 # 1-1',
      latitude: 4.7,
      longitude: -74.1,
      timezone: 'America/Bogota',
    });
    siteId = site.id;
    templateId = (
      await createConfigTemplate(sql, {
        tenantId: VOLT_TENANT_ID,
        name: 'lab',
        keys: { HeartbeatInterval: '300' },
      })
    ).id;
    const chargePoint = await createChargePoint(sql, {
      tenantId: VOLT_TENANT_ID,
      siteId,
      chargeBoxId: 'CP-DB-1',
      vendor: 'Acme',
      model: 'DC180',
      configTemplateId: templateId,
      connectors: [
        { ocppConnectorId: 1, standard: 'IEC_62196_T2_COMBO', powerType: 'DC' },
        { ocppConnectorId: 2, standard: 'IEC_62196_T2_COMBO', powerType: 'DC' },
      ],
    });
    chargePointId = chargePoint.id;
  }, 60_000);

  afterAll(async () => {
    for (const sim of sims) await sim.close();
    await gateway.stop();
    await sql.end();
    await database.drop();
    if (redis) redis.disconnect();
  });

  it('rechaza cargadores sin credencial (INVENTORIED) y credenciales erróneas, y bloquea tras varios fallos', async () => {
    await expect(simulator('CP-DB-1', 'cualquiera').connect()).rejects.toThrow();
    const issued = await issueCredential(sql, { chargePointId, issuedBy: 'staff:ana' });
    authorizationKey = issued.authorizationKey;
    expect(issued.lifecycle).toBe('PROVISIONED');

    for (let i = 0; i < 3; i++) {
      await expect(simulator('CP-DB-1', 'clave-mala').connect()).rejects.toThrow();
    }
    const locked = await sql<{ locked_until: Date | null; failed_attempts: number }[]>`
      SELECT locked_until, failed_attempts FROM assets.charge_point_credential WHERE charge_point_id = ${chargePointId}`;
    expect(locked[0]?.locked_until).toBeInstanceOf(Date);
    // Con la credencial bloqueada ni la clave correcta entra.
    await expect(simulator('CP-DB-1', authorizationKey).connect()).rejects.toThrow();
    await sql`UPDATE assets.charge_point_credential SET locked_until = NULL WHERE charge_point_id = ${chargePointId}`;

    // Clave de bootstrap caducada.
    await sql`UPDATE assets.charge_point_credential SET expires_at = now() - interval '1 hour' WHERE charge_point_id = ${chargePointId}`;
    await expect(simulator('CP-DB-1', authorizationKey).connect()).rejects.toThrow();
    await sql`UPDATE assets.charge_point_credential SET expires_at = now() + interval '1 day' WHERE charge_point_id = ${chargePointId}`;
  }, 30_000);

  it('acepta la clave correcta, persiste la conexión y publica el cargador en el directorio', async () => {
    const sim = simulator('CP-DB-1', authorizationKey);
    await sim.connect();
    await until(async () => (await getChargePoint(sql, chargePointId)).connected);
    const chargePoint = await getChargePoint(sql, chargePointId);
    expect(chargePoint.connected).toBe(true);
    expect(Number(chargePoint.connection_generation)).toBe(1);
    const credential = await sql<
      { bootstrap: boolean; first_used_at: Date | null; expires_at: Date }[]
    >`
      SELECT bootstrap, first_used_at, expires_at FROM assets.charge_point_credential WHERE charge_point_id = ${chargePointId}`;
    expect(credential[0]?.bootstrap).toBe(false);
    expect(credential[0]?.first_used_at).toBeInstanceOf(Date);
    expect(credential[0]?.expires_at.getTime()).toBeGreaterThan(Date.now() + 80 * 24 * 3600 * 1000);
    const connections = await sql<
      { pod: string; generation: bigint; disconnected_at: Date | null }[]
    >`
      SELECT pod, generation, disconnected_at FROM ops.charge_point_connection WHERE charge_point_id = ${chargePointId}`;
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ pod: 'gw-db-test', disconnected_at: null });
    const record = await directory.lookup('CP-DB-1');
    expect(record?.podId).toBe('gw-db-test');

    // Primer BootNotification: Pending y paso a CONNECTED_PENDING con evidencia.
    const boot = await sim.boot();
    expect(boot.status).toBe('Pending');
    const booted = await getChargePoint(sql, chargePointId);
    expect(booted.lifecycle_status).toBe('CONNECTED_PENDING');
    expect(booted).toMatchObject({
      boot_vendor: 'Acme',
      boot_model: 'DC180',
      registration_status: 'Pending',
      firmware_version: '1.0.0-sim',
    });
    expect(booted.last_boot_at).toBeInstanceOf(Date);
    const events = await listLifecycleEvents(sql, chargePointId);
    expect(events[0]).toMatchObject({
      to_state: 'CONNECTED_PENDING',
      actor: 'system:ocpp-gateway',
    });
    expect((events[0]?.evidence as { action?: string } | undefined)?.action).toBe(
      'BootNotification',
    );

    // Estados de conector: se persisten los inventariados; el 0 va al cargador.
    await sim.sendStatus(0, 'Available');
    await sim.sendStatus(1, 'Preparing');
    await sim.sendStatus(9, 'Available');
    const connectors = await listConnectors(sql, chargePointId);
    expect(connectors.find((c) => c.ocpp_connector_id === 1)).toMatchObject({
      ocpp_status: 'Preparing',
      error_code: 'NoError',
    });
    expect(connectors.find((c) => c.ocpp_connector_id === 2)?.ocpp_status).toBe('Unavailable');
    expect((await getChargePoint(sql, chargePointId)).cp_status).toBe('Available');

    // Una segunda conexión con la misma identidad reemplaza a la primera (generación 2).
    const closed = new Promise<{ code?: number }>((resolve) => sim.once('close', resolve));
    const again = simulator('CP-DB-1', authorizationKey);
    await again.connect();
    expect((await closed).code).toBe(1000);
    const readReplaced = () => sql<{ generation: bigint; close_reason: string | null }[]>`
      SELECT generation, close_reason FROM ops.charge_point_connection WHERE charge_point_id = ${chargePointId} ORDER BY generation`;
    await until(async () => {
      const rows = await readReplaced();
      return rows.length === 2 && rows[0]?.close_reason !== null;
    });
    const replaced = await readReplaced();
    expect(replaced.map((r) => [Number(r.generation), r.close_reason])).toEqual([
      [1, 'Replaced by a newer connection'],
      [2, null],
    ]);
    expect((await getChargePoint(sql, chargePointId)).connected).toBe(true);

    // Cierre: el cargador queda desconectado y desaparece del directorio.
    await again.close();
    await until(async () => !(await getChargePoint(sql, chargePointId)).connected);
    const after = await getChargePoint(sql, chargePointId);
    expect(after.connected).toBe(false);
    expect(after.last_disconnect_at).toBeInstanceOf(Date);
    expect(await directory.lookup('CP-DB-1')).toSatisfy(
      (r: unknown) => r === undefined || (r as { podId: string }).podId === 'static',
    );

    // Log OCPP con acciones correlacionadas.
    await persistence.flush();
    const log = await sql<{ direction: string; message_type: number; action: string | null }[]>`
      SELECT direction, message_type, action FROM ops.ocpp_message_log WHERE charge_box_id = 'CP-DB-1' ORDER BY ts`;
    expect(
      log.some(
        (l) => l.direction === 'CP2CS' && l.message_type === 2 && l.action === 'BootNotification',
      ),
    ).toBe(true);
    expect(
      log.some(
        (l) => l.direction === 'CS2CP' && l.message_type === 3 && l.action === 'BootNotification',
      ),
    ).toBe(true);
  }, 30_000);

  it('rechaza el arranque cuando vendor o model no coinciden con el inventario', async () => {
    const other = await createChargePoint(sql, {
      tenantId: VOLT_TENANT_ID,
      siteId,
      chargeBoxId: 'CP-DB-2',
      vendor: 'Acme',
      model: 'DC40',
      connectors: [{ ocppConnectorId: 1, standard: 'IEC_62196_T2', powerType: 'AC_3_PHASE' }],
    });
    const issued = await issueCredential(sql, { chargePointId: other.id, issuedBy: 'staff:ana' });
    const sim = simulator('CP-DB-2', issued.authorizationKey, { model: 'OtroModelo' });
    await sim.connect();
    const boot = await sim.boot();
    expect(boot).toMatchObject({ status: 'Rejected', interval: 3600 });
    const rejected = await getChargePoint(sql, other.id);
    expect(rejected.lifecycle_status).toBe('REJECTED');
    const alarms = await listAlarms(sql, { tenantId: VOLT_TENANT_ID, chargePointId: other.id });
    expect(alarms.map((a) => [a.kind, a.severity])).toEqual([['INVENTORY_MISMATCH', 'CRITICAL']]);
    // Un cargador dado de baja no puede conectarse aunque tenga clave.
    await sql`UPDATE assets.charge_point SET lifecycle_status = 'DECOMMISSIONED' WHERE id = ${other.id}`;
    await sim.close();
    await expect(simulator('CP-DB-2', issued.authorizationKey).connect()).rejects.toThrow();
  }, 30_000);
});
