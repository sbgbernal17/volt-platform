import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = buildApp({ config });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'apagando api');
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
} catch (error) {
  app.log.fatal(error, 'no se pudo iniciar la api');
  process.exit(1);
}
