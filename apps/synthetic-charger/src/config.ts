import { withFileSecrets } from '@volt/logging';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VOLT_ENV: z.enum(['local', 'dev', 'staging', 'prod']).optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  /** URL del gateway sin el identificador: `wss://ocpp-<env>.supercargadores.co/ocpp`. */
  SYNTHETIC_OCPP_URL: z.string().url(),
  SYNTHETIC_CHARGE_BOX_ID: z.string().min(3).max(48).default('VOLT-SYNTH'),
  /** Contraseña (AuthorizationKey) cuando no hay base de datos para darse de alta solo. */
  SYNTHETIC_PASSWORD: z.string().min(8).optional(),
  /** Con base de datos, el cargador se registra y emite su credencial al arrancar. */
  DATABASE_URL: z.string().url().optional(),
  DATABASE_SSL_CA: z.string().optional(),
  SYNTHETIC_SITE_CODE: z.string().min(2).max(16).default('SYNTH'),
  /** Endpoint de salud para Cloud Run; 0 lo desactiva. */
  SYNTHETIC_HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(0),
  /** Latido enviado al gateway (segundos) mientras está conectado. */
  SYNTHETIC_HEARTBEAT_S: z.coerce.number().int().min(10).max(3600).default(60),
  /** Cada cuántos minutos se registra un ciclo de disponibilidad (`synthetic.cycle`). */
  SYNTHETIC_CYCLE_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
  /** Sesión de prueba por la API de administración (opcional, solo dev y staging). */
  SYNTHETIC_API_URL: z.string().url().optional(),
  SYNTHETIC_ADMIN_TOKEN: z.string().min(16).optional(),
  /** Cada cuántos ciclos se ejecuta una sesión de prueba; 0 la desactiva. */
  SYNTHETIC_SESSION_EVERY_CYCLES: z.coerce.number().int().min(0).max(1000).default(0),
  SYNTHETIC_SESSION_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
});

export type SyntheticConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SyntheticConfig {
  const result = schema.safeParse(withFileSecrets(env));
  if (!result.success) {
    throw new Error(
      `Configuración inválida: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  if (!result.data.DATABASE_URL && !result.data.SYNTHETIC_PASSWORD) {
    throw new Error('Configuración inválida: hace falta DATABASE_URL o SYNTHETIC_PASSWORD');
  }
  return result.data;
}
