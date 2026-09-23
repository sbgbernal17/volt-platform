import {
  BillingAuthorizer,
  BillingService,
  bootstrapFirstAdmin,
  CommandService,
  CommissioningService,
  CsmsError,
  SessionService,
  VOLT_TENANT_ID,
} from '@volt/csms';
import { createSql } from '@volt/db';
import {
  GatewayClient,
  RedisConnectionDirectory,
  StaticConnectionDirectory,
} from '@volt/gateway-client';
import { FakeGateway, type PaymentGateway, WOMPI_BASE_URLS, WompiGateway } from '@volt/payments';
import Fastify, { type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { ZodError } from 'zod';
import { IdentityPlatformVerifier } from './admin/identity.ts';
import { adminRoutes } from './admin/routes.ts';
import { StaffAuthenticator } from './admin/staff-auth.ts';
import { type AuthConfig, authConfigRoute } from './admin/staff-routes.ts';
import type { ApiConfig } from './config.ts';
import { registerCors } from './cors.ts';
import { CompositeDriverVerifier, DevDriverVerifier } from './public/auth.ts';
import { DriverIdentityVerifier } from './public/identity.ts';
import type { AppConfigStatic } from './public/me-routes.ts';
import { publicRoutes } from './public/routes.ts';

export interface AppDependencies {
  config: ApiConfig;
  /** Pasarela inyectada (pruebas: el emulador compartido con los trabajos del worker). */
  gateway?: PaymentGateway | undefined;
}

export const API_VERSION = '0.6.0';

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

  registerCors(app, config.API_CORS_ORIGINS);

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
    const staffVerifier = config.IDENTITY_PLATFORM_PROJECT_ID
      ? new IdentityPlatformVerifier({
          projectId: config.IDENTITY_PLATFORM_PROJECT_ID,
          jwksUrl: config.IDENTITY_PLATFORM_JWKS_URL,
        })
      : undefined;
    // Identidad del conductor (iteración 7): Identity Platform y, en local, el token de desarrollo.
    const devVerifier = config.API_DEV_DRIVER_AUTH ? new DevDriverVerifier(sql) : undefined;
    if (devVerifier)
      app.log.warn('API_DEV_DRIVER_AUTH activo: identidad de conductor de desarrollo');
    const driverIdentity = staffVerifier
      ? new DriverIdentityVerifier({
          sql,
          tenantId: VOLT_TENANT_ID,
          verifier: staffVerifier,
          driverTenantId: config.IDENTITY_PLATFORM_DRIVER_TENANT_ID,
        })
      : undefined;
    const driverVerifiers = [devVerifier, driverIdentity].filter(
      (v): v is NonNullable<typeof v> => v !== undefined,
    );
    const verifier = driverVerifiers.length
      ? new CompositeDriverVerifier(driverVerifiers)
      : undefined;
    if (!verifier)
      app.log.warn('sin identidad de conductor: las rutas privadas de /v1 responderán 401');
    const appConfig: AppConfigStatic = {
      auth: {
        provider: driverIdentity ? 'identity-platform' : devVerifier ? 'dev' : 'none',
        projectId: config.IDENTITY_PLATFORM_PROJECT_ID ?? null,
        apiKey: driverIdentity ? (config.IDENTITY_PLATFORM_API_KEY ?? null) : null,
        authDomain: driverIdentity
          ? (config.IDENTITY_PLATFORM_AUTH_DOMAIN ??
            `${config.IDENTITY_PLATFORM_PROJECT_ID}.firebaseapp.com`)
          : null,
        tenantId: config.IDENTITY_PLATFORM_DRIVER_TENANT_ID ?? null,
        devLogin: Boolean(devVerifier),
      },
      payments: {
        provider: payments ? config.PAYMENTS_PROVIDER : 'none',
        environment: payments?.environment ?? 'none',
        publicKey: config.PAYMENTS_PROVIDER === 'wompi' ? (config.WOMPI_PUBLIC_KEY ?? null) : null,
        apiBaseUrl:
          config.PAYMENTS_PROVIDER === 'wompi' ? WOMPI_BASE_URLS[config.WOMPI_ENVIRONMENT] : null,
      },
      legal: {
        termsUrl: config.APP_TERMS_URL,
        privacyUrl: config.APP_PRIVACY_URL,
        supportEmail: config.APP_SUPPORT_EMAIL ?? null,
      },
    };
    void app.register(publicRoutes, {
      prefix: '/v1',
      sql,
      version: API_VERSION,
      appConfig,
      verifier,
      sessions,
      ssePollMs: config.API_SSE_POLL_MS,
      sseHeartbeatMs: config.API_SSE_HEARTBEAT_MS,
      billing,
      authorizer,
      paymentsRedirectUrl: config.PAYMENTS_REDIRECT_URL,
    });
    const authConfig: AuthConfig = {
      provider: staffVerifier ? 'identity-platform' : config.API_ADMIN_TOKEN ? 'token' : 'none',
      projectId: config.IDENTITY_PLATFORM_PROJECT_ID ?? null,
      apiKey: staffVerifier ? (config.IDENTITY_PLATFORM_API_KEY ?? null) : null,
      authDomain: staffVerifier
        ? (config.IDENTITY_PLATFORM_AUTH_DOMAIN ??
          `${config.IDENTITY_PLATFORM_PROJECT_ID}.firebaseapp.com`)
        : null,
      tokenLogin: Boolean(config.API_ADMIN_TOKEN),
    };
    void app.register(authConfigRoute, { prefix: '/admin/v1', authConfig });
    if (staffVerifier || config.API_ADMIN_TOKEN) {
      const authenticator = new StaffAuthenticator({
        sql,
        tenantId: VOLT_TENANT_ID,
        staticToken: config.API_ADMIN_TOKEN,
        verifier: staffVerifier,
      });
      if (staffVerifier) {
        app.log.info(
          { projectId: staffVerifier.projectId },
          'personal autenticado con Identity Platform',
        );
      }
      if (config.API_ADMIN_TOKEN) {
        app.log.warn('API_ADMIN_TOKEN activo: token estático de administración (solo laboratorio)');
      }
      void app.register(adminRoutes, {
        prefix: '/admin/v1',
        sql,
        authenticator,
        authConfig,
        ...(commands ? { commands } : {}),
        ...(commissioning ? { commissioning } : {}),
        ...(sessions ? { sessions } : {}),
        ...(billing ? { billing } : {}),
        ssePollMs: config.API_SSE_POLL_MS,
        sseHeartbeatMs: config.API_SSE_HEARTBEAT_MS,
      });
    } else {
      app.log.warn(
        'API de administración deshabilitada: hacen falta IDENTITY_PLATFORM_PROJECT_ID o API_ADMIN_TOKEN',
      );
    }
    if (config.API_STAFF_BOOTSTRAP_EMAIL) {
      const email = config.API_STAFF_BOOTSTRAP_EMAIL;
      app.addHook('onReady', async () => {
        const created = await bootstrapFirstAdmin(sql, VOLT_TENANT_ID, email);
        if (created) app.log.info({ email: created.email }, 'primer administrador invitado');
      });
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
