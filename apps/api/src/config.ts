import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  API_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  /**
   * Token de la API de administración (/admin/v1) hasta que llegue Identity Platform con RBAC
   * (iteración 6). Sin él, las rutas de administración no se registran.
   */
  API_ADMIN_TOKEN: z.string().min(16).optional(),
  /** Token compartido con la API interna del gateway (OCPP_GATEWAY_INTERNAL_TOKEN). */
  OCPP_GATEWAY_INTERNAL_TOKEN: z.string().min(16).optional(),
  /** URL del gateway cuando no hay directorio en Redis (un solo pod; laboratorio y pruebas). */
  OCPP_GATEWAY_INTERNAL_URL: z.string().url().optional(),
  /** Espera máxima a que un cargador reconecte tras Reset durante el comisionamiento. */
  COMMISSIONING_REBOOT_WAIT_MS: z.coerce.number().int().min(1000).max(600_000).default(30_000),
});

export type ApiConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Configuración inválida: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return result.data;
}
