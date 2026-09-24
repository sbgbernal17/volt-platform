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
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

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
        APP_SUPPORT_EMAIL: 'soporte@supercargadores.co',
      }),
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
        termsUrl: 'https://supercargadores.co/legal/terminos',
        privacyUrl: 'https://supercargadores.co/politica-de-datos',
        supportEmail: 'soporte@supercargadores.co',
      },
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
    // Ya está lista: la carga pasa la comprobación y llega hasta el gateway (no configurado aquí).
    const ready = await call('POST', '/v1/sessions', verified, { evseId: 'X-1' });
    expect(ready.statusCode).toBe(503);
    expect(errorCode(ready)).toBe('GATEWAY_UNAVAILABLE');
    // Perfil.
    const patched = await call('PATCH', '/v1/me', verified, {
      displayName: 'Ana Pérez',
      phone: '+57 300 123 4567',
      locale: 'en',
    });
    expect(json(patched)).toMatchObject({
      displayName: 'Ana Pérez',
      phone: '+57 300 123 4567',
      locale: 'en',
    });
    expect((await call('PATCH', '/v1/me', verified, { locale: 'fr' })).statusCode).toBe(400);
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
    expect((await call('POST', '/v1/me/delete', ana, {})).statusCode).toBe(400);
    const deleted = await call('POST', '/v1/me/delete', ana, { confirm: true });
    expect(deleted.statusCode).toBe(200);
    expect(json(deleted)).toMatchObject({ deleted: true, id: before });
    const rows = await sql<Json[]>`
      SELECT email, phone, display_name, idp_subject, status, consents, anonymized_at FROM auth.driver WHERE id = ${before}`;
    expect(rows[0]).toMatchObject({
      email: null,
      phone: null,
      display_name: null,
      idp_subject: null,
      status: 'DELETED',
      consents: {},
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
});
