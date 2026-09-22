import { GatewayClient, StaticConnectionDirectory } from '@volt/gateway-client';
import { SimulatedChargePoint } from '@volt/ocpp-sim';
import { createRPCError, RPCClient, RPCSecurityError } from 'ocpp-rpc';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { Gateway } from './gateway.ts';
import { MemoryPersistence } from './persistence.ts';
import { StaticRegistry } from './registry.ts';

const TOKEN = 'token-interno-de-pruebas-0123456789';

type ClientOptions = ConstructorParameters<typeof RPCClient>[0];

describe('API interna de comandos del gateway', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    OCPP_GATEWAY_HOST: '127.0.0.1',
    OCPP_GATEWAY_PORT: '0',
    OCPP_GATEWAY_HEALTH_PORT: '0',
    OCPP_GATEWAY_INTERNAL_PORT: '0',
    OCPP_GATEWAY_INTERNAL_TOKEN: TOKEN,
    OCPP_GATEWAY_POD_ID: 'gw-test',
    OCPP_CALL_QUEUE_MAX: '1',
  });
  const registry = new StaticRegistry([
    { identity: 'CP-OPER', password: 'clave-oper', lifecycle: 'OPERATIONAL' },
    { identity: 'CP-RAW', password: 'clave-raw', lifecycle: 'OPERATIONAL' },
    { identity: 'CP-NUEVO', password: 'clave-nuevo', lifecycle: 'PROVISIONED' },
  ]);
  const persistence = new MemoryPersistence();
  const gateway = new Gateway({ config, registry, logger: pino({ level: 'silent' }), persistence });
  let internalUrl = '';
  let ocppPort = 0;
  let sim: SimulatedChargePoint;
  let raw: RPCClient;
  let client: GatewayClient;

  const post = (path: string, body: unknown, token: string | null = TOKEN) =>
    fetch(`${internalUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    const addresses = await gateway.start();
    internalUrl = addresses.internalUrl;
    ocppPort = addresses.ocppPort;
    sim = new SimulatedChargePoint({
      identity: 'CP-OPER',
      password: 'clave-oper',
      endpoint: `ws://127.0.0.1:${ocppPort}/ocpp`,
      connectors: 2,
    });
    await sim.start();
    raw = new RPCClient({
      identity: 'CP-RAW',
      endpoint: `ws://127.0.0.1:${ocppPort}/ocpp`,
      password: 'clave-raw',
      protocols: ['ocpp1.6'],
      strictMode: false,
      reconnect: false,
      maxReconnects: 0,
      callTimeoutMs: 5000,
    } as unknown as ClientOptions);
    raw.handle('ClearCache', async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { status: 'Accepted' };
    });
    raw.handle('UnlockConnector', async () => {
      throw createRPCError('NotSupported', 'sin cerradura');
    });
    raw.handle('ChangeAvailability', async () => ({ status: 'Ok' }));
    await raw.connect();
    client = new GatewayClient({
      directory: new StaticConnectionDirectory(internalUrl),
      token: TOKEN,
      retryDelayMs: 10,
    });
  });

  afterAll(async () => {
    await sim.close();
    await raw.close({ force: true }).catch(() => undefined);
    await gateway.stop();
  });

  it('exige el token interno', async () => {
    expect((await post('/internal/v1/calls', {}, null)).status).toBe(401);
    expect((await post('/internal/v1/calls', {}, 'otro-token')).status).toBe(401);
    expect(
      (
        await fetch(`${internalUrl}/internal/v1/nada`, {
          headers: { authorization: `Bearer ${TOKEN}` },
        })
      ).status,
    ).toBe(404);
  });

  it('envía GetConfiguration al cargador y devuelve el resultado con el uniqueId del CALL', async () => {
    const response = await post('/internal/v1/calls', {
      chargeBoxId: 'CP-OPER',
      action: 'GetConfiguration',
      payload: { key: ['HeartbeatInterval', 'NumberOfConnectors'] },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      uniqueId: string;
      rttMs: number;
      result: { configurationKey: { key: string; value: string }[] };
    };
    expect(body.uniqueId.length).toBeGreaterThan(0);
    expect(body.rttMs).toBeGreaterThanOrEqual(0);
    expect(body.result.configurationKey.map((k) => k.key).sort()).toEqual([
      'HeartbeatInterval',
      'NumberOfConnectors',
    ]);
    expect(sim.inboundCalls.at(-1)?.action).toBe('GetConfiguration');
    // El log de mensajes correlaciona la CALL saliente con su CALLRESULT.
    const logged = persistence.messages.filter((m) => m.uniqueId === body.uniqueId);
    expect(logged.map((m) => [m.direction, m.messageType, m.action])).toEqual([
      ['CS2CP', 2, 'GetConfiguration'],
      ['CP2CS', 3, 'GetConfiguration'],
    ]);
  });

  it('rechaza payloads inválidos, acciones que no inicia el sistema central y cargadores no conectados', async () => {
    const invalid = await post('/internal/v1/calls', {
      chargeBoxId: 'CP-OPER',
      action: 'ChangeConfiguration',
      payload: { key: 'HeartbeatInterval' },
    });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe(
      'INVALID_REQUEST',
    );

    const notCentral = await post('/internal/v1/calls', {
      chargeBoxId: 'CP-OPER',
      action: 'BootNotification',
      payload: { chargePointVendor: 'x', chargePointModel: 'y' },
    });
    expect(notCentral.status).toBe(400);

    const offline = await post('/internal/v1/calls', {
      chargeBoxId: 'CP-NADIE',
      action: 'ClearCache',
      payload: {},
    });
    expect(offline.status).toBe(404);
    expect(((await offline.json()) as { error: { code: string } }).error.code).toBe(
      'NOT_CONNECTED',
    );

    const malformed = await fetch(`${internalUrl}/internal/v1/calls`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: '{no es json',
    });
    expect(malformed.status).toBe(400);
  });

  it('traduce CALLERROR, timeout y respuestas fuera de esquema', async () => {
    const callError = await client.sendCall({
      chargeBoxId: 'CP-RAW',
      action: 'UnlockConnector',
      payload: { connectorId: 1 },
    });
    expect(callError.ok).toBe(false);
    if (!callError.ok) {
      expect(callError.error.code).toBe('CALL_ERROR');
      expect(callError.error.ocppErrorCode).toBe('NotSupported');
      expect(callError.uniqueId?.length).toBeGreaterThan(0);
    }

    const timeout = await client.sendCall({
      chargeBoxId: 'CP-RAW',
      action: 'ClearCache',
      payload: {},
      timeoutMs: 100,
    });
    expect(timeout.ok).toBe(false);
    if (!timeout.ok) expect(timeout.error.code).toBe('TIMEOUT');

    const invalidResponse = await client.sendCall({
      chargeBoxId: 'CP-RAW',
      action: 'ChangeAvailability',
      payload: { connectorId: 1, type: 'Operative' },
    });
    expect(invalidResponse.ok).toBe(false);
    if (!invalidResponse.ok) expect(invalidResponse.error.code).toBe('INVALID_RESPONSE');
  });

  it('limita la cola de CALL por cargador', async () => {
    await new Promise((resolve) => setTimeout(resolve, 450)); // deja terminar el ClearCache lento anterior
    const slow = client.sendCall({
      chargeBoxId: 'CP-RAW',
      action: 'ClearCache',
      payload: {},
      timeoutMs: 2000,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await client.sendCall({
      chargeBoxId: 'CP-RAW',
      action: 'ClearCache',
      payload: {},
      timeoutMs: 2000,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('QUEUE_FULL');
    const first = await slow;
    expect(first.ok).toBe(true);
  });

  it('el cliente del gateway ejecuta comandos de punta a punta', async () => {
    const outcome = await client.sendCall({
      chargeBoxId: 'CP-OPER',
      action: 'TriggerMessage',
      payload: { requestedMessage: 'MeterValues' },
    });
    expect(outcome).toMatchObject({
      ok: true,
      result: { status: 'NotImplemented' },
      podId: 'static',
    });
    const info = await client.getConnection('CP-OPER');
    expect(info).toMatchObject({
      chargeBoxId: 'CP-OPER',
      connected: true,
      podId: 'gw-test',
      lifecycle: 'OPERATIONAL',
    });
    expect(await client.getConnection('CP-NADIE')).toMatchObject({ connected: false });
  });

  it('mientras el cargador está pendiente solo acepta registro y estado', async () => {
    const pending = new SimulatedChargePoint({
      identity: 'CP-NUEVO',
      password: 'clave-nuevo',
      endpoint: `ws://127.0.0.1:${ocppPort}/ocpp`,
    });
    const boot = await pending.start();
    expect(boot.status).toBe('Pending');
    await expect(pending.call('Authorize', { idTag: 'ABC' })).rejects.toBeInstanceOf(
      RPCSecurityError,
    );
    await expect(pending.heartbeat()).resolves.toMatchObject({ currentTime: expect.any(String) });
    await pending.close();
  });

  it('cierra una conexión por administración', async () => {
    const closed = new Promise<{ code?: number }>((resolve) => sim.once('close', resolve));
    expect(await client.disconnect('CP-OPER', 1008, 'prueba')).toBe(true);
    expect((await closed).code).toBe(1008);
    expect(await client.disconnect('CP-OPER')).toBe(false);
    expect(gateway.connectionInfo('CP-OPER').status).toBe(404);
  });
});
