import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  API_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  /**
   * Token estático de la API de administración (/admin/v1) para laboratorio, pruebas y automatización:
   * entra como administrador con actor `staff:admin-token`. Nunca en producción (lo impide la
   * configuración); allí el personal entra con Identity Platform (iteración 6).
   */
  API_ADMIN_TOKEN: z.string().min(16).optional(),
  /**
   * Identity Platform del personal (SEG §3.1): proyecto (emisor y audiencia del ID token), clave web
   * pública y dominio de autenticación que usa el back-office. Obligatorio en producción.
   */
  IDENTITY_PLATFORM_PROJECT_ID: z.string().min(4).max(64).optional(),
  IDENTITY_PLATFORM_API_KEY: z.string().min(8).optional(),
  IDENTITY_PLATFORM_AUTH_DOMAIN: z.string().min(4).optional(),
  /** Solo pruebas: URL alternativa de las claves públicas (JWKS). */
  IDENTITY_PLATFORM_JWKS_URL: z.string().url().optional(),
  /**
   * Iteración 7: tenant de Identity Platform reservado a los conductores de la app (`firebase.tenant`
   * del ID token). Sin él, los conductores viven en el pool de usuarios del proyecto y el personal
   * comparte ese pool (los roles siguen viviendo en la base de datos).
   */
  IDENTITY_PLATFORM_DRIVER_TENANT_ID: z.string().min(4).max(64).optional(),
  /** Enlaces legales y soporte que muestra la app (GET /v1/config). */
  APP_TERMS_URL: z.string().url().default('https://supercargadores.co/legal/terminos'),
  APP_PRIVACY_URL: z.string().url().default('https://supercargadores.co/politica-de-datos'),
  APP_SUPPORT_EMAIL: z.string().email().optional(),
  /** Correo del primer administrador: se invita al arrancar si no hay personal registrado. */
  API_STAFF_BOOTSTRAP_EMAIL: z.string().email().optional(),
  /** Orígenes (esquema://host[:puerto]) del back-office y la app web autorizados por CORS, separados por coma. */
  API_CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim().replace(/\/$/, ''))
        .filter((origin) => origin.length > 0),
    ),
  /** Token compartido con la API interna del gateway (OCPP_GATEWAY_INTERNAL_TOKEN). */
  OCPP_GATEWAY_INTERNAL_TOKEN: z.string().min(16).optional(),
  /** URL del gateway cuando no hay directorio en Redis (un solo pod; laboratorio y pruebas). */
  OCPP_GATEWAY_INTERNAL_URL: z.string().url().optional(),
  /** Espera máxima a que un cargador reconecte tras Reset durante el comisionamiento. */
  COMMISSIONING_REBOOT_WAIT_MS: z.coerce.number().int().min(1000).max(600_000).default(30_000),
  /**
   * Identidad de conductor de desarrollo (`Authorization: Bearer dev:<driverId>`) hasta que llegue
   * Identity Platform (iteración 7). Nunca en producción.
   */
  API_DEV_DRIVER_AUTH: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Sondeo del outbox para el flujo SSE de una sesión y latido de la conexión. */
  API_SSE_POLL_MS: z.coerce.number().int().min(100).max(10_000).default(1000),
  API_SSE_HEARTBEAT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  /**
   * Pasarela de pago (iteración 5, ADR 0002): `wompi` con las llaves WOMPI_*, `fake` (emulador en
   * memoria, solo desarrollo y pruebas) o `none` (sin cobro, solo desarrollo). En producción es
   * obligatorio `wompi`.
   */
  PAYMENTS_PROVIDER: z.enum(['wompi', 'fake', 'none']).default('none'),
  WOMPI_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  WOMPI_PUBLIC_KEY: z.string().min(8).optional(),
  WOMPI_PRIVATE_KEY: z.string().min(8).optional(),
  WOMPI_INTEGRITY_SECRET: z.string().min(8).optional(),
  WOMPI_EVENTS_SECRET: z.string().min(8).optional(),
  /** URL a la que Wompi devuelve al conductor tras pagar un enlace de deuda (app web, iteración 7). */
  PAYMENTS_REDIRECT_URL: z.string().url().optional(),
});

export type ApiConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Configuración inválida: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  if (result.data.NODE_ENV === 'production' && result.data.API_DEV_DRIVER_AUTH) {
    throw new Error('Configuración inválida: API_DEV_DRIVER_AUTH no puede activarse en producción');
  }
  if (result.data.NODE_ENV === 'production' && result.data.API_ADMIN_TOKEN) {
    throw new Error(
      'Configuración inválida: API_ADMIN_TOKEN no puede usarse en producción (el personal entra con Identity Platform)',
    );
  }
  if (result.data.NODE_ENV === 'production' && !result.data.IDENTITY_PLATFORM_PROJECT_ID) {
    throw new Error('Configuración inválida: en producción falta IDENTITY_PLATFORM_PROJECT_ID');
  }
  if (result.data.NODE_ENV === 'production' && result.data.PAYMENTS_PROVIDER !== 'wompi') {
    throw new Error('Configuración inválida: en producción PAYMENTS_PROVIDER debe ser wompi');
  }
  if (result.data.NODE_ENV === 'production' && result.data.WOMPI_ENVIRONMENT !== 'production') {
    throw new Error('Configuración inválida: en producción WOMPI_ENVIRONMENT debe ser production');
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
