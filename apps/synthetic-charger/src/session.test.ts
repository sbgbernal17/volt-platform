/**
 * La sesión de prueba habla con la API de administración real (Fastify): la parada se envía como
 * POST con content-type JSON, y Fastify rechaza con 400 un cuerpo vacío con ese content-type
 * (caso visto en dev y staging el 30-09-2026: `parada 400` y sesiones que quedaban abiertas).
 */
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTestSession } from './session.ts';

describe('sesión de prueba por la API de administración', () => {
  const app = Fastify();
  const calls: string[] = [];
  let apiUrl = '';

  beforeAll(async () => {
    app.post('/admin/v1/sessions', async (request, reply) => {
      calls.push(`start ${JSON.stringify(request.body)}`);
      reply.code(202);
      return { id: 'ses-1', state: 'STARTING' };
    });
    app.post('/admin/v1/sessions/:id/stop', async (request, reply) => {
      calls.push(`stop ${(request.params as { id: string }).id}`);
      reply.code(202);
      return { id: 'ses-1', state: 'STOPPING' };
    });
    app.get('/admin/v1/sessions/:id', async () => ({ id: 'ses-1', state: 'ENDED' }));
    apiUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  it('inicia, detiene (POST aceptado por Fastify) y espera el estado final', async () => {
    const result = await runTestSession({
      apiUrl,
      adminToken: 'token-de-prueba',
      evseId: 'VOLT-SYNTH-TEST-1',
      durationMs: 10,
    });
    expect(result).toMatchObject({ ok: true, sessionId: 'ses-1', state: 'ENDED' });
    expect(calls).toEqual(['start {"evseId":"VOLT-SYNTH-TEST-1","channel":"TEST"}', 'stop ses-1']);
  });

  it('informa el cuerpo de la respuesta cuando la parada falla', async () => {
    const failing = Fastify();
    failing.post('/admin/v1/sessions', async (_request, reply) => {
      reply.code(202);
      return { id: 'ses-2', state: 'STARTING' };
    });
    failing.post('/admin/v1/sessions/:id/stop', async (_request, reply) => {
      reply.code(503);
      return { error: { code: 'CHARGER_OFFLINE', message: 'cargador sin conexión' } };
    });
    const url = await failing.listen({ host: '127.0.0.1', port: 0 });
    try {
      const result = await runTestSession({
        apiUrl: url,
        adminToken: 'token-de-prueba',
        evseId: 'VOLT-SYNTH-TEST-1',
        durationMs: 10,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('parada 503');
      expect(result.error).toContain('CHARGER_OFFLINE');
    } finally {
      await failing.close();
    }
  });
});
