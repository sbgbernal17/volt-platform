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
  /** Hora UTC de la verificación diaria de la cadena de auditoría (SEG §2.8). */
  WORKER_AUDIT_CHECK_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(7),
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
  /** Liquidación de sesiones terminadas (TAR §3.5): sondeo. */
  WORKER_PRICING_POLL_MS: z.coerce.number().int().min(500).max(600_000).default(5_000),
  /** Límites que detienen sesiones (tope de exposición, duración máxima): sondeo. */
  WORKER_LIMITS_POLL_MS: z.coerce.number().int().min(500).max(600_000).default(3_000),
  /** Activación de versiones de tarifa programadas: sondeo. */
  WORKER_TARIFF_POLL_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
  /** Cobros (iteración 5): pasarela, sondeo de cobros y reintentos, hora UTC de la conciliación diaria. */
  PAYMENTS_PROVIDER: z.enum(['wompi', 'fake', 'none']).default('none'),
  WOMPI_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  WOMPI_PUBLIC_KEY: z.string().min(8).optional(),
  WOMPI_PRIVATE_KEY: z.string().min(8).optional(),
  WOMPI_INTEGRITY_SECRET: z.string().min(8).optional(),
  WOMPI_EVENTS_SECRET: z.string().min(8).optional(),
  WORKER_BILLING_POLL_MS: z.coerce.number().int().min(1000).max(600_000).default(10_000),
  WORKER_RECONCILIATION_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(8),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Configuración inválida: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  if (result.data.NODE_ENV === 'production' && result.data.PAYMENTS_PROVIDER !== 'wompi') {
    throw new Error('Configuración inválida: en producción PAYMENTS_PROVIDER debe ser wompi');
  }
  if (result.data.PAYMENTS_PROVIDER === 'wompi') {
    for (const key of [
      'WOMPI_PUBLIC_KEY',
      'WOMPI_PRIVATE_KEY',
      'WOMPI_INTEGRITY_SECRET',
      'WOMPI_EVENTS_SECRET',
    ] as const) {
      if (!result.data[key])
        throw new Error(`Configuración inválida: falta ${key} para PAYMENTS_PROVIDER=wompi`);
    }
  }
  return result.data;
}
