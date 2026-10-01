/**
 * Cuenta del conductor en la app Volt (iteración 7, ADR 0022): configuración pública de la app,
 * perfil, consentimientos (términos y autorización de datos, Ley 1581), dispositivos para
 * notificaciones push, bandeja de avisos y borrado de la cuenta.
 */
import {
  anonymizeDriver,
  CsmsError,
  countUnreadNotifications,
  currentConsentVersion,
  DEVICE_PLATFORMS,
  DRIVER_CONSENT_KEYS,
  DRIVER_DOCUMENT_TYPES,
  DRIVER_LOCALES,
  type DriverNotificationRow,
  type DriverRow,
  driverConsents,
  getDriver,
  listDriverNotifications,
  markNotificationsRead,
  type PhoneVerificationService,
  pendingConsents,
  recordDriverConsents,
  registerDriverDevice,
  resolveParam,
  unregisterDriverDevice,
  updateDriverProfile,
} from '@volt/csms';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { driverOf } from './auth.ts';

/** Configuración pública que la app necesita antes de iniciar sesión (nunca secretos). */
export interface AppConfigStatic {
  auth: {
    provider: 'identity-platform' | 'dev' | 'none';
    projectId: string | null;
    apiKey: string | null;
    authDomain: string | null;
    /** Tenant de Identity Platform para conductores (opcional). */
    tenantId: string | null;
    /** Identidad de desarrollo (`dev:<driverId>`) activa (nunca en producción). */
    devLogin: boolean;
  };
  payments: {
    provider: 'wompi' | 'fake' | 'none';
    environment: 'sandbox' | 'production' | 'fake' | 'none';
    /** Llave pública de Wompi (pública por diseño: la usa el widget) para tokenizar en la app. */
    publicKey: string | null;
    apiBaseUrl: string | null;
  };
  legal: { termsUrl: string; privacyUrl: string; supportEmail: string | null };
  /** Clave de navegador de Google Maps para la versión web (null: la web muestra solo la lista) y Map ID (9c). */
  maps: { browserKey: string | null; mapId: string | null };
  /**
   * Verificación del celular por SMS (ADR 0031): `fake` devuelve el código en la respuesta (solo
   * pruebas), `live` lo envía de verdad, `none` no está disponible. `required` se añade en la ruta.
   */
  phone: { provider: 'none' | 'fake' | 'live' };
  /** Correos de identidad con la marca (ADR 0032): `custom` = la app pide el envío a la API. */
  email: { custom: boolean };
}

const profilePatch = z.object({
  displayName: z.string().trim().min(1).max(80).nullable().optional(),
  firstName: z.string().trim().min(1).max(60).nullable().optional(),
  lastName: z.string().trim().min(1).max(60).nullable().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{7,20}$/)
    .nullable()
    .optional(),
  locale: z.enum(DRIVER_LOCALES).optional(),
  // Documento de identidad y factura electrónica (ADR 0027); la regla condicional vive en el CSMS.
  documentType: z.enum(DRIVER_DOCUMENT_TYPES).nullable().optional(),
  documentNumber: z.string().trim().min(3).max(24).nullable().optional(),
  wantsInvoice: z.boolean().optional(),
});
const consentBody = z.object({
  accept: z.array(z.enum(DRIVER_CONSENT_KEYS)).max(3).default([]),
  revoke: z.array(z.enum(DRIVER_CONSENT_KEYS)).max(3).default([]),
  locale: z.enum(DRIVER_LOCALES).default('es'),
});
const deviceBody = z.object({
  pushToken: z.string().min(8).max(200),
  platform: z.enum(DEVICE_PLATFORMS),
  locale: z.enum(DRIVER_LOCALES).optional(),
  appVersion: z.string().max(40).optional(),
  deviceName: z.string().max(80).optional(),
});
const unregisterBody = z.object({ pushToken: z.string().min(8).max(200) });
const readBody = z.object({ ids: z.array(z.string().uuid()).max(200).optional() });
const deleteBody = z.object({ confirm: z.literal(true) });

export function toPublicProfile(driver: DriverRow, consentVersion: string) {
  return {
    id: driver.id,
    email: driver.email,
    emailVerified: driver.email_verified,
    displayName: driver.display_name,
    firstName: driver.first_name,
    lastName: driver.last_name,
    phone: driver.phone,
    phoneVerified: driver.phone_verified_at !== null,
    phoneVerifiedAt: driver.phone_verified_at?.toISOString() ?? null,
    locale: driver.locale,
    status: driver.status,
    billingStatus: driver.billing_status,
    blockedReason: driver.blocked_reason,
    segment: driver.segment,
    consents: driverConsents(driver),
    pendingConsents: pendingConsents(driver, consentVersion),
    consentVersion,
    defaultPaymentMethodId: driver.default_payment_method_id,
    documentType: driver.document_type,
    documentNumber: driver.document_number,
    wantsInvoice: driver.wants_invoice,
    createdAt: driver.created_at.toISOString(),
    lastLoginAt: driver.last_login_at?.toISOString() ?? null,
  };
}

