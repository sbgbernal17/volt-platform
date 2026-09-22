import {
  BillingAuthorizer,
  BillingService,
  CommandService,
  CommissioningService,
  CsmsError,
  SessionService,
} from '@volt/csms';
import { createSql } from '@volt/db';
import {
  GatewayClient,
  RedisConnectionDirectory,
  StaticConnectionDirectory,
} from '@volt/gateway-client';
import { FakeGateway, type PaymentGateway, WompiGateway } from '@volt/payments';
import Fastify, { type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { ZodError } from 'zod';
import { adminRoutes } from './admin/routes.ts';
import type { ApiConfig } from './config.ts';
import { DevDriverVerifier } from './public/auth.ts';
import { publicRoutes } from './public/routes.ts';

export interface AppDependencies {
  config: ApiConfig;
  /** Pasarela inyectada (pruebas: el emulador compartido con los trabajos del worker). */
  gateway?: PaymentGateway | undefined;
}

export const API_VERSION = '0.4.0';

/**
 * Construye la aplicación Fastify: salud, preparación, versión y, con base de datos y token de
 * administración, las rutas de inventario y comisionamiento en /admin/v1. Las rutas públicas
 * (/v1 para la app Volt) llegan con las sesiones (iteración 3).
 */
export function buildPaymentGateway(
  config: ApiConfig,
  injected?: PaymentGateway,
): PaymentGateway | undefined {
  if (injected) return injected;
  if (config.PAYMENTS_PROVIDER === 'wompi') {
    return new WompiGateway({
      environment: config.WOMPI_ENVIRONMENT,
      publicKey: config.WOMPI_PUBLIC_KEY as string,
      privateKey: config.WOMPI_PRIVATE_KEY as string,
      integritySecret: config.WOMPI_INTEGRITY_SECRET as string,
      eventsSecret: config.WOMPI_EVENTS_SECRET as string,
    });
  }
  if (config.PAYMENTS_PROVIDER === 'fake') return new FakeGateway();
  return undefined;
}

export function buildApp({ config, gateway: injectedGateway }: AppDependencies): FastifyInstance {
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

  if (sql) {
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
    const payments = buildPaymentGateway(config, injectedGateway);
    const billing = payments ? new BillingService(sql, payments, { logger: app.log }) : undefined;
    const authorizer = payments ? new BillingAuthorizer(sql) : undefined;
    if (payments) {
      app.log.info(
        { provider: payments.provider, environment: payments.environment },
        'pasarela de pago configurada',
      );
    } else {
      app.log.warn(
        'PAYMENTS_PROVIDER=none: las sesiones se autorizan sin medio de pago (solo desarrollo)',
      );
    }
    const sessions = commands
      ? new SessionService(sql, commands, {
          logger: app.log,
          ...(authorizer ? { paymentAuthorizer: authorizer } : {}),
        })
      : undefined;
    const verifier = config.API_DEV_DRIVER_AUTH ? new DevDriverVerifier(sql) : undefined;
    if (verifier) app.log.warn('API_DEV_DRIVER_AUTH activo: identidad de conductor de desarrollo');
    void app.register(publicRoutes, {
      prefix: '/v1',
      sql,
      verifier,
      sessions,
      ssePollMs: config.API_SSE_POLL_MS,
      sseHeartbeatMs: config.API_SSE_HEARTBEAT_MS,
      billing,
      authorizer,
      paymentsRedirectUrl: config.PAYMENTS_REDIRECT_URL,
    });
    if (config.API_ADMIN_TOKEN) {
      void app.register(adminRoutes, {
        prefix: '/admin/v1',
        sql,
        token: config.API_ADMIN_TOKEN,
        ...(commands ? { commands } : {}),
        ...(commissioning ? { commissioning } : {}),
        ...(sessions ? { sessions } : {}),
        ...(billing ? { billing } : {}),
        ssePollMs: config.API_SSE_POLL_MS,
        sseHeartbeatMs: config.API_SSE_HEARTBEAT_MS,
      });
    } else {
      app.log.warn('API de administración deshabilitada: hace falta API_ADMIN_TOKEN');
    }
  } else {
    app.log.warn('sin DATABASE_URL: solo salud y versión');
  }

  app.addHook('onClose', async () => {
    await sql?.end({ timeout: 5 });
    redis?.disconnect();
  });

  return app;
}
