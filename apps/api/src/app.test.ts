import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_VERSION, buildApp } from './app.ts';
import { loadConfig } from './config.ts';

describe('api: salud y versión', () => {
  const app = buildApp({
    config: loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      ...(process.env.REDIS_URL ? { REDIS_URL: process.env.REDIS_URL } : {}),
    }),
  });

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde /healthz', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'api', version: API_VERSION });
  });

  it('responde /readyz con el estado de las dependencias', async () => {
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect([200, 503]).toContain(response.statusCode);
    const body = response.json() as { checks: Record<string, string> };
    expect(Object.keys(body.checks)).toEqual(['database', 'redis']);
    if (process.env.DATABASE_URL) expect(body.checks.database).toBe('ok');
    if (process.env.REDIS_URL) expect(body.checks.redis).toBe('ok');
  });

  it('expone la versión de la API', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/version' });
    expect(response.json()).toEqual({ version: API_VERSION, ocpp: ['1.6J'] });
  });

  it('rechaza configuración inválida', () => {
    expect(() => loadConfig({ API_PORT: 'abc' })).toThrow(/Configuración inválida/);
  });
});
