import { createSql } from '@volt/db';
import Fastify, { type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import type { ApiConfig } from './config.ts';

export interface AppDependencies {
  config: ApiConfig;
}

export const API_VERSION = '0.1.0';

/**
 * Construye la aplicación Fastify. Las rutas de negocio (/v1, /admin) se añaden por módulo en
 * iteraciones posteriores; aquí solo viven salud, preparación y versión.
 */
export function buildApp({ config }: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
  });

  const sql = config.DATABASE_URL
    ? createSql(config.DATABASE_URL, { max: 5, applicationName: 'volt-api' })
    : undefined;
  const redis = config.REDIS_URL
    ? new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
    : undefined;

  app.get('/healthz', async () => ({ status: 'ok', service: 'api', version: API_VERSION }));

  app.get('/readyz', async (_request, reply) => {
    const checks: Record<string, 'ok' | 'skipped' | 'error'> = {
      database: 'skipped',
      redis: 'skipped',
    };
    if (sql) {
      try {
        await sql`SELECT 1`;
        checks.database = 'ok';
      } catch {
        checks.database = 'error';
      }
    }
    if (redis) {
      try {
        if (redis.status === 'wait') await redis.connect();
        await redis.ping();
        checks.redis = 'ok';
      } catch {
        checks.redis = 'error';
      }
    }
    const ready = Object.values(checks).every((c) => c !== 'error');
    reply.code(ready ? 200 : 503);
    return { status: ready ? 'ready' : 'not_ready', checks };
  });

  app.get('/v1/version', async () => ({ version: API_VERSION, ocpp: ['1.6J'] }));

  app.addHook('onClose', async () => {
    await sql?.end({ timeout: 5 });
    redis?.disconnect();
  });

  return app;
}
