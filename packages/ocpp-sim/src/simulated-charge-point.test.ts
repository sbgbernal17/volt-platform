import type { AddressInfo } from 'node:net';
import { type IHandlersOption, type RPCClient, RPCServer } from 'ocpp-rpc';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SimulatedChargePoint } from './simulated-charge-point.ts';

describe('cargador simulado', () => {
  const server = new RPCServer({ protocols: ['ocpp1.6'], strictMode: false });
  const clients = new Map<string, RPCClient>();
  const inbound: string[] = [];
  let port = 0;

  beforeAll(async () => {
    server.auth((accept, _reject, handshake) => {
      accept({ identity: handshake.identity }, 'ocpp1.6');
    });
    server.on('client', (client: RPCClient) => {
      clients.set(client.identity ?? '', client);
      client.handle(async ({ method }: IHandlersOption) => {
        inbound.push(method ?? '');
        if (method === 'BootNotification') {
          return { status: 'Accepted', currentTime: new Date().toISOString(), interval: 120 };
        }
        if (method === 'Heartbeat') return { currentTime: new Date().toISOString() };
        return {};
      });
    });
    const http = await server.listen(0, '127.0.0.1');
    port = (http.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await server.close({ awaitPending: false, force: true });
  });

  it('arranca, responde a la configuración y reinicia ante un Reset', async () => {
    const sim = new SimulatedChargePoint({
      identity: 'SIM-1',
      password: 'x',
      endpoint: `ws://127.0.0.1:${port}/ocpp`,
      connectors: 2,
      rebootRequiredKeys: ['WebSocketPingInterval'],
      resetDelayMs: 20,
    });
    const boot = await sim.start();
    expect(boot.status).toBe('Accepted');
    expect(sim.configuration.get('HeartbeatInterval')?.value).toBe('120');
    expect(inbound.filter((a) => a === 'StatusNotification').length).toBe(3);

    const server1 = clients.get('SIM-1');
    expect(server1).toBeDefined();
    if (!server1) return;
    const all = (await server1.call('GetConfiguration', {})) as {
      configurationKey: { key: string; readonly: boolean; value: string }[];
      unknownKey: string[];
    };
    expect(all.configurationKey.find((k) => k.key === 'NumberOfConnectors')).toEqual({
      key: 'NumberOfConnectors',
      readonly: true,
      value: '2',
    });
    const some = (await server1.call('GetConfiguration', {
      key: ['HeartbeatInterval', 'Nada'],
    })) as {
      configurationKey: { key: string }[];
      unknownKey: string[];
    };
    expect(some.configurationKey.map((k) => k.key)).toEqual(['HeartbeatInterval']);
    expect(some.unknownKey).toEqual(['Nada']);

    expect(
      await server1.call('ChangeConfiguration', { key: 'HeartbeatInterval', value: '300' }),
    ).toEqual({
      status: 'Accepted',
    });
    expect(
      await server1.call('ChangeConfiguration', { key: 'NumberOfConnectors', value: '3' }),
    ).toEqual({
      status: 'Rejected',
    });
    expect(await server1.call('ChangeConfiguration', { key: 'Inventada', value: '1' })).toEqual({
      status: 'NotSupported',
    });
    expect(
      await server1.call('ChangeConfiguration', { key: 'WebSocketPingInterval', value: '60' }),
    ).toEqual({
      status: 'RebootRequired',
    });
    expect(
      await server1.call('ChangeConfiguration', { key: 'AuthorizationKey', value: 'ABCD' }),
    ).toEqual({
      status: 'Accepted',
    });
    expect(sim.authorizationKey).toBe('ABCD');
    expect(await server1.call('UnlockConnector', { connectorId: 1 })).toEqual({
      status: 'Unlocked',
    });
    expect(await server1.call('TriggerMessage', { requestedMessage: 'Heartbeat' })).toEqual({
      status: 'Accepted',
    });
    expect(
      await server1.call('ChangeAvailability', { connectorId: 1, type: 'Inoperative' }),
    ).toEqual({
      status: 'Accepted',
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sim.connectorStatus.get(1)).toBe('Unavailable');
    expect(inbound.includes('Heartbeat')).toBe(true);

    const rebooted = sim.waitForReboot(3000);
    expect(await server1.call('Reset', { type: 'Soft' })).toEqual({ status: 'Accepted' });
    await rebooted;
    expect(sim.bootCount).toBe(2); // arranque inicial + reinicio
    expect(sim.connected).toBe(true);
    expect(sim.configuration.get('WebSocketPingInterval')?.value).toBe('60');
    await sim.close();
  });
});
