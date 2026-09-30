import {
  BillingService,
  CommandService,
  CommissioningService,
  PricingService,
  SessionService,
  TransactionService,
} from '@volt/csms';
import { createSql } from '@volt/db';
import {
  GatewayClient,
  RedisConnectionDirectory,
  StaticConnectionDirectory,
} from '@volt/gateway-client';
import { createLogger } from '@volt/logging';
import { FakeGateway, WompiGateway } from '@volt/payments';
import { Redis } from 'ioredis';
import { loadConfig } from './config.ts';
import { startHealthServer } from './health.ts';
import { runAuditChainCheck } from './jobs/audit.ts';
import { runBillingCycle, runReconciliation } from './jobs/billing.ts';
import { dailyAt, runConfigDriftCheck } from './jobs/config-drift.ts';
import { watchConnections } from './jobs/connection-watch.ts';
import {
  type EventPublisher,
  LogEventPublisher,
  RedisEventPublisher,
  relayOutbox,
} from './jobs/outbox-relay.ts';
import { ensureMonthlyPartitions } from './jobs/partitions.ts';
import { activateTariffs, enforceSessionLimits, settleSessions } from './jobs/pricing.ts';
import { CompositeEventPublisher, PubSubEventPublisher } from './jobs/pubsub.ts';
import { deliverPushNotifications, ExpoPushSender, LogPushSender } from './jobs/push.ts';
import { closeOrphanTransactions, expireSessionStarts } from './jobs/sessions.ts';
import { type Job, Scheduler } from './scheduler.ts';

const config = loadConfig();
const logger = createLogger({
  service: 'worker',
  level: config.LOG_LEVEL,
  pretty: config.NODE_ENV === 'development',
  env: config.VOLT_ENV,
});
const startedAt = new Date();

const sql = config.DATABASE_URL
  ? createSql(config.DATABASE_URL, {
      max: 3,
      applicationName: 'volt-worker',
      sslCa: config.DATABASE_SSL_CA,
    })
  : undefined;
const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, { lazyConnect: true }) : undefined;
if (redis) await redis.connect();

const jobs: Job[] = [
  {
    name: 'heartbeat',
    intervalMs: 60_000,
    run: async () => {
      logger.debug('worker vivo');
    },
  },
];

