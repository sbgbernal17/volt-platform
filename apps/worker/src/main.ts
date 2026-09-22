import { CommandService, CommissioningService } from '@volt/csms';
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

const directory = redis
  ? new RedisConnectionDirectory(redis)
  : config.OCPP_GATEWAY_INTERNAL_URL
    ? new StaticConnectionDirectory(config.OCPP_GATEWAY_INTERNAL_URL)
    : undefined;
if (sql && directory && config.OCPP_GATEWAY_INTERNAL_TOKEN && config.WORKER_DRIFT_ENABLED) {
  const gateway = new GatewayClient({ directory, token: config.OCPP_GATEWAY_INTERNAL_TOKEN });
  const commissioning = new CommissioningService(
    sql,
    new CommandService(sql, gateway, { logger }),
    { logger },
  );
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
} else {
  logger.warn(
    'revisión de deriva deshabilitada: faltan DATABASE_URL, OCPP_GATEWAY_INTERNAL_TOKEN o el directorio del gateway',
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
