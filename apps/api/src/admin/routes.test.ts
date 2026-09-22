import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';

const baseUrl = process.env.DATABASE_URL;
const TOKEN = 'token-admin-de-pruebas-0123456789';

describe.skipIf(!baseUrl)('API de administración (sin gateway)', () => {
  let database: TemporaryDatabase;
  let app: FastifyInstance;
  let siteId = '';
  let templateId = '';
  let chargePointId = '';

  const call = (
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    body?: unknown,
    token: string | null = TOKEN,
  ) => {
    const options: InjectOptions = {
      method,
      url,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'x-actor': 'staff:ana',
      },
    };
    if (body !== undefined) options.payload = body as NonNullable<InjectOptions['payload']>;
    return app.inject(options);
  };

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    app = buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: database.url,
        API_ADMIN_TOKEN: TOKEN,
      }),
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  it('exige el token de administración', async () => {
    expect((await call('GET', '/admin/v1/sites', undefined, null)).statusCode).toBe(401);
    expect((await call('GET', '/admin/v1/sites', undefined, 'otro')).statusCode).toBe(401);
    expect((await call('GET', '/admin/v1/sites')).statusCode).toBe(200);
  });

  it('crea sedes y valida el cuerpo', async () => {
    const created = await call('POST', '/admin/v1/sites', {
      code: 'SEDE-1',
      name: 'Sede 1',
      address: 'Calle 1',
      latitude: 4.6,
      longitude: -74.08,
    });
    expect(created.statusCode).toBe(201);
    siteId = (created.json() as { id: string }).id;
    expect(created.json()).toMatchObject({
      code: 'SEDE-1',
      timezone: 'America/Bogota',
      country_code: 'CO',
    });
    const invalid = await call('POST', '/admin/v1/sites', {
      code: 'X',
      name: 'Sin coordenadas',
      address: 'a',
    });
    expect(invalid.statusCode).toBe(400);
    expect((invalid.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
    const duplicate = await call('POST', '/admin/v1/sites', {
      code: 'SEDE-1',
      name: 'Otra',
      address: 'Calle 2',
      latitude: 1,
      longitude: 1,
    });
    expect(duplicate.statusCode).toBe(409);
    expect((await call('GET', `/admin/v1/sites/${siteId}`)).statusCode).toBe(200);
    expect(
      (await call('GET', '/admin/v1/sites/00000000-0000-4000-8000-000000000000')).statusCode,
    ).toBe(404);
  });

  it('crea plantillas y cargadores con conectores', async () => {
    const template = await call('POST', '/admin/v1/config-templates', {
      name: 'DC-180',
      keys: { HeartbeatInterval: '300', MeterValueSampleInterval: '15' },
      optionalKeys: ['WebSocketPingInterval'],
    });
    expect(template.statusCode).toBe(201);
    templateId = (template.json() as { id: string }).id;
    const chargePoint = await call('POST', '/admin/v1/charge-points', {
      siteId,
      chargeBoxId: 'CP-API-1',
      vendor: 'Acme',
      model: 'DC180',
      configTemplateId: templateId,
      connectors: [
        { ocppConnectorId: 1, standard: 'IEC_62196_T2_COMBO', powerType: 'DC', maxPowerW: 180000 },
        { ocppConnectorId: 2, standard: 'IEC_62196_T2_COMBO', powerType: 'DC', maxPowerW: 180000 },
      ],
    });
    expect(chargePoint.statusCode).toBe(201);
    chargePointId = (chargePoint.json() as { id: string }).id;
    expect(chargePoint.json()).toMatchObject({
      lifecycle_status: 'INVENTORIED',
      connection_generation: 0,
    });
    const badConnector = await call('POST', '/admin/v1/charge-points', {
      siteId,
      chargeBoxId: 'CP-API-2',
      connectors: [{ ocppConnectorId: 1, standard: 'USB', powerType: 'DC' }],
    });
    expect(badConnector.statusCode).toBe(400);
    const detail = await call('GET', `/admin/v1/charge-points/${chargePointId}`);
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      connectors: { evse_code: string; live_status: string }[];
      configuration: { key: string; desired_value: string }[];
      credential: unknown;
      drift: string[];
      lifecycle_events: { to_state: string }[];
    };
    expect(body.connectors.map((c) => [c.evse_code, c.live_status])).toEqual([
      ['CP-API-1-1', 'Offline'],
      ['CP-API-1-2', 'Offline'],
    ]);
    expect(body.configuration.map((c) => c.key)).toEqual([
      'HeartbeatInterval',
      'MeterValueSampleInterval',
    ]);
    expect(body.credential).toBeNull();
    expect(body.drift).toEqual(['HeartbeatInterval', 'MeterValueSampleInterval']);
    expect(body.lifecycle_events.map((e) => e.to_state)).toEqual(['INVENTORIED']);
    const list = await call(
      'GET',
      `/admin/v1/charge-points?siteId=${siteId}&lifecycle=INVENTORIED`,
    );
    expect((list.json() as { items: unknown[] }).items).toHaveLength(1);
  });

  it('emite credenciales una sola vez y controla el ciclo de vida', async () => {
    const issued = await call('POST', `/admin/v1/charge-points/${chargePointId}/credentials`);
    expect(issued.statusCode).toBe(201);
    const body = issued.json() as {
      authorizationKey: string;
      lifecycle: string;
      chargeBoxId: string;
    };
    expect(body.authorizationKey).toMatch(/^[0-9A-F]{40}$/);
    expect(body.lifecycle).toBe('PROVISIONED');
    expect(body.chargeBoxId).toBe('CP-API-1');
    const detail = (await call('GET', `/admin/v1/charge-points/${chargePointId}`)).json() as {
      credential: { bootstrap: boolean; issued_by: string; key_hash?: string };
    };
    expect(detail.credential).toMatchObject({ bootstrap: true, issued_by: 'staff:ana' });
    expect(detail.credential.key_hash).toBeUndefined();

    const invalid = await call('POST', `/admin/v1/charge-points/${chargePointId}/lifecycle`, {
      to: 'OPERATIONAL',
    });
    expect(invalid.statusCode).toBe(409);
    expect((invalid.json() as { error: { code: string } }).error.code).toBe('LIFECYCLE_TRANSITION');
    const decommission = await call('POST', `/admin/v1/charge-points/${chargePointId}/lifecycle`, {
      to: 'DECOMMISSIONED',
      reason: 'prueba',
    });
    expect(decommission.statusCode).toBe(200);
    expect(decommission.json()).toEqual({
      from: 'PROVISIONED',
      to: 'DECOMMISSIONED',
      changed: true,
    });
    const events = (
      await call('GET', `/admin/v1/charge-points/${chargePointId}/lifecycle-events`)
    ).json() as {
      items: { to_state: string; actor: string }[];
    };
    expect(events.items[0]).toMatchObject({ to_state: 'DECOMMISSIONED', actor: 'staff:ana' });
  });

  it('sin enlace al gateway los comandos responden 503', async () => {
    const response = await call('POST', `/admin/v1/charge-points/${chargePointId}/commands`, {
      action: 'Reset',
      payload: { type: 'Soft' },
    });
    expect(response.statusCode).toBe(503);
    expect((response.json() as { error: { code: string } }).error.code).toBe('GATEWAY_UNAVAILABLE');
    const badAction = await call('POST', `/admin/v1/charge-points/${chargePointId}/commands`, {
      action: 'RemoteStartTransaction',
      payload: {},
    });
    expect(badAction.statusCode).toBe(400);
    expect((await call('GET', '/admin/v1/alarms')).json()).toEqual({ items: [] });
  });
});
