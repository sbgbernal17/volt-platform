/**
 * Iteración 7: identidad del conductor con Identity Platform (tokens firmados con una clave local y
 * JWKS servido por un servidor http local): alta automática en el primer inicio de sesión, tenant de
 * conductores, correo verificado y consentimientos obligatorios antes de pagar o cargar, vinculación
 * de una cuenta creada por el personal, perfil, dispositivos push, bandeja de avisos y borrado de la
 * cuenta (anonimización). Convive con la identidad de desarrollo.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type EmailMessage,
  type EmailReceipt,
  type EmailSender,
  FakeEmailSender,
} from '@volt/csms';
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { FakeIdentityLinks } from './notifications/identity-links.ts';

const baseUrl = process.env.DATABASE_URL;
const ADMIN_TOKEN = 'token-admin-de-pruebas-0123456789';
const PROJECT = 'volt-test-project';
const DRIVER_TENANT = 'volt-conductores';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;

function b64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signToken(claims: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString(
    'base64url',
  );
  return `${header}.${body}.${signature}`;
}

interface TokenOptions {
  verified?: boolean;
  tenant?: string | null;
  name?: string;
}

function tokenFor(email: string, sub: string, options: TokenOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const tenant = options.tenant === undefined ? DRIVER_TENANT : options.tenant;
  return signToken({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub,
    iat: now - 5,
    exp: now + 3600,
    auth_time: now - 5,
    email,
    email_verified: options.verified ?? true,
    ...(options.name ? { name: options.name } : {}),
    firebase: { sign_in_provider: 'password', ...(tenant ? { tenant } : {}) },
  });
}

type Json = Record<string, unknown>;

describe.skipIf(!baseUrl)('identidad del conductor por la API', () => {
  let database: TemporaryDatabase;
  let sql: Sql;
  let jwks: Server;
  let app: FastifyInstance;
  /** Emulador de correo que se puede "caer" para probar el respaldo de Identity Platform. */
  const emailSender = new (class implements EmailSender {
    readonly provider = 'fake';
    readonly inner = new FakeEmailSender();
    failing = false;
    get sent() {
      return this.inner.sent;
    }
    async send(message: EmailMessage): Promise<EmailReceipt> {
      if (this.failing) throw new Error('proveedor de correo caído (prueba)');
      return this.inner.send(message);
    }
  })();
  const identityLinks = new FakeIdentityLinks('https://app-test.supercargadores.co');

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    token: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const options: InjectOptions = {
      method,
      url,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    };
    if (body !== undefined) options.payload = body as NonNullable<InjectOptions['payload']>;
    return app.inject(options);
  };
  const json = <T = Json>(response: { json: () => unknown }): T => response.json() as T;
  const errorCode = (response: { json: () => unknown }): string =>
    json<{ error: { code: string } }>(response).error.code;

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    sql = createSql(database.url, { max: 2 });
    jwks = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.setHeader('cache-control', 'public, max-age=3600');
      response.end(JSON.stringify({ keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] }));
    });
    await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));
    const jwksUrl = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/jwks`;
    app = buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: database.url,
        API_ADMIN_TOKEN: ADMIN_TOKEN,
        API_DEV_DRIVER_AUTH: 'true',
        IDENTITY_PLATFORM_PROJECT_ID: PROJECT,
        IDENTITY_PLATFORM_JWKS_URL: jwksUrl,
        IDENTITY_PLATFORM_API_KEY: 'AIzaClavePublicaDePrueba',
        IDENTITY_PLATFORM_DRIVER_TENANT_ID: DRIVER_TENANT,
        PAYMENTS_PROVIDER: 'fake',
        SMS_PROVIDER: 'fake',
        APP_SUPPORT_EMAIL: 'soporte@supercargadores.co',
        APP_WEB_URL: 'https://app-test.supercargadores.co',
      }),
      emailSender,
      identityLinks,
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await sql.end();
    await new Promise<void>((resolve) => jwks.close(() => resolve()));
    await database.drop();
  });

  it('publica la configuración de la app sin secretos', async () => {
    const response = await call('GET', '/v1/config', null);
    expect(response.statusCode).toBe(200);
    expect(json(response)).toMatchObject({
      version: expect.any(String),
      auth: {
        provider: 'identity-platform',
        projectId: PROJECT,
        apiKey: 'AIzaClavePublicaDePrueba',
        authDomain: `${PROJECT}.firebaseapp.com`,
        tenantId: DRIVER_TENANT,
        devLogin: true,
      },
      payments: { provider: 'fake', environment: 'fake', publicKey: null, apiBaseUrl: null },
      legal: {
        termsUrl: 'https://supercargadores.co/terminos-y-condiciones',
        privacyUrl: 'https://supercargadores.co/politica-de-datos',
        supportEmail: 'soporte@supercargadores.co',
      },
      maps: { browserKey: null, mapId: null },
      phone: { provider: 'fake', required: true },
      email: { custom: true },
      consentVersion: '2026-09',
    });
    expect(JSON.stringify(json(response))).not.toMatch(/prv_|secret/i);
  });

  it('rechaza tokens de otro tenant, vencidos o mal formados', async () => {
    const other = await call('GET', '/v1/me', tokenFor('x@example.com', 'sub-x', { tenant: null }));
    expect(other.statusCode).toBe(401);
    expect(errorCode(other)).toBe('WRONG_TENANT');
    const staffTenant = await call(
      'GET',
      '/v1/me',
      tokenFor('x@example.com', 'sub-x', { tenant: 'otro-tenant' }),
    );
    expect(errorCode(staffTenant)).toBe('WRONG_TENANT');
    expect((await call('GET', '/v1/me', 'no-es-un-jwt')).statusCode).toBe(401);
    expect((await call('GET', '/v1/me', null)).statusCode).toBe(401);
    // Ningún conductor quedó creado por esos intentos.
    expect(await sql`SELECT count(*)::int AS n FROM auth.driver`).toEqual([{ n: 0 }]);
  });

  it('crea la cuenta en el primer inicio de sesión y exige correo verificado y consentimientos', async () => {
    const unverified = tokenFor('ana@example.com', 'sub-ana', { verified: false, name: 'Ana P' });
    const first = await call('GET', '/v1/me', unverified);
    expect(first.statusCode).toBe(200);
    const me = json(first);
    expect(me).toMatchObject({
      email: 'ana@example.com',
      emailVerified: false,
      displayName: 'Ana P',
      locale: 'es',
      status: 'ACTIVE',
      pendingConsents: ['terms', 'data_processing'],
      consentVersion: '2026-09',
    });
    const anaId = me.id as string;
    // Sin correo verificado: ni medio de pago ni carga.
    const method = await call('POST', '/v1/payment-methods', unverified, {
      token: 'tok_fake_x',
      acceptanceToken: 'fake-acceptance-token',
      personalDataAuthToken: 'fake-personal-data-token',
    });
    expect(method.statusCode).toBe(403);
    expect(errorCode(method)).toBe('EMAIL_NOT_VERIFIED');
    const start = await call('POST', '/v1/sessions', unverified, { evseId: 'X-1' });
    expect(errorCode(start)).toBe('EMAIL_NOT_VERIFIED');

    // Con el correo verificado (nuevo token del mismo sujeto) faltan los consentimientos.
    const verified = tokenFor('ana@example.com', 'sub-ana', { name: 'Ana P' });
    expect(json(await call('GET', '/v1/me', verified))).toMatchObject({
      id: anaId,
      emailVerified: true,
    });
    const consentMissing = await call('POST', '/v1/sessions', verified, { evseId: 'X-1' });
    expect(consentMissing.statusCode).toBe(403);
    expect(json(consentMissing)).toMatchObject({
      error: { code: 'CONSENT_REQUIRED', details: { pending: ['terms', 'data_processing'] } },
    });
    // Solo términos: sigue faltando la autorización de datos.
    const partial = await call('POST', '/v1/me/consents', verified, { accept: ['terms'] });
    expect(json(partial).pendingConsents).toEqual(['data_processing']);
    const accepted = await call('POST', '/v1/me/consents', verified, {
      accept: ['data_processing', 'marketing'],
      locale: 'es',
    });
    expect(json(accepted).pendingConsents).toEqual([]);
    expect(json(accepted).consents).toMatchObject({
      terms: { version: '2026-09' },
      data_processing: { version: '2026-09' },
      marketing: { version: '2026-09' },
    });
    // Mercadeo se puede retirar; los obligatorios no.
    expect(
      json(await call('POST', '/v1/me/consents', verified, { revoke: ['marketing'] })).consents,
    ).toMatchObject({ marketing: null });
    expect(
      (await call('POST', '/v1/me/consents', verified, { revoke: ['terms'] })).statusCode,
    ).toBe(400);
    // Falta el celular verificado por SMS (ADR 0031).
    const phoneMissing = await call('POST', '/v1/sessions', verified, { evseId: 'X-1' });
    expect(phoneMissing.statusCode).toBe(403);
    expect(errorCode(phoneMissing)).toBe('PHONE_NOT_VERIFIED');
    expect(
      errorCode(await call('POST', '/v1/me/phone/send-code', verified, { phone: '6041234567' })),
    ).toBe('PHONE_INVALID');
    const sent = await call('POST', '/v1/me/phone/send-code', verified, {
      phone: '300 123 4567',
      locale: 'es',
    });
    expect(sent.statusCode).toBe(202);
    const code = json<{ phone: string; devCode: string | null; resendAfterS: number }>(sent);
    expect(code).toMatchObject({ phone: '+573001234567', resendAfterS: 60 });
    expect(code.devCode).toMatch(/^\d{6}$/);
    expect(
      errorCode(await call('POST', '/v1/me/phone/send-code', verified, { phone: '3001234567' })),
    ).toBe('SMS_TOO_SOON');
    const wrong = await call('POST', '/v1/me/phone/verify', verified, { code: '000000' });
    expect(wrong.statusCode).toBe(400);
    expect(json(wrong)).toMatchObject({
      error: { code: 'CODE_INVALID', details: { attemptsLeft: 4 } },
    });
    const verifiedPhone = await call('POST', '/v1/me/phone/verify', verified, {
      code: code.devCode,
    });
    expect(verifiedPhone.statusCode).toBe(200);
    expect(json(verifiedPhone)).toMatchObject({ phone: '+573001234567', phoneVerified: true });
    // Ya está lista: la carga pasa la comprobación y llega hasta el gateway (no configurado aquí).
    const ready = await call('POST', '/v1/sessions', verified, { evseId: 'X-1' });
    expect(ready.statusCode).toBe(503);
    expect(errorCode(ready)).toBe('GATEWAY_UNAVAILABLE');
    // Perfil: cambiar el celular a mano lo deja sin verificar (se normaliza a E.164).
    const patched = await call('PATCH', '/v1/me', verified, {
      displayName: 'Ana Pérez',
      phone: '+57 301 123 4567',
      locale: 'en',
    });
    expect(json(patched)).toMatchObject({
      displayName: 'Ana Pérez',
      phone: '+573011234567',
      phoneVerified: false,
      locale: 'en',
    });
    expect(errorCode(await call('POST', '/v1/sessions', verified, { evseId: 'X-1' }))).toBe(
      'PHONE_NOT_VERIFIED',
    );
    expect((await call('PATCH', '/v1/me', verified, { locale: 'fr' })).statusCode).toBe(400);
    // Documento de identidad y factura electrónica (ADR 0027).
    expect(errorCode(await call('PATCH', '/v1/me', verified, { wantsInvoice: true }))).toBe(
      'INVOICE_DOCUMENT_REQUIRED',
    );
    expect(
      json(
        await call('PATCH', '/v1/me', verified, {
          documentType: 'CC',
          documentNumber: '1.020.304.050',
          wantsInvoice: true,
        }),
      ),
    ).toMatchObject({ documentType: 'CC', documentNumber: '1020304050', wantsInvoice: true });
    expect(
      errorCode(
        await call('PATCH', '/v1/me', verified, { documentType: null, documentNumber: null }),
      ),
    ).toBe('INVOICE_DOCUMENT_REQUIRED');
    expect(
      errorCode(
        await call('PATCH', '/v1/me', verified, {
          documentType: 'NIT',
          documentNumber: '800197268-1',
        }),
      ),
    ).toBe('DOCUMENT_INVALID');
    expect(
      (await call('PATCH', '/v1/me', verified, { documentType: 'XX', documentNumber: '123456' }))
        .statusCode,
    ).toBe(400);
    expect(
      json(
        await call('PATCH', '/v1/me', verified, {
          wantsInvoice: false,
          documentType: null,
          documentNumber: null,
        }),
      ),
    ).toMatchObject({ documentType: null, documentNumber: null, wantsInvoice: false });
  });

  it('varias peticiones simultáneas del primer inicio de sesión crean una sola cuenta', async () => {
    // La app pide perfil, cobros y avisos a la vez al entrar: antes la segunda petición chocaba con la
    // restricción única de idp_subject y respondía 500.
    const token = tokenFor('carrera@example.com', 'sub-carrera', { name: 'Carrera' });
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => call('GET', '/v1/me', token)),
    );
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
    const ids = new Set(responses.map((r) => json<{ id: string }>(r).id));
    expect(ids.size).toBe(1);
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM auth.driver WHERE idp_subject = 'sub-carrera'`;
    expect(rows[0]?.n).toBe(1);
  });

  it('envía los correos de identidad con la marca y sin revelar si la cuenta existe', async () => {
    // Verificación: enlace generado por la API y cuerpo HTML propio con botón (ADR 0032).
    const token = tokenFor('correo@example.com', 'sub-correo', { verified: false });
    expect((await call('GET', '/v1/me', token)).statusCode).toBe(200);
    const sent = await call('POST', '/v1/auth/send-verification', token, {});
    expect(sent.statusCode).toBe(202);
    expect(json(sent)).toEqual({ sent: true });
    const last = emailSender.sent.at(-1);
    expect(last?.to).toBe('correo@example.com');
    expect(last?.subject).toBe('Confirme su correo en VOLT');
    expect(last?.html).toContain('>Confirmar correo<');
    expect(last?.html).toContain(
      'https://app-test.supercargadores.co/auth/action?mode=verifyEmail&amp;oobCode=fake-',
    );
    expect(last?.html).toContain('https://app-test.supercargadores.co/brand/volt-logo-blanco.png');
    expect(identityLinks.generated.at(-1)).toMatchObject({
      kind: 'VERIFY_EMAIL',
      email: 'correo@example.com',
    });
    // Reenvío inmediato: límite.
    const again = await call('POST', '/v1/auth/send-verification', token, {});
    expect(again.statusCode).toBe(429);
    expect(errorCode(again)).toBe('EMAIL_TOO_SOON');
    // Ya verificado: no se envía nada.
    const verifiedToken = tokenFor('correo@example.com', 'sub-correo');
    expect((await call('GET', '/v1/me', verifiedToken)).statusCode).toBe(200);
    expect(json(await call('POST', '/v1/auth/send-verification', verifiedToken, {}))).toEqual({
      sent: false,
      alreadyVerified: true,
    });
    // Contraseña nueva: ruta pública, misma respuesta exista o no la cuenta.
    const before = emailSender.sent.length;
    const reset = await call('POST', '/v1/auth/password-reset', null, {
      email: 'Correo@example.com',
    });
    expect(reset.statusCode).toBe(202);
    expect(emailSender.sent.at(-1)).toMatchObject({
      to: 'correo@example.com',
      subject: 'Cree una contraseña nueva en VOLT',
    });
    expect(emailSender.sent.at(-1)?.html).toContain('mode=resetPassword');
    expect(
      (await call('POST', '/v1/auth/password-reset', null, { email: 'nadie@example.com' }))
        .statusCode,
    ).toBe(202);
    expect(emailSender.sent.length).toBe(before + 2);
    expect(
      errorCode(
        await call('POST', '/v1/auth/password-reset', null, { email: 'nadie@example.com' }),
      ),
    ).toBe('EMAIL_TOO_SOON');
    expect(
      (await call('POST', '/v1/auth/password-reset', null, { email: 'no-es-correo' })).statusCode,
    ).toBe(400);
  });

  it('si el proveedor de correo falla, Identity Platform envía el correo de respaldo', async () => {
    const token = tokenFor('respaldo@example.com', 'sub-respaldo', { verified: false });
    expect((await call('GET', '/v1/me', token)).statusCode).toBe(200);
    emailSender.failing = true;
    try {
      const sent = await call('POST', '/v1/auth/send-verification', token, {});
      expect(sent.statusCode).toBe(202);
      expect(json(sent)).toEqual({ sent: true, fallback: 'identity-platform' });
      expect(identityLinks.sentByProvider.at(-1)).toEqual({
        kind: 'VERIFY_EMAIL',
        email: 'respaldo@example.com',
        withIdToken: true,
      });
      const reset = await call('POST', '/v1/auth/password-reset', null, {
        email: 'respaldo@example.com',
      });
      expect(reset.statusCode).toBe(202);
      expect(identityLinks.sentByProvider.at(-1)).toEqual({
        kind: 'PASSWORD_RESET',
        email: 'respaldo@example.com',
        withIdToken: false,
      });
    } finally {
      emailSender.failing = false;
    }
  });

  it('vincula una cuenta creada por el personal solo con el correo verificado', async () => {
    const created = await call(
      'POST',
      '/admin/v1/drivers',
      ADMIN_TOKEN,
      { email: 'pre@example.com', displayName: 'Pre Registrado' },
      { 'x-actor': 'staff:ana' },
    );
    expect(created.statusCode).toBe(201);
    const preId = json(created).id as string;
    const unverified = await call(
      'GET',
      '/v1/me',
      tokenFor('pre@example.com', 'sub-pre', { verified: false }),
    );
    expect(unverified.statusCode).toBe(403);
    expect(errorCode(unverified)).toBe('EMAIL_NOT_VERIFIED');
    const bound = await call('GET', '/v1/me', tokenFor('pre@example.com', 'sub-pre'));
    expect(bound.statusCode).toBe(200);
    expect(json(bound)).toMatchObject({
      id: preId,
      displayName: 'Pre Registrado',
      emailVerified: true,
    });
    // Otro sujeto con el mismo correo no puede entrar en esa cuenta.
    const clash = await call('GET', '/v1/me', tokenFor('pre@example.com', 'sub-otro'));
    expect(clash.statusCode).toBe(409);
    expect(errorCode(clash)).toBe('EMAIL_IN_USE');
    // La identidad de desarrollo sigue funcionando en paralelo.
    expect((await call('GET', '/v1/me', `dev:${preId}`)).statusCode).toBe(200);
  });

  it('registra dispositivos push, los reasigna por token y los da de baja', async () => {
    const ana = tokenFor('ana@example.com', 'sub-ana');
    const luis = tokenFor('luis@example.com', 'sub-luis');
    const token = 'ExponentPushToken[abcdefghijklmnopqrstuv]';
    const registered = await call('PUT', '/v1/me/devices', ana, {
      pushToken: token,
      platform: 'android',
      locale: 'en',
      appVersion: '1.0.0',
      deviceName: 'Pixel',
    });
    expect(registered.statusCode).toBe(200);
    expect(json(registered)).toMatchObject({ platform: 'android', locale: 'en', status: 'ACTIVE' });
    const again = await call('PUT', '/v1/me/devices', ana, {
      pushToken: token,
      platform: 'android',
    });
    expect(json(again).id).toBe(json(registered).id);
    expect(
      (await call('PUT', '/v1/me/devices', ana, { pushToken: 'basura', platform: 'ios' }))
        .statusCode,
    ).toBe(400);
    // Otra cuenta entra en el mismo teléfono: el token pasa a esa cuenta.
    const luisMe = json(await call('GET', '/v1/me', luis));
    await call('PUT', '/v1/me/devices', luis, { pushToken: token, platform: 'android' });
    const rows = await sql<{ driver_id: string; status: string }[]>`
      SELECT driver_id, status FROM auth.driver_device WHERE push_token = ${token}`;
    expect(rows).toEqual([{ driver_id: luisMe.id, status: 'ACTIVE' }]);
    expect(
      json(await call('POST', '/v1/me/devices/unregister', ana, { pushToken: token })).removed,
    ).toBe(false);
    expect(
      json(await call('POST', '/v1/me/devices/unregister', luis, { pushToken: token })).removed,
    ).toBe(true);
  });

  it('lista y marca leídos los avisos de la bandeja', async () => {
    const { insertDriverNotification, VOLT_TENANT_ID } = await import('@volt/csms');
    const ana = tokenFor('ana@example.com', 'sub-ana');
    const anaId = json(await call('GET', '/v1/me', ana)).id as string;
    await insertDriverNotification(sql, {
      tenantId: VOLT_TENANT_ID,
      driverId: anaId,
      eventId: 'evt_prueba_1',
      kind: 'SESSION_STARTED',
      locale: 'es',
      title: 'Carga iniciada',
      body: 'Su vehículo empezó a cargar.',
      status: 'NO_DEVICE',
    });
    // Misma clave: no se duplica.
    expect(
      await insertDriverNotification(sql, {
        tenantId: VOLT_TENANT_ID,
        driverId: anaId,
        eventId: 'evt_prueba_1',
        kind: 'SESSION_STARTED',
        locale: 'es',
        title: 'x',
        body: 'x',
        status: 'NO_DEVICE',
      }),
    ).toBeUndefined();
    const list = json(await call('GET', '/v1/me/notifications', ana));
    expect(list.unread).toBe(1);
    expect(list.items).toHaveLength(1);
    expect((list.items as Json[])[0]).toMatchObject({
      kind: 'SESSION_STARTED',
      title: 'Carga iniciada',
      readAt: null,
    });
    expect(json(await call('POST', '/v1/me/notifications/read', ana, {})).updated).toBe(1);
    expect(json(await call('GET', '/v1/me/notifications', ana)).unread).toBe(0);
  });

  it('elimina la cuenta: anonimiza y un nuevo inicio de sesión crea otra cuenta', async () => {
    const ana = tokenFor('ana@example.com', 'sub-ana');
    const before = json(await call('GET', '/v1/me', ana)).id as string;
    expect(
      (
        await call('PATCH', '/v1/me', ana, {
          documentType: 'CC',
          documentNumber: '1020304050',
          wantsInvoice: true,
        })
      ).statusCode,
    ).toBe(200);
    expect((await call('POST', '/v1/me/delete', ana, {})).statusCode).toBe(400);
    const deleted = await call('POST', '/v1/me/delete', ana, { confirm: true });
    expect(deleted.statusCode).toBe(200);
    expect(json(deleted)).toMatchObject({ deleted: true, id: before });
    const rows = await sql<Json[]>`
      SELECT email, phone, display_name, idp_subject, status, consents, anonymized_at,
             document_type, document_number, wants_invoice
      FROM auth.driver WHERE id = ${before}`;
    expect(rows[0]).toMatchObject({
      email: null,
      phone: null,
      display_name: null,
      idp_subject: null,
      status: 'DELETED',
      consents: {},
      document_type: null,
      document_number: null,
      wants_invoice: false,
    });
    expect(rows[0]?.anonymized_at).not.toBeNull();
    expect(
      await sql`SELECT 1 FROM ops.event_outbox WHERE type = 'driver.anonymized' AND aggregate_id = ${before}`,
    ).toHaveLength(1);
    expect(
      await sql`SELECT 1 FROM auth.driver_notification WHERE driver_id = ${before}`,
    ).toHaveLength(0);
    const after = json(await call('GET', '/v1/me', ana));
    expect(after.id).not.toBe(before);
    expect(after).toMatchObject({
      email: 'ana@example.com',
      pendingConsents: ['terms', 'data_processing'],
    });
  });

  it('registra los errores que informa la app sin identidad y rechaza los malformados', async () => {
    const accepted = await call('POST', '/v1/diagnostics/client-errors', null, {
      message: "Property 'crypto' doesn't exist",
      stack: 'ReferenceError: ...',
      route: '/evse/VOLT-1',
      platform: 'ios',
      appVersion: '0.1.0',
      updateId: 'c5d10fe4',
      fatal: true,
    });
    expect(accepted.statusCode).toBe(204);
    const rejected = await call('POST', '/v1/diagnostics/client-errors', null, {
      message: '',
      platform: 'toaster',
      appVersion: '0.1.0',
      fatal: 'sí',
    });
    expect(rejected.statusCode).toBe(400);
  });
});
