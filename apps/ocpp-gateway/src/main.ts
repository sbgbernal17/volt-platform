import { createSql } from '@volt/db';
import { RedisConnectionDirectory } from '@volt/gateway-client';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { loadConfig } from './config.ts';
import { DbRegistry } from './db-registry.ts';
import { RedisEvictionListener } from './eviction.ts';
import { Gateway } from './gateway.ts';
import { DbPersistence, MemoryPersistence } from './persistence.ts';
import { registryFromJson } from './registry.ts';

const config = loadConfig();
const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
});

const sql = config.DATABASE_URL
  ? createSql(config.DATABASE_URL, { max: 5, applicationName: 'volt-ocpp-gateway' })
  : undefined;
const registry = sql ? new DbRegistry(sql, logger) : registryFromJson(config.OCPP_STATIC_REGISTRY);
const persistence = sql ? new DbPersistence(sql, logger) : new MemoryPersistence();
if (!sql) {
  logger.warn('sin DATABASE_URL: registro estático y sin persistencia (solo laboratorio)');
  if ('size' in registry && registry.size === 0) {
    logger.warn(
      'registro de cargadores vacío: ninguna conexión será aceptada (define OCPP_STATIC_REGISTRY)',
    );
  }
}
if (!config.OCPP_GATEWAY_INTERNAL_TOKEN) {
  logger.warn('sin OCPP_GATEWAY_INTERNAL_TOKEN: la API interna de comandos responde 503');
}

const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, { lazyConnect: true }) : undefined;
if (redis) await redis.connect();
const directory = redis ? new RedisConnectionDirectory(redis) : undefined;
const evictions = config.REDIS_URL ? new RedisEvictionListener(config.REDIS_URL) : undefined;

const gateway = new Gateway({
  config,
  registry,
  logger,
  persistence,
  ...(directory ? { directory } : {}),
  ...(evictions ? { evictions } : {}),
});
gateway.on('event', (envelope) => {
  logger.debug(
    { event: envelope.name, aggregate: envelope.aggregate, payload: envelope.payload },
    'evento',
  );
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'apagando gateway');
  await gateway.stop();
  await sql?.end({ timeout: 5 });
  await redis?.quit().catch(() => undefined);
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await gateway.start();
} catch (error) {
  logger.fatal({ err: error }, 'no se pudo iniciar el gateway');
  process.exit(1);
}
