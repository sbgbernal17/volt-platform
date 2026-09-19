import type { EventEnvelope } from '@volt/events';
import {
  type IHandlersOption,
  RPCClient,
  RPCFormationViolationError,
  RPCNotImplementedError,
} from 'ocpp-rpc';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { basicAuthUsername, Gateway } from './gateway.ts';
import { StaticRegistry } from './registry.ts';

type ClientOptions = ConstructorParameters<typeof RPCClient>[0];

function makeClient(
  port: number,
  identity: string,
  password: string | null,
  protocols: string[] = ['ocpp1.6'],
): RPCClient {
  const options = {
    identity,
    endpoint: `ws://127.0.0.1:${port}/ocpp`,
    password,
    protocols,
    strictMode: false,
    reconnect: false,
    maxReconnects: 0,
    callTimeoutMs: 5000,
  } as unknown as ClientOptions;
  return new RPCClient(options);
}

describe('gateway OCPP 1.6J', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    OCPP_GATEWAY_HOST: '127.0.0.1',
    OCPP_GATEWAY_PORT: '0',
    OCPP_GATEWAY_HEALTH_PORT: '0',
    OCPP_HEARTBEAT_INTERVAL_S: '300',
    OCPP_PENDING_RETRY_S: '60',
  });
  const registry = new StaticRegistry([
    { identity: 'CP-OPER', password: 'clave-oper', lifecycle: 'OPERATIONAL' },
    { identity: 'CP-NUEVO', password: 'clave-nuevo', lifecycle: 'PROVISIONED' },
    { identity: 'CP-BAJA', password: 'clave-baja', lifecycle: 'DECOMMISSIONED' },
  ]);
  const events: EventEnvelope[] = [];
  const gateway = new Gateway({ config, registry, logger: pino({ level: 'silent' }) });
  gateway.on('event', (envelope) => events.push(envelope));
  let ocppPort = 0;
  let healthPort = 0;
  const clients: RPCClient[] = [];

  beforeAll(async () => {
    const addresses = await gateway.start();
    ocppPort = addresses.ocppPort;
    healthPort = addresses.healthPort;
  });

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close({ force: true }).catch(() => undefined)));
    await gateway.stop();
  });

  const connect = async (identity: string, password: string | null, protocols?: string[]) => {
    const client = makeClient(ocppPort, identity, password, protocols);
    clients.push(client);
    await client.connect();
    return client;
  };

  it('rechaza identidades desconocidas y credenciales incorrectas', async () => {
    await expect(connect('CP-INEXISTENTE', 'x')).rejects.toThrow();
    await expect(connect('CP-OPER', 'clave-mala')).rejects.toThrow();
    await expect(connect('CP-OPER', null)).rejects.toThrow();
  });

  it('rechaza conexiones sin el subprotocolo ocpp1.6', async () => {
    await expect(connect('CP-OPER', 'clave-oper', ['ocpp2.0.1'])).rejects.toThrow();
  });

  it('acepta un cargador operativo: BootNotification Accepted, Heartbeat y StatusNotification', async () => {
    const client = await connect('CP-OPER', 'clave-oper');
    const boot = (await client.call('BootNotification', {
      chargePointVendor: 'Acme',
      chargePointModel: 'DC180',
      chargePointSerialNumber: 'SN-1',
      firmwareVersion: '1.0.0',
    })) as { status: string; interval: number; currentTime: string };
    expect(boot.status).toBe('Accepted');
    expect(boot.interval).toBe(300);
    expect(new Date(boot.currentTime).toISOString()).toBe(boot.currentTime);

    const heartbeat = (await client.call('Heartbeat', {})) as { currentTime: string };
    expect(typeof heartbeat.currentTime).toBe('string');

    await client.call('StatusNotification', {
      connectorId: 1,
      errorCode: 'NoError',
      status: 'Available',
    });
    await client.call('StatusNotification', {
      connectorId: 1,
      errorCode: 'NoError',
      status: 'Preparing',
    });
    const statusEvents = events.filter((e) => e.name === 'connector.status.changed');
    expect(statusEvents.length).toBeGreaterThanOrEqual(2);
    const last = statusEvents.at(-1)?.payload as {
      status: string;
      previousStatus: string;
      expectedTransition: boolean;
    };
    expect(last).toMatchObject({
      status: 'Preparing',
      previousStatus: 'Available',
      expectedTransition: true,
    });
    expect(statusEvents.at(-1)?.orderingKey).toBe('CP-OPER');
    expect(gateway.connections.get('CP-OPER')?.messagesIn).toBeGreaterThanOrEqual(4);
  });

  it('responde Pending a un cargador recién aprovisionado y Rejected a uno dado de baja', async () => {
    const nuevo = await connect('CP-NUEVO', 'clave-nuevo');
    const boot = (await nuevo.call('BootNotification', {
      chargePointVendor: 'Acme',
      chargePointModel: 'DC40',
    })) as {
      status: string;
      interval: number;
    };
    expect(boot).toMatchObject({ status: 'Pending', interval: 60 });

    const baja = await connect('CP-BAJA', 'clave-baja');
    const bootBaja = (await baja.call('BootNotification', {
      chargePointVendor: 'Acme',
      chargePointModel: 'DC40',
    })) as {
      status: string;
      interval: number;
    };
    expect(bootBaja).toMatchObject({ status: 'Rejected', interval: 3600 });
  });

  it('rechaza payloads inválidos con FormationViolation y acciones desconocidas con NotImplemented', async () => {
    const client = await connect('CP-OPER', 'clave-oper');
    await expect(
      client.call('BootNotification', { chargePointVendor: 'Acme' }),
    ).rejects.toBeInstanceOf(RPCFormationViolationError);
    await expect(client.call('Inventada', {})).rejects.toBeInstanceOf(RPCNotImplementedError);
    // Acción válida pero iniciada solo por el CSMS: no se acepta desde el cargador.
    await expect(client.call('RemoteStartTransaction', { idTag: 'X' })).rejects.toBeInstanceOf(
      RPCNotImplementedError,
    );
  });

  it('cierra la conexión anterior cuando la misma identidad vuelve a conectarse', async () => {
    const first = await connect('CP-NUEVO', 'clave-nuevo');
    const closed = new Promise<{ code?: number }>((resolve) => first.once('close', resolve));
    const second = await connect('CP-NUEVO', 'clave-nuevo');
    const closeEvent = await closed;
    expect(closeEvent.code).toBe(1000);
    // El registro conserva una sola conexión viva para la identidad: la más reciente.
    expect(gateway.connections.list().filter((c) => c.identity === 'CP-NUEVO')).toHaveLength(1);
    expect(second.state).toBe(RPCClient.OPEN);
    const connected = events.filter(
      (e) =>
        e.name === 'charger.connected' &&
        e.payload &&
        (e.payload as { chargeBoxId: string }).chargeBoxId === 'CP-NUEVO',
    );
    const lastConnected = connected.at(-1)?.payload as { replacedPrevious: boolean } | undefined;
    expect(lastConnected?.replacedPrevious).toBe(true);
  });

  it('responde DataTransfer con UnknownVendorId y Authorize con Invalid', async () => {
    const client = await connect('CP-OPER', 'clave-oper');
    expect(await client.call('DataTransfer', { vendorId: 'com.example', messageId: 'X' })).toEqual({
      status: 'UnknownVendorId',
    });
    expect(await client.call('Authorize', { idTag: 'ABC123' })).toEqual({
      idTagInfo: { status: 'Invalid' },
    });
  });

  it('expone salud, preparación y métricas', async () => {
    const health = (await (await fetch(`http://127.0.0.1:${healthPort}/healthz`)).json()) as {
      status: string;
      connections: number;
    };
    expect(health.status).toBe('ok');
    expect(health.connections).toBeGreaterThanOrEqual(1);
    expect((await fetch(`http://127.0.0.1:${healthPort}/readyz`)).status).toBe(200);
    const metrics = await (await fetch(`http://127.0.0.1:${healthPort}/metrics`)).text();
    expect(metrics).toContain('ocpp_connections');
    expect(metrics).toContain('ocpp_auth_rejected_total');
    expect((await fetch(`http://127.0.0.1:${healthPort}/nada`)).status).toBe(404);
  });

  it('soporta que el cargador reciba llamadas del servidor (base para comandos)', async () => {
    const client = await connect('CP-OPER', 'clave-oper');
    client.handle('GetConfiguration', async ({ params }: IHandlersOption) => ({
      configurationKey: [{ key: 'HeartbeatInterval', readonly: false, value: '300' }],
      unknownKey: (params?.key as string[] | undefined) ?? [],
    }));
    const live = gateway.connections.get('CP-OPER');
    expect(live).toBeDefined();
    const response = (await live?.client.call('GetConfiguration', {
      key: ['HeartbeatInterval', 'X'],
    })) as {
      configurationKey: { key: string }[];
      unknownKey: string[];
    };
    expect(response.configurationKey[0]?.key).toBe('HeartbeatInterval');
  });
});

describe('basicAuthUsername', () => {
  it('extrae el usuario de una cabecera Basic', () => {
    expect(basicAuthUsername(`Basic ${Buffer.from('CP001:secreto').toString('base64')}`)).toBe(
      'CP001',
    );
    expect(
      basicAuthUsername(`basic ${Buffer.from('CP001:con:dos:puntos').toString('base64')}`),
    ).toBe('CP001');
    expect(basicAuthUsername('Bearer abc')).toBeUndefined();
    expect(basicAuthUsername(undefined)).toBeUndefined();
  });
});
