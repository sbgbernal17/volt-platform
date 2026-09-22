import { hostname } from 'node:os';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  OCPP_GATEWAY_HOST: z.string().default('0.0.0.0'),
  OCPP_GATEWAY_PORT: z.coerce.number().int().min(0).max(65535).default(9220),
  OCPP_GATEWAY_HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(9221),
  /** Puerto de la API interna (api/worker → gateway) para enviar CALL a un cargador (ADR 0013). */
  OCPP_GATEWAY_INTERNAL_PORT: z.coerce.number().int().min(0).max(65535).default(9222),
  /** Token compartido de la API interna; sin él la API interna responde 503. */
  OCPP_GATEWAY_INTERNAL_TOKEN: z.string().min(16).optional(),
  /** Identificador de este pod en el directorio de conexiones (por defecto el hostname). */
  OCPP_GATEWAY_POD_ID: z.string().min(1).default(hostname()),
  /** URL anunciada en el directorio para que api/worker alcancen a este pod. */
  OCPP_GATEWAY_INTERNAL_URL: z.string().url().optional(),
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
  /** CALL en cola por conexión antes de responder QUEUE_FULL (una sola en vuelo). */
  OCPP_CALL_QUEUE_MAX: z.coerce.number().int().min(1).max(1000).default(20),
  /** TTL y refresco de la entrada `cs:conn:{chargeBoxId}` en Redis (ARQ §4.4). */
  OCPP_CONN_TTL_MS: z.coerce.number().int().min(5000).max(600_000).default(90_000),
  OCPP_CONN_REFRESH_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  /** Mínimo entre escrituras de `last_seen_at` por cargador. */
  OCPP_SEEN_WRITE_INTERVAL_S: z.coerce.number().int().min(1).max(3600).default(10),
  /** Registro y estado en PostgreSQL; sin ella se usa el registro estático (laboratorio). */
  DATABASE_URL: z.string().url().optional(),
  /** Directorio de conexiones y evicción entre pods; sin ella el directorio es local. */
  REDIS_URL: z.string().url().optional(),
  /**
   * Registro estático de cargadores para laboratorio (JSON):
   * [{"identity":"CP001","password":"secreto","lifecycle":"OPERATIONAL"}]
   * Solo se usa cuando no hay DATABASE_URL.
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
