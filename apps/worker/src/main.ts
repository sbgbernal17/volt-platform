import {
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
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { loadConfig } from './config.ts';
import { dailyAt, runConfigDriftCheck } from './jobs/config-drift.ts';
import { LogEventPublisher, RedisEventPublisher, relayOutbox } from './jobs/outbox-relay.ts';
import { ensureMonthlyPartitions } from './jobs/partitions.ts';
import { activateTariffs, enforceSessionLimits, settleSessions } from './jobs/pricing.ts';
import { closeOrphanTransactions, expireSessionStarts } from './jobs/sessions.ts';
import { type Job, Scheduler } from './scheduler.ts';

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL });

const sql = config.DATABASE_URL
  ? createSql(config.DATABASE_URL, { max: 3, applicationName: 'volt-worker' })
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
  const publisher = redis
    ? new RedisEventPublisher(redis, config.WORKER_EVENTS_CHANNEL)
    : new LogEventPublisher(logger);
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
    dailyAt('partitions', 1, () => ensureMonthlyPartitions(sql, { logger })),
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

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'apagando worker');
  await scheduler.stop();
  await sql?.end({ timeout: 5 });
  await redis?.quit().catch(() => undefined);
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
