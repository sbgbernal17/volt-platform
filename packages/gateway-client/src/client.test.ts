import { describe, expect, it } from 'vitest';
import { GatewayClient } from './client.ts';
import { StaticConnectionDirectory } from './directory.ts';

type FetchImpl = typeof fetch;

function fakeFetch(
  responder: (url: string, init: RequestInit) => Response | Promise<Response>,
): FetchImpl {
  return (async (input: string | URL | Request, init?: RequestInit) =>
    responder(String(input), init ?? {})) as FetchImpl;
}

describe('GatewayClient', () => {
  const directory = new StaticConnectionDirectory('http://gateway.internal:9222');

  it('envía la CALL al pod del directorio con el token y devuelve el resultado', async () => {
    let seenUrl = '';
    let seenAuth = '';
    let seenBody = '';
    const client = new GatewayClient({
      directory,
      token: 'secreto',
      fetchImpl: fakeFetch((url, init) => {
        seenUrl = url;
        seenAuth = (init.headers as Record<string, string>).authorization ?? '';
        seenBody = String(init.body);
        return Response.json({ uniqueId: 'u1', result: { status: 'Accepted' }, rttMs: 7 });
      }),
    });
    const outcome = await client.sendCall({
      chargeBoxId: 'CP1',
      action: 'Reset',
      payload: { type: 'Soft' },
    });
    expect(outcome).toEqual({
      ok: true,
      uniqueId: 'u1',
      result: { status: 'Accepted' },
      rttMs: 7,
      podId: 'static',
    });
    expect(seenUrl).toBe('http://gateway.internal:9222/internal/v1/calls');
    expect(seenAuth).toBe('Bearer secreto');
    expect(JSON.parse(seenBody)).toMatchObject({ chargeBoxId: 'CP1', action: 'Reset' });
  });

  it('traduce los códigos HTTP a errores tipados', async () => {
    const cases: [number, string][] = [
      [404, 'NOT_CONNECTED'],
      [504, 'TIMEOUT'],
      [429, 'QUEUE_FULL'],
      [400, 'INVALID_REQUEST'],
      [401, 'UNAUTHORIZED'],
      [502, 'CALL_ERROR'],
    ];
    for (const [status, code] of cases) {
      const client = new GatewayClient({
        directory,
        token: 't',
        retryDelayMs: 1,
        fetchImpl: fakeFetch(() =>
          Response.json(
            { uniqueId: 'u2', error: { ocppErrorCode: 'NotSupported', description: 'no' } },
            { status },
          ),
        ),
      });
      const outcome = await client.sendCall({ chargeBoxId: 'CP1', action: 'X', payload: {} });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe(code);
        expect(outcome.error.description).toBe('no');
        if (code === 'CALL_ERROR') expect(outcome.error.ocppErrorCode).toBe('NotSupported');
      }
    }
  });

  it('reintenta una vez cuando el pod no responde y devuelve UNAVAILABLE si persiste', async () => {
    let attempts = 0;
    const client = new GatewayClient({
      directory,
      token: 't',
      retryDelayMs: 1,
      fetchImpl: fakeFetch(() => {
        attempts += 1;
        throw new Error('ECONNREFUSED');
      }),
    });
    const outcome = await client.sendCall({ chargeBoxId: 'CP1', action: 'Heartbeat', payload: {} });
    expect(attempts).toBe(2);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('UNAVAILABLE');
  });

  it('consulta y cierra conexiones', async () => {
    const client = new GatewayClient({
      directory,
      token: 't',
      fetchImpl: fakeFetch((url, init) => {
        if (url.endsWith('/disconnect') && init.method === 'POST') {
          return new Response(null, { status: 204 });
        }
        return Response.json({ chargeBoxId: 'CP1', connected: true, podId: 'gw-1' });
      }),
    });
    expect(await client.getConnection('CP1')).toMatchObject({ connected: true, podId: 'gw-1' });
    expect(await client.disconnect('CP1')).toBe(true);
  });
});
