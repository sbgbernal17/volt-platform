import { describe, expect, it } from 'vitest';
import { ApiClient, type ApiError } from './api.ts';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return async (input, init) =>
    new Response(
      JSON.stringify({
        ...(body as object),
        _url: String(input),
        _auth: (init?.headers as Record<string, string>)?.authorization ?? null,
      }),
      {
        status,
        headers: { 'content-type': 'application/json' },
      },
    );
}

describe('cliente de API', () => {
  it('añade el token, arma la consulta y devuelve JSON', async () => {
    const api = new ApiClient({
      baseUrl: 'http://api.test',
      token: async () => 'tok',
      headers: () => ({ 'x-actor': 'staff:ana' }),
      fetchImpl: fakeFetch(200, { ok: true }),
    });
    const result = await api.get<{ ok: boolean; _url: string; _auth: string }>('/sites', {
      siteId: 'a',
      empty: undefined,
      n: 2,
    });
    expect(result.ok).toBe(true);
    expect(result._url).toBe('http://api.test/admin/v1/sites?siteId=a&n=2');
    expect(result._auth).toBe('Bearer tok');
  });

  it('convierte errores de la API en ApiError y avisa en 401', async () => {
    let unauthorized: ApiError | null = null;
    const api = new ApiClient({
      baseUrl: '',
      token: async () => null,
      fetchImpl: fakeFetch(401, {
        error: { code: 'REAUTH_REQUIRED', message: 'vuelve', details: { maxHours: 12 } },
      }),
      onUnauthorized: (error) => {
        unauthorized = error;
      },
    });
    await expect(api.get('/me')).rejects.toMatchObject({
      status: 401,
      code: 'REAUTH_REQUIRED',
      message: 'vuelve',
    });
    expect(unauthorized).not.toBeNull();
    expect((unauthorized as unknown as ApiError).details).toEqual({ maxHours: 12 });
  });

  it('marca los fallos de red', async () => {
    const api = new ApiClient({
      baseUrl: '',
      token: async () => null,
      fetchImpl: async () => {
        throw new Error('caído');
      },
    });
    await expect(api.post('/x', {})).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });
});
