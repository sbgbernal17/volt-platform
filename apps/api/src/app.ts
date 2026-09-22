import { CommandService, CommissioningService, CsmsError } from '@volt/csms';
import { createSql } from '@volt/db';
import {
  GatewayClient,
  RedisConnectionDirectory,
  StaticConnectionDirectory,
} from '@volt/gateway-client';
import Fastify, { type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { ZodError } from 'zod';
import { adminRoutes } from './admin/routes.ts';
import type { ApiConfig } from './config.ts';

export interface AppDependencies {
  config: ApiConfig;
}

export const API_VERSION = '0.2.0';

/**
 * Construye la aplicación Fastify: salud, preparación, versión y, con base de datos y token de
 * administración, las rutas de inventario y comisionamiento en /admin/v1. Las rutas públicas
 * (/v1 para la app Volt) llegan con las sesiones (iteración 3).
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

  app.setErrorHandler((rawError: unknown, _request, reply) => {
    const error = rawError as Error & { statusCode?: number };
    if (error instanceof CsmsError) {
      reply.code(error.status).send({
        error: { code: error.code, message: error.message, details: error.details ?? null },
      });
      return;
    }
    if (error instanceof ZodError) {
      reply
        .code(400)
        .send({ error: { code: 'VALIDATION', message: 'Datos inválidos', details: error.issues } });
      return;
    }
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 500) app.log.error({ err: error }, 'error no controlado');
    reply.code(status).send({
      error: {
        code: status >= 500 ? 'INTERNAL' : 'REQUEST',
        message: status >= 500 ? 'Error interno' : error.message,
      },
    });
  });

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

  if (sql && config.API_ADMIN_TOKEN) {
    let gateway: GatewayClient | undefined;
    if (config.OCPP_GATEWAY_INTERNAL_TOKEN) {
      const directory = redis
        ? new RedisConnectionDirectory(redis)
        : config.OCPP_GATEWAY_INTERNAL_URL
          ? new StaticConnectionDirectory(config.OCPP_GATEWAY_INTERNAL_URL)
          : undefined;
      if (directory)
        gateway = new GatewayClient({ directory, token: config.OCPP_GATEWAY_INTERNAL_TOKEN });
    }
    if (!gateway) {
      app.log.warn(
        'sin OCPP_GATEWAY_INTERNAL_TOKEN y directorio (REDIS_URL u OCPP_GATEWAY_INTERNAL_URL): los comandos a cargadores responderán 503',
      );
    }
    const commands = gateway ? new CommandService(sql, gateway, { logger: app.log }) : undefined;
    const commissioning = commands
      ? new CommissioningService(sql, commands, {
          logger: app.log,
          rebootWaitMs: config.COMMISSIONING_REBOOT_WAIT_MS,
        })
      : undefined;
    void app.register(adminRoutes, {
      prefix: '/admin/v1',
      sql,
      token: config.API_ADMIN_TOKEN,
      ...(commands ? { commands } : {}),
      ...(commissioning ? { commissioning } : {}),
    });
  } else {
    app.log.warn('API de administración deshabilitada: hacen falta DATABASE_URL y API_ADMIN_TOKEN');
  }

  app.addHook('onClose', async () => {
    await sql?.end({ timeout: 5 });
    redis?.disconnect();
  });

  return app;
}
