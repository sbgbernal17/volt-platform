import { z } from 'zod';

/** El marcador `unset` (versión inicial de los secretos en Secret Manager) y el vacío equivalen a ausente. */
const optionalSecret = z.preprocess(
  (value) => (value === '' || value === 'unset' ? undefined : value),
  z.string().min(8).optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Ambiente desplegado. Las reglas "solo en producción" (identidad del personal, Wompi real, sin
   * token estático) aplican cuando es `prod`, o cuando no está definido y NODE_ENV es production.
   */
  VOLT_ENV: z.enum(['local', 'dev', 'staging', 'prod']).optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  API_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().optional(),
  /** CA del servidor de Cloud SQL (PEM) para TLS con verificación (iteración 8). */
  DATABASE_SSL_CA: z.string().optional(),
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
  APP_TERMS_URL: z.string().url().default('https://supercargadores.co/terminos-y-condiciones'),
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
  /** URL pública de esta API (enlaces del checkout emulado en dev); en local, http://localhost:<puerto>. */
  API_PUBLIC_URL: z.string().url().optional(),
  /**
   * Iteración 9: clave de navegador de Maps JavaScript API para el mapa de la app web (pública por
   * diseño: va restringida por referrer y solo a esa API; la crea Terraform por ambiente). Se
   * expone en `GET /v1/config`; sin ella la app muestra la lista en el navegador.
   */
  GOOGLE_MAPS_BROWSER_KEY: z.string().min(8).optional(),
  /** Map ID de Google Maps para la app web (estilos en la nube y marcadores avanzados); público. */
  GOOGLE_MAPS_MAP_ID: z.string().min(4).max(64).optional(),
  /**
   * SMS para verificar el celular del conductor (ADR 0031): `fake` (emulador: el código vuelve en la
   * respuesta y va al log; solo ambientes de prueba), `twilio`, `brevo` o `none` (sin verificación
   * disponible; si el parámetro la exige, la app no puede pagar ni cargar). En producción es
   * obligatorio un proveedor real.
   */
  SMS_PROVIDER: z.enum(['none', 'fake', 'twilio', 'brevo']).default('none'),
  /** Remitente: número E.164 o Messaging Service (MG…) en Twilio; nombre de hasta 11 caracteres o número en Brevo. */
  SMS_SENDER: z.string().min(1).max(40).optional(),
  TWILIO_ACCOUNT_SID: z.string().min(8).max(64).optional(),
  /** Token de autenticación de Twilio o clave de API de Brevo (secreto `sms-provider-api-key`). */
  SMS_PROVIDER_API_KEY: optionalSecret,
  /**
   * Correos de identidad con la marca (ADR 0032): `resend` o `brevo` (clave en `email-provider-api-key`)
   * envían el cuerpo propio con botón; `fake` (pruebas) los guarda en memoria; `none` deja que
   * Identity Platform envíe su correo genérico desde el SDK de la app.
   */
  EMAIL_PROVIDER: z.enum(['none', 'fake', 'resend', 'brevo']).default('none'),
  EMAIL_FROM: z.string().min(3).max(120).default('VOLT <notificaciones@supercargadores.co>'),
  EMAIL_PROVIDER_API_KEY: optionalSecret,
  /** URL pública de la app web (host del logotipo en los correos y `continueUrl` de los enlaces). */
  APP_WEB_URL: z.string().url().optional(),
  /**
   * De dónde salen los enlaces de Identity Platform: `metadata` (token de la cuenta de servicio del
   * contenedor en Cloud Run) o `fake` (local y pruebas). Por defecto, metadata en dev/staging/prod.
   */
  IDENTITY_LINKS_SOURCE: z.enum(['metadata', 'fake']).optional(),
});

export type ApiConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Configuración inválida: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  const isProd = result.data.VOLT_ENV
    ? result.data.VOLT_ENV === 'prod'
    : result.data.NODE_ENV === 'production';
  if (isProd && result.data.API_DEV_DRIVER_AUTH) {
    throw new Error('Configuración inválida: API_DEV_DRIVER_AUTH no puede activarse en producción');
  }
  if (isProd && result.data.API_ADMIN_TOKEN) {
    throw new Error(
      'Configuración inválida: API_ADMIN_TOKEN no puede usarse en producción (el personal entra con Identity Platform)',
    );
  }
  if (isProd && !result.data.IDENTITY_PLATFORM_PROJECT_ID) {
    throw new Error('Configuración inválida: en producción falta IDENTITY_PLATFORM_PROJECT_ID');
  }
  if (isProd && result.data.PAYMENTS_PROVIDER !== 'wompi') {
    throw new Error('Configuración inválida: en producción PAYMENTS_PROVIDER debe ser wompi');
  }
  if (isProd && result.data.WOMPI_ENVIRONMENT !== 'production') {
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
  if (isProd && (result.data.SMS_PROVIDER === 'fake' || result.data.SMS_PROVIDER === 'none')) {
    throw new Error('Configuración inválida: en producción SMS_PROVIDER debe ser twilio o brevo');
  }
  if (result.data.SMS_PROVIDER === 'twilio' || result.data.SMS_PROVIDER === 'brevo') {
    const required =
      result.data.SMS_PROVIDER === 'twilio'
        ? (['TWILIO_ACCOUNT_SID', 'SMS_SENDER', 'SMS_PROVIDER_API_KEY'] as const)
        : (['SMS_SENDER', 'SMS_PROVIDER_API_KEY'] as const);
    for (const key of required) {
      if (!result.data[key])
        throw new Error(
          `Configuración inválida: falta ${key} para SMS_PROVIDER=${result.data.SMS_PROVIDER}`,
        );
    }
  }
  if (isProd && result.data.EMAIL_PROVIDER === 'fake') {
    throw new Error('Configuración inválida: en producción EMAIL_PROVIDER no puede ser fake');
  }
  if (
    (result.data.EMAIL_PROVIDER === 'resend' || result.data.EMAIL_PROVIDER === 'brevo') &&
    !result.data.EMAIL_PROVIDER_API_KEY
  ) {
    throw new Error(
      `Configuración inválida: falta EMAIL_PROVIDER_API_KEY para EMAIL_PROVIDER=${result.data.EMAIL_PROVIDER}`,
    );
  }
  if (
    isProd &&
    result.data.EMAIL_PROVIDER !== 'none' &&
    result.data.IDENTITY_LINKS_SOURCE === 'fake'
  ) {
    throw new Error(
      'Configuración inválida: en producción IDENTITY_LINKS_SOURCE debe ser metadata',
    );
  }
  return result.data;
}