if (sql) {
  const publishers: EventPublisher[] = redis
    ? [new RedisEventPublisher(redis, config.WORKER_EVENTS_CHANNEL)]
    : [new LogEventPublisher(logger)];
  if (config.OUTBOX_PUBSUB_TOPIC) {
    publishers.push(new PubSubEventPublisher(config.OUTBOX_PUBSUB_TOPIC));
    logger.info({ topic: config.OUTBOX_PUBSUB_TOPIC }, 'eventos del outbox también a Pub/Sub');
  }
  const publisher = new CompositeEventPublisher(publishers);
  const pricing = new PricingService(sql, { logger });
  const transactions = new TransactionService(sql, { logger, pricing });
  jobs.push(
    {
      name: 'outbox-relay',
      intervalMs: config.WORKER_OUTBOX_POLL_MS,
      run: async () => {
        await relayOutbox(sql, publisher, { batch: config.WORKER_OUTBOX_BATCH, logger });
      },
    },
    {
      name: 'session-start-timeouts',
      intervalMs: config.WORKER_SESSION_TIMEOUT_POLL_MS,
      run: async () => {
        await expireSessionStarts(transactions, logger);
      },
    },
    {
      name: 'orphan-transactions',
      intervalMs: config.WORKER_ORPHAN_POLL_MS,
      run: async () => {
        await closeOrphanTransactions(transactions, config.WORKER_ORPHAN_TIMEOUT_H, logger);
      },
    },
    {
      name: 'connection-watch',
      intervalMs: config.WORKER_CONNECTION_WATCH_POLL_MS,
      run: async () => {
        const summary = await watchConnections(sql, {
          graceS: config.WORKER_OFFLINE_GRACE_S,
          siteCriticalRatio: config.WORKER_OFFLINE_SITE_CRITICAL_RATIO,
          logger,
        });
        if (summary.raised > 0 || summary.resolved > 0)
          logger.info(summary, 'vigilancia de conexiones');
      },
    },
    dailyAt('partitions', 1, () => ensureMonthlyPartitions(sql, { logger })),
    dailyAt('audit-chain', config.WORKER_AUDIT_CHECK_HOUR_UTC, () =>
      runAuditChainCheck(sql, logger),
    ),
    {
      name: 'pricing-settlement',
      intervalMs: config.WORKER_PRICING_POLL_MS,
      run: async () => {
        await settleSessions(pricing, logger);
      },
    },
    {
      name: 'tariff-activation',
      intervalMs: config.WORKER_TARIFF_POLL_MS,
      run: async () => {
        await activateTariffs(sql, logger);
      },
    },
  );
  await ensureMonthlyPartitions(sql, { logger });
  // Notificaciones push al conductor (iteración 7): a partir del outbox, con bandeja idempotente.
  if (config.PUSH_PROVIDER !== 'none') {
    const sender =
      config.PUSH_PROVIDER === 'expo'
        ? new ExpoPushSender({ accessToken: config.EXPO_ACCESS_TOKEN })
        : new LogPushSender(logger);
    jobs.push({
      name: 'push-notifications',
      intervalMs: config.WORKER_PUSH_POLL_MS,
      run: async () => {
        await deliverPushNotifications(sql, sender, {
          batch: config.WORKER_PUSH_BATCH,
          lookbackH: config.WORKER_PUSH_LOOKBACK_H,
          logger,
        });
      },
    });
  } else {
    logger.warn('notificaciones push deshabilitadas (PUSH_PROVIDER=none)');
  }
  // Cobros con la pasarela real o con el emulador (`fake`, ambiente dev): el emulador es determinista
  // por identificador, así que este proceso cobra fuentes que creó la API sin compartir memoria.
  // POST /admin/v1/billing/jobs/run sigue sirviendo para forzar un ciclo desde el laboratorio.
  if (config.PAYMENTS_PROVIDER === 'wompi' || config.PAYMENTS_PROVIDER === 'fake') {
    const gateway =
      config.PAYMENTS_PROVIDER === 'wompi'
        ? new WompiGateway({
            environment: config.WOMPI_ENVIRONMENT,
            publicKey: config.WOMPI_PUBLIC_KEY as string,
            privateKey: config.WOMPI_PRIVATE_KEY as string,
            integritySecret: config.WOMPI_INTEGRITY_SECRET as string,
            eventsSecret: config.WOMPI_EVENTS_SECRET as string,
          })
        : new FakeGateway();
    if (gateway.environment === 'fake') {
      logger.warn('cobros con el emulador de pagos (PAYMENTS_PROVIDER=fake): solo desarrollo');
    }
    const billing = new BillingService(sql, gateway, { logger });
    jobs.push(
      {
        name: 'billing',
        intervalMs: config.WORKER_BILLING_POLL_MS,
        run: async () => {
          await runBillingCycle(billing, logger);
        },
      },
      dailyAt('billing-reconciliation', config.WORKER_RECONCILIATION_HOUR_UTC, () =>
        runReconciliation(billing, logger),
      ),
    );
  } else {
    logger.warn(
      { provider: config.PAYMENTS_PROVIDER },
      'cobros deshabilitados en el worker (PAYMENTS_PROVIDER=none)',
    );
  }
}

const directory = redis
  ? new RedisConnectionDirectory(redis)
  : config.OCPP_GATEWAY_INTERNAL_URL
    ? new StaticConnectionDirectory(config.OCPP_GATEWAY_INTERNAL_URL)
    : undefined;
if (sql && directory && config.OCPP_GATEWAY_INTERNAL_TOKEN) {
  const gateway = new GatewayClient({ directory, token: config.OCPP_GATEWAY_INTERNAL_TOKEN });
  const commands = new CommandService(sql, gateway, { logger });
  const sessions = new SessionService(sql, commands, { logger });
  jobs.push({
    name: 'session-limits',
    intervalMs: config.WORKER_LIMITS_POLL_MS,
    run: async () => {
      await enforceSessionLimits(sql, sessions, logger);
    },
  });
  if (config.WORKER_DRIFT_ENABLED) {
    const commissioning = new CommissioningService(sql, commands, { logger });
    jobs.push(
      dailyAt('config-drift', config.WORKER_DRIFT_CHECK_HOUR_UTC, () =>
        runConfigDriftCheck({
          sql,
          commissioning,
          logger,
          ratePerSecond: config.WORKER_DRIFT_RATE_PER_S,
        }),
      ),
    );
  }
} else {
  logger.warn(
    'límites de sesión y revisión de deriva deshabilitados: faltan DATABASE_URL, OCPP_GATEWAY_INTERNAL_TOKEN o el directorio del gateway',
  );
}

const scheduler = new Scheduler(jobs, logger);
scheduler.start();
const health =
  config.WORKER_HEALTH_PORT > 0
    ? startHealthServer(config.WORKER_HEALTH_PORT, {
        service: 'worker',
        jobs: jobs.map((job) => job.name),
        startedAt,
      })
    : undefined;
if (health) logger.info({ port: config.WORKER_HEALTH_PORT }, 'endpoint de salud del worker');

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'apagando worker');
  health?.close();
  await scheduler.stop();
  await sql?.end({ timeout: 5 });
  await redis?.quit().catch(() => undefined);
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