export function toPublicNotification(row: DriverNotificationRow) {
  return {
    id: row.id,
    kind: row.kind,
    sessionId: row.session_id,
    locale: row.locale,
    title: row.title,
    body: row.body,
    data: row.data,
    status: row.status,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/** `GET /v1/config`: público, sin autenticación. */
export async function appConfigRoute(
  app: FastifyInstance,
  options: { sql: Sql; tenantId: string; appConfig: AppConfigStatic; version: string },
): Promise<void> {
  app.get('/config', async () => ({
    version: options.version,
    ...options.appConfig,
    phone: {
      ...options.appConfig.phone,
      required: await resolveParam<boolean>(options.sql, 'auth.driver_require_verified_phone', {
        tenantId: options.tenantId,
      }),
    },
    consentVersion: await currentConsentVersion(options.sql, options.tenantId),
  }));
}

/** Rutas privadas de la cuenta (dentro del ámbito autenticado de /v1). */
const phoneSendBody = z.object({
  phone: z.string().trim().min(7).max(24),
  locale: z.enum(DRIVER_LOCALES).optional(),
});
const phoneVerifyBody = z.object({ code: z.string().trim().min(4).max(12) });

export async function meRoutes(
  app: FastifyInstance,
  options: { sql: Sql; tenantId: string; phoneVerification?: PhoneVerificationService | undefined },
): Promise<void> {
  const { sql, tenantId } = options;
  const profile = async (driverId: string) =>
    toPublicProfile(await getDriver(sql, driverId), await currentConsentVersion(sql, tenantId));
  const requirePhoneVerification = (): PhoneVerificationService => {
    if (!options.phoneVerification) {
      throw new CsmsError(
        'La verificación por SMS no está disponible en este ambiente',
        503,
        'SMS_UNAVAILABLE',
      );
    }
    return options.phoneVerification;
  };

  app.get('/me', async (request) => profile(driverOf(request).driverId));

  app.patch('/me', async (request) => {
    const driver = driverOf(request);
    const body = profilePatch.parse(request.body ?? {});
    await updateDriverProfile(sql, driver.driverId, body);
    return profile(driver.driverId);
  });

  // Celular verificado por SMS (ADR 0031): envío del código y confirmación.
  app.post('/me/phone/send-code', async (request, reply) => {
    const driver = driverOf(request);
    const body = phoneSendBody.parse(request.body ?? {});
    const service = requirePhoneVerification();
    const current = await getDriver(sql, driver.driverId);
    const sent = await service.sendCode(
      driver.driverId,
      body.phone,
      body.locale ?? (current.locale === 'en' ? 'en' : 'es'),
    );
    reply.code(202);
    return {
      phone: sent.phone,
      expiresAt: sent.expiresAt.toISOString(),
      resendAfterS: sent.resendAfterS,
      devCode: sent.devCode,
    };
  });

  app.post('/me/phone/verify', async (request) => {
    const driver = driverOf(request);
    const body = phoneVerifyBody.parse(request.body ?? {});
    await requirePhoneVerification().verifyCode(driver.driverId, body.code);
    return profile(driver.driverId);
  });

  app.post('/me/consents', async (request) => {
    const driver = driverOf(request);
    const body = consentBody.parse(request.body ?? {});
    const version = await currentConsentVersion(sql, tenantId);
    await recordDriverConsents(sql, driver.driverId, {
      accept: body.accept,
      revoke: body.revoke,
      version,
      locale: body.locale,
    });
    return profile(driver.driverId);
  });

  app.put('/me/devices', async (request) => {
    const driver = driverOf(request);
    const body = deviceBody.parse(request.body);
    const row = await registerDriverDevice(sql, {
      tenantId,
      driverId: driver.driverId,
      pushToken: body.pushToken,
      platform: body.platform,
      locale: body.locale,
      appVersion: body.appVersion,
      deviceName: body.deviceName,
    });
    return {
      id: row.id,
      platform: row.platform,
      locale: row.locale,
      status: row.status,
      registeredAt: row.last_seen_at.toISOString(),
    };
  });

  app.post('/me/devices/unregister', async (request) => {
    const driver = driverOf(request);
    const body = unregisterBody.parse(request.body);
    return { removed: await unregisterDriverDevice(sql, driver.driverId, body.pushToken) };
  });

  app.get('/me/notifications', async (request) => {
    const driver = driverOf(request);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).optional() })
      .parse(request.query ?? {});
    const [items, unread] = await Promise.all([
      listDriverNotifications(sql, driver.driverId, { limit: query.limit }),
      countUnreadNotifications(sql, driver.driverId),
    ]);
    return { items: items.map(toPublicNotification), unread };
  });

  app.post('/me/notifications/read', async (request) => {
    const driver = driverOf(request);
    const body = readBody.parse(request.body ?? {});
    return { updated: await markNotificationsRead(sql, driver.driverId, body.ids) };
  });

  app.post('/me/delete', async (request) => {
    const driver = driverOf(request);
    deleteBody.parse(request.body ?? {});
    const row = await anonymizeDriver(sql, driver.driverId, { actor: `driver:${driver.driverId}` });
    return { deleted: true, id: row.id, anonymizedAt: row.anonymized_at?.toISOString() ?? null };
  });
}
