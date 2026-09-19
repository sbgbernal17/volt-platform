import { pino } from 'pino';
import { type Job, Scheduler } from './scheduler.ts';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const jobs: Job[] = [
  {
    name: 'heartbeat',
    intervalMs: 60_000,
    run: async () => {
      logger.debug('worker vivo');
    },
  },
];

const scheduler = new Scheduler(jobs, logger);
scheduler.start();

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'apagando worker');
  await scheduler.stop();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
