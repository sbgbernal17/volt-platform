import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  OCPP_GATEWAY_HOST: z.string().default('0.0.0.0'),
  OCPP_GATEWAY_PORT: z.coerce.number().int().min(0).max(65535).default(9220),
  OCPP_GATEWAY_HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(9221),
  /** Los cargadores se conectan a `<prefijo>/<chargeBoxId>`. */
  OCPP_GATEWAY_PATH_PREFIX: z
    .string()
    .regex(/^\/[A-Za-z0-9_-]+$/, 'debe ser una ruta simple como /ocpp')
    .default('/ocpp'),
  /** Ping WebSocket desde el servidor; debe ser menor que el timeout del balanceador. */
  OCPP_PING_INTERVAL_S: z.coerce.number().int().min(5).max(600).default(30),
  OCPP_CALL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(10_000),
  /** Intervalo devuelto en BootNotification.conf cuando el cargador es aceptado. */
  OCPP_HEARTBEAT_INTERVAL_S: z.coerce.number().int().min(10).max(86_400).default(300),
  /** Espera mínima devuelta cuando BootNotification responde Pending. */
  OCPP_PENDING_RETRY_S: z.coerce.number().int().min(5).max(3600).default(60),
  /** Segundos sin ningún mensaje tras los que un cargador conectado se considera offline. */
  OCPP_OFFLINE_AFTER_S: z.coerce.number().int().min(30).max(86_400).default(600),
  /** Cierre escalonado al apagar: conexiones cerradas por segundo. */
  OCPP_DRAIN_RATE_PER_S: z.coerce.number().int().min(1).max(1000).default(50),
  /**
   * Registro estático de cargadores para laboratorio (JSON):
   * [{"identity":"CP001","password":"secreto","lifecycle":"OPERATIONAL"}]
   * En producción el registro viene de la base de datos (iteración 2).
   */
  OCPP_STATIC_REGISTRY: z.string().optional(),
});

export type GatewayConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuración inválida: ${issues.join('; ')}`);
  }
  return result.data;
}
