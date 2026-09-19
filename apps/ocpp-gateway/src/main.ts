import { pino } from 'pino';
import { loadConfig } from './config.ts';
import { Gateway } from './gateway.ts';
import { registryFromJson } from './registry.ts';

const config = loadConfig();
const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
});

const registry = registryFromJson(config.OCPP_STATIC_REGISTRY);
if (registry.size === 0) {
  logger.warn(
    'registro de cargadores vacío: ninguna conexión será aceptada (define OCPP_STATIC_REGISTRY)',
  );
}

const gateway = new Gateway({ config, registry, logger });
gateway.on('event', (envelope) => {
  logger.debug(
    { event: envelope.name, aggregate: envelope.aggregate, payload: envelope.payload },
    'evento',
  );
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'apagando gateway');
  await gateway.stop();
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
