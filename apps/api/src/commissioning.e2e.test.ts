/**
 * Prueba de aceptación de la iteración 2: un simulador pasa de inventariado a operativo desde la
 * API y la deriva de configuración se detecta al cambiar una key en el cargador.
 */
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import { RedisConnectionDirectory } from '@volt/gateway-client';
import {
  DbPersistence,
  DbRegistry,
  Gateway,
  loadConfig as loadGatewayConfig,
  RedisEvictionListener,
} from '@volt/ocpp-gateway';
import { SimulatedChargePoint } from '@volt/ocpp-sim';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const baseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const ADMIN_TOKEN = 'token-admin-de-pruebas-0123456789';
const INTERNAL_TOKEN = 'token-interno-de-pruebas-0123456789';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!baseUrl)('aceptación iteración 2: de inventariado a operativo', () => {
  let database: TemporaryDatabase;
  let sql: Sql;
  let gateway: Gateway;
  let app: FastifyInstance;
  let ocppPort = 0;
  const redis = redisUrl ? new Redis(redisUrl, { lazyConnect: true }) : undefined;
  let sim: SimulatedChargePoint;
  let siteId = '';
  let templateId = '';
  let chargePointId = '';
  let authorizationKey = '';

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => {
    const options: InjectOptions = {
      method,
      url,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'x-actor': 'staff:ana' },
    };
    if (body !== undefined) options.payload = body as NonNullable<InjectOptions['payload']>;
    return app.inject(options);
  };
  const detail = async () =>
    (await call('GET', `/admin/v1/charge-points/${chargePointId}`)).json() as Record<
      string,
      unknown
    > & {
      connectors: { ocpp_connector_id: number; ocpp_status: string; live_status: string }[];
      drift: string[];
      alarms: { kind: string }[];
    };

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    sql = createSql(database.url, { max: 5 });
    if (redis) await redis.connect();
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
        OCPP_GATEWAY_POD_ID: 'gw-e2e',
      }),
      registry: new DbRegistry(sql, logger),
      logger,
      persistence: new DbPersistence(sql, logger, { logFlushMs: 50 }),
      ...(redis
        ? {
            directory: new RedisConnectionDirectory(redis),
            evictions: new RedisEvictionListener(redisUrl as string),
          }
        : {}),
    });
    const addresses = await gateway.start();
    ocppPort = addresses.ocppPort;
    app = buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: database.url,
        ...(redisUrl ? { REDIS_URL: redisUrl } : {}),
        API_ADMIN_TOKEN: ADMIN_TOKEN,
        OCPP_GATEWAY_INTERNAL_TOKEN: INTERNAL_TOKEN,
        OCPP_GATEWAY_INTERNAL_URL: addresses.internalUrl,
        COMMISSIONING_REBOOT_WAIT_MS: '5000',
      }),
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await sim?.close();
    await app.close();
    await gateway.stop();
    await sql.end();
    await database.drop();
    if (redis) redis.disconnect();
  });

  it('1. alta de sede, plantilla y cargador en inventario', async () => {
    siteId = (
      (
        await call('POST', '/admin/v1/sites', {
          code: 'BOG-01',
          name: 'Estación Bogotá 1',
          address: 'Autopista Norte # 100-10',
          city: 'Bogotá',
          latitude: 4.6868,
          longitude: -74.0553,
        })
      ).json() as { id: string }
    ).id;
    templateId = (
      (
        await call('POST', '/admin/v1/config-templates', {
          name: 'DC-180-publico',
          description: 'Plantilla base DC rápida pública',
          keys: {
            HeartbeatInterval: '300',
            MeterValueSampleInterval: '15',
            MeterValuesSampledData: 'Energy.Active.Import.Register,Power.Active.Import,SoC',
            WebSocketPingInterval: '60',
            ClockAlignedDataInterval: '900',
            AuthorizeRemoteTxRequests: 'false',
          },
          readOnlyExpected: ['NumberOfConnectors', 'SupportedFeatureProfiles'],
          optionalKeys: ['ClockAlignedDataInterval'],
        })
      ).json() as { id: string }
    ).id;
    const created = await call('POST', '/admin/v1/charge-points', {
      siteId,
      chargeBoxId: 'VOLT-BOG01-CP01',
      vendor: 'Acme',
      model: 'DC180',
      configTemplateId: templateId,
      connectors: [
        { ocppConnectorId: 1, standard: 'IEC_62196_T2_COMBO', powerType: 'DC', maxPowerW: 180000 },
        { ocppConnectorId: 2, standard: 'IEC_62196_T2_COMBO', powerType: 'DC', maxPowerW: 180000 },
      ],
    });
    expect(created.statusCode).toBe(201);
    chargePointId = (created.json() as { id: string }).id;
    expect((await detail()).lifecycle_status).toBe('INVENTORIED');
  });

  it('2. credenciales: el cargador queda PROVISIONED y solo entra con la clave emitida', async () => {
    const issued = (
      await call('POST', `/admin/v1/charge-points/${chargePointId}/credentials`)
    ).json() as {
      authorizationKey: string;
      lifecycle: string;
    };
    authorizationKey = issued.authorizationKey;
    expect(issued.lifecycle).toBe('PROVISIONED');
    const intruder = new SimulatedChargePoint({
      identity: 'VOLT-BOG01-CP01',
      password: 'clave-robada',
      endpoint: `ws://127.0.0.1:${ocppPort}/ocpp`,
    });
    await expect(intruder.connect()).rejects.toThrow();
  });

  it('3. primera conexión: BootNotification Pending y CONNECTED_PENDING', async () => {
    sim = new SimulatedChargePoint({
      identity: 'VOLT-BOG01-CP01',
      password: authorizationKey,
      endpoint: `ws://127.0.0.1:${ocppPort}/ocpp`,
      vendor: 'Acme',
      model: 'DC180',
      connectors: 2,
      rebootRequiredKeys: ['WebSocketPingInterval'],
      unsupportedKeys: ['ClockAlignedDataInterval'],
      resetDelayMs: 100,
    });
    const boot = await sim.start();
    expect(boot.status).toBe('Pending');
    await sleep(100);
    const cp = await detail();
    expect(cp.lifecycle_status).toBe('CONNECTED_PENDING');
    expect(cp.connected).toBe(true);
    expect(cp.registration_status).toBe('Pending');
    expect(cp.connectors.map((c) => c.live_status)).toEqual(['Available', 'Available']);
  }, 15_000);

  it('4. comisionamiento desde la API: plantilla aplicada, reinicio y CONFIGURED', async () => {
    const response = await call('POST', `/admin/v1/charge-points/${chargePointId}/commission`);
    expect(response.statusCode).toBe(200);
    const result = response.json() as {
      changes: { key: string; status: string }[];
      rebootRequired: boolean;
      rebooted: boolean;
      after: { blockingDrift: unknown[]; drift: { key: string; optional: boolean }[] };
      lifecycle: { from: string; to: string };
      configured: boolean;
    };
    expect(result.changes.map((c) => [c.key, c.status])).toEqual(
      expect.arrayContaining([
        ['HeartbeatInterval', 'Accepted'],
        ['MeterValueSampleInterval', 'Accepted'],
        ['WebSocketPingInterval', 'RebootRequired'],
        ['ClockAlignedDataInterval', 'NotSupported'],
      ]),
    );
    expect(result.rebootRequired).toBe(true);
    expect(result.rebooted).toBe(true);
    expect(result.after.blockingDrift).toEqual([]);
    expect(result.after.drift.map((d) => [d.key, d.optional])).toEqual([
      ['ClockAlignedDataInterval', true],
    ]);
    expect(result.lifecycle).toEqual({ from: 'CONNECTED_PENDING', to: 'CONFIGURED' });
    expect(result.configured).toBe(true);
    expect(sim.configuration.get('HeartbeatInterval')?.value).toBe('300');
    expect(sim.configuration.get('WebSocketPingInterval')?.value).toBe('60');
    // Tras TriggerMessage(BootNotification) el cargador ya recibe Accepted.
    await sleep(300);
    expect(sim.lastBoot?.status).toBe('Accepted');
    const cp = await detail();
    expect(cp.lifecycle_status).toBe('CONFIGURED');
    expect(cp.registration_status).toBe('Accepted');
    expect(cp.supported_profiles).toContain('Core');
  }, 30_000);

  it('5. comandos operativos: TriggerMessage, ChangeAvailability, UnlockConnector y Reset', async () => {
    const commands = `/admin/v1/charge-points/${chargePointId}/commands`;
    const trigger = (
      await call('POST', commands, {
        action: 'TriggerMessage',
        payload: { requestedMessage: 'StatusNotification', connectorId: 1 },
      })
    ).json() as { command: { state: string; result_status: string } };
    expect(trigger.command).toMatchObject({ state: 'ACCEPTED', result_status: 'Accepted' });

    const inoperative = (
      await call('POST', commands, {
        action: 'ChangeAvailability',
        payload: { connectorId: 1, type: 'Inoperative' },
      })
    ).json() as { command: { state: string } };
    expect(inoperative.command.state).toBe('ACCEPTED');
    await sleep(150);
    expect((await detail()).connectors.find((c) => c.ocpp_connector_id === 1)?.ocpp_status).toBe(
      'Unavailable',
    );
    await call('POST', commands, {
      action: 'ChangeAvailability',
      payload: { connectorId: 1, type: 'Operative' },
    });
    await sleep(150);
    expect((await detail()).connectors.find((c) => c.ocpp_connector_id === 1)?.ocpp_status).toBe(
      'Available',
    );

    const unlock = (
      await call('POST', commands, { action: 'UnlockConnector', payload: { connectorId: 2 } })
    ).json() as {
      command: { state: string; result_status: string };
    };
    expect(unlock.command).toMatchObject({ state: 'ACCEPTED', result_status: 'Unlocked' });

    const bootsBefore = sim.bootCount;
    const rebooted = sim.waitForReboot(5000);
    const reset = (
      await call('POST', commands, { action: 'Reset', payload: { type: 'Soft' } })
    ).json() as {
      command: { state: string; priority: number };
    };
    expect(reset.command).toMatchObject({ state: 'ACCEPTED', priority: 1 });
    await rebooted;
    expect(sim.bootCount).toBe(bootsBefore + 1);
    expect(sim.lastBoot?.status).toBe('Accepted');

    const invalid = await call('POST', commands, { action: 'Reset', payload: { type: 'Blando' } });
    expect(invalid.statusCode).toBe(400);
    const history = (await call('GET', commands)).json() as {
      items: { action: string; state: string }[];
    };
    expect(history.items.length).toBeGreaterThanOrEqual(5);
    expect(history.items.every((c) => c.state !== 'PENDING' && c.state !== 'SENT')).toBe(true);
  }, 30_000);

  it('6. el operador aprueba: TESTED y OPERATIONAL, visible en la app', async () => {
    expect(
      (
        await call('POST', `/admin/v1/charge-points/${chargePointId}/lifecycle`, {
          to: 'TESTED',
          reason: 'sesión de prueba OK',
        })
      ).statusCode,
    ).toBe(200);
    const approved = await call('POST', `/admin/v1/charge-points/${chargePointId}/lifecycle`, {
      to: 'OPERATIONAL',
      reason: 'aprobado',
    });
    expect(approved.json()).toEqual({ from: 'TESTED', to: 'OPERATIONAL', changed: true });
    const cp = await detail();
    expect(cp).toMatchObject({
      lifecycle_status: 'OPERATIONAL',
      visible_in_app: true,
      approved_by: 'staff:ana',
    });
    const operational = (
      await call('GET', '/admin/v1/charge-points?lifecycle=OPERATIONAL')
    ).json() as { items: { charge_box_id: string }[] };
    expect(operational.items.map((c) => c.charge_box_id)).toEqual(['VOLT-BOG01-CP01']);
  });

  it('7. deriva: cambiar una key en el cargador la detecta y abre alarma; re-aplicar la corrige', async () => {
    sim.configuration.set('HeartbeatInterval', { value: '45', readonly: false });
    const sync = (
      await call('POST', `/admin/v1/charge-points/${chargePointId}/configuration/sync`)
    ).json() as {
      sync: { blockingDrift: { key: string; desired: string; observed: string }[] };
      alarm: { raised: boolean };
    };
    expect(sync.sync.blockingDrift).toEqual([
      expect.objectContaining({ key: 'HeartbeatInterval', desired: '300', observed: '45' }),
    ]);
    expect(sync.alarm.raised).toBe(true);
    const alarms = (
      await call('GET', `/admin/v1/alarms?chargePointId=${chargePointId}`)
    ).json() as { items: { kind: string; id: string }[] };
    expect(alarms.items.map((a) => a.kind)).toEqual(['CONFIG_DRIFT']);
    expect((await detail()).drift).toContain('HeartbeatInterval');

    const reapply = (
      await call('POST', `/admin/v1/charge-points/${chargePointId}/commission`)
    ).json() as {
      changes: { key: string; status: string }[];
      lifecycle: { from: string; to: string };
    };
    expect(reapply.changes).toEqual([
      { key: 'HeartbeatInterval', value: '300', status: 'Accepted', commandId: expect.any(String) },
    ]);
    expect(reapply.lifecycle).toEqual({ from: 'OPERATIONAL', to: 'OPERATIONAL' });
    expect(sim.configuration.get('HeartbeatInterval')?.value).toBe('300');
    expect(
      (
        (await call('GET', `/admin/v1/alarms?chargePointId=${chargePointId}`)).json() as {
          items: unknown[];
        }
      ).items,
    ).toEqual([]);

    // Override del operador aplicado en caliente.
    const override = (
      await call(
        'PUT',
        `/admin/v1/charge-points/${chargePointId}/configuration/MeterValueSampleInterval`,
        { value: '30' },
      )
    ).json() as { status: string };
    expect(override.status).toBe('Accepted');
    expect(sim.configuration.get('MeterValueSampleInterval')?.value).toBe('30');
  }, 30_000);

  it('8. baja: la credencial se revoca y el cargador ya no puede conectarse', async () => {
    await call('POST', `/admin/v1/charge-points/${chargePointId}/lifecycle`, {
      to: 'DECOMMISSIONED',
      reason: 'retirado',
    });
    await sim.close();
    const again = new SimulatedChargePoint({
      identity: 'VOLT-BOG01-CP01',
      password: authorizationKey,
      endpoint: `ws://127.0.0.1:${ocppPort}/ocpp`,
    });
    await expect(again.connect()).rejects.toThrow();
  });
});
