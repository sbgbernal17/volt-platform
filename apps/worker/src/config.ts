import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  OCPP_GATEWAY_INTERNAL_TOKEN: z.string().min(16).optional(),
  OCPP_GATEWAY_INTERNAL_URL: z.string().url().optional(),
  /** Hora UTC de la revisión diaria de deriva (09:00 UTC = 04:00 en Bogotá, OPS §1.4). */
  WORKER_DRIFT_CHECK_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(9),
  /** Cargadores consultados por segundo durante la revisión de deriva. */
  WORKER_DRIFT_RATE_PER_S: z.coerce.number().int().min(1).max(200).default(20),
  WORKER_DRIFT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Relay del outbox (DAT §4.4): sondeo y tamaño de lote. */
  WORKER_OUTBOX_POLL_MS: z.coerce.number().int().min(50).max(60_000).default(200),
  WORKER_OUTBOX_BATCH: z.coerce.number().int().min(1).max(5000).default(500),
  /** Canal Redis al que se publican los eventos mientras no exista Pub/Sub (iteración 8). */
  WORKER_EVENTS_CHANNEL: z.string().min(1).default('domain-events'),
  /** Sesiones STARTING vencidas: sondeo. */
  WORKER_SESSION_TIMEOUT_POLL_MS: z.coerce.number().int().min(1000).max(600_000).default(10_000),
  /** Transacciones sin StopTransaction con el cargador desconectado (FUN M04 `orphan_timeout_h`). */
  WORKER_ORPHAN_TIMEOUT_H: z.coerce.number().min(0.01).max(720).default(12),
  WORKER_ORPHAN_POLL_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Configuración inválida: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return result.data;
}
