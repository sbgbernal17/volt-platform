/**
 * Iteración 6: identidad del personal con Identity Platform (tokens firmados con una clave local y
 * JWKS servido por un servidor http local), RBAC por política central, alcance por sedes, auditoría
 * automática con redacción de secretos y cobertura de la política sobre todas las rutas.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { policyFor } from './admin/policy.ts';
import { redactForAudit } from './admin/staff-auth.ts';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const baseUrl = process.env.DATABASE_URL;
const ADMIN_TOKEN = 'token-admin-de-pruebas-0123456789';
const PROJECT = 'volt-test-project';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;

function b64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signToken(claims: Record<string, unknown>, kid = 'k1'): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString(
    'base64url',
  );
  return `${header}.${body}.${signature}`;
}

interface TokenOptions {
  verified?: boolean;
  mfa?: boolean;
  aud?: string;
  expOffsetS?: number;
  authTimeOffsetS?: number;
  kid?: string;
}

function tokenFor(email: string, sub: string, options: TokenOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const aud = options.aud ?? PROJECT;
  return signToken(
    {
      iss: `https://securetoken.google.com/${aud}`,
      aud,
      sub,
      iat: now - 5,
      exp: now + (options.expOffsetS ?? 3600),
      auth_time: now + (options.authTimeOffsetS ?? -5),
      email,
      email_verified: options.verified ?? true,
      firebase: {
        sign_in_provider: 'password',
        ...(options.mfa ? { sign_in_second_factor: 'totp', second_factor_identifier: 'f1' } : {}),
      },
    },
    options.kid,
  );
}

describe('configuración y política', () => {
  it('producción exige Identity Platform y rechaza el token estático', () => {
    const base = {
      NODE_ENV: 'production',
      PAYMENTS_PROVIDER: 'wompi',
      WOMPI_ENVIRONMENT: 'production',
      WOMPI_PUBLIC_KEY: 'pub_prod_xxxxxxxx',
      WOMPI_PRIVATE_KEY: 'prv_prod_xxxxxxxx',
      WOMPI_INTEGRITY_SECRET: 'prod_integrity_xxxx',
      WOMPI_EVENTS_SECRET: 'prod_events_xxxx',
    };
    expect(() => loadConfig(base)).toThrow(/IDENTITY_PLATFORM_PROJECT_ID/);
    expect(() =>
      loadConfig({
        ...base,
        IDENTITY_PLATFORM_PROJECT_ID: 'volt-prod',
        API_ADMIN_TOKEN: ADMIN_TOKEN,
      }),
    ).toThrow(/API_ADMIN_TOKEN/);
    expect(
      loadConfig({ ...base, IDENTITY_PLATFORM_PROJECT_ID: 'volt-prod' }).API_CORS_ORIGINS,
    ).toEqual([]);
    expect(
      loadConfig({ API_CORS_ORIGINS: 'https://admin.supercargadores.co/, http://localhost:5173' })
        .API_CORS_ORIGINS,
    ).toEqual(['https://admin.supercargadores.co', 'http://localhost:5173']);
  });

  it('la política resuelve rutas con prefijo y redacta secretos para la auditoría', () => {
    expect(policyFor('POST', '/admin/v1/charge-points/:id/commands')?.permission).toBe(
      'commands:support',
    );
    expect(policyFor('GET', '/admin/v1/no-existe')).toBeUndefined();
    expect(
      redactForAudit({
        authorizationKey: 'ABC',
        nested: { privateKey: 'x', ok: 1, list: [{ token: 't' }] },
        password: null,
      }),
    ).toEqual({
      authorizationKey: '[redactado]',
      nested: { privateKey: '[redactado]', ok: 1, list: [{ token: '[redactado]' }] },
      password: null,
    });
  });
});

describe.skipIf(!baseUrl)('personal, RBAC y auditoría por la API', () => {
  let database: TemporaryDatabase;
  let jwks: Server;
  let app: FastifyInstance;
  const routes: { method: string; url: string }[] = [];
  let siteA = '';
  let siteB = '';
  let anaId = '';
  let sopId = '';

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    token: string | null = ADMIN_TOKEN,
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
  const json = <T = Record<string, unknown>>(response: { json: () => unknown }): T =>
    response.json() as T;

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    jwks = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.setHeader('cache-control', 'public, max-age=3600');
      response.end(JSON.stringify({ keys: [{ ...jwk, kid: 'k1', use: 'sig', alg: 'RS256' }] }));
    });
    await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));
    const port = (jwks.address() as AddressInfo).port;
    app = buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: database.url,
        API_ADMIN_TOKEN: ADMIN_TOKEN,
        IDENTITY_PLATFORM_PROJECT_ID: PROJECT,
        IDENTITY_PLATFORM_API_KEY: 'clave-web-publica',
        IDENTITY_PLATFORM_JWKS_URL: `http://127.0.0.1:${port}/jwks`,
        API_STAFF_BOOTSTRAP_EMAIL: 'dueno@volt.co',
        API_CORS_ORIGINS: 'http://localhost:5173',
      }),
    });
    app.addHook('onRoute', (route) => {
      for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
        routes.push({ method, url: route.url });
      }
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => jwks.close(() => resolve()));
    await database.drop();
  });

  it('toda ruta de administración tiene política y la configuración de identidad es pública', async () => {
    const admin = routes.filter((r) => r.url.startsWith('/admin/v1/') && r.method !== 'HEAD');
    expect(admin.length).toBeGreaterThan(60);
    const missing = admin
      .filter((r) => r.url !== '/admin/v1/auth/config' && !policyFor(r.method, r.url))
      .map((r) => `${r.method} ${r.url}`);
    expect(missing).toEqual([]);
    const config = await call('GET', '/admin/v1/auth/config', undefined, null);
    expect(config.statusCode).toBe(200);
    expect(json(config)).toEqual({
      provider: 'identity-platform',
      projectId: PROJECT,
      apiKey: 'clave-web-publica',
      authDomain: `${PROJECT}.firebaseapp.com`,
      tokenLogin: true,
    });
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/admin/v1/sites',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const foreign = await app.inject({
      method: 'OPTIONS',
      url: '/admin/v1/sites',
      headers: { origin: 'https://otro.example', 'access-control-request-method': 'GET' },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('rechaza peticiones sin identidad o con tokens inválidos', async () => {
    expect((await call('GET', '/admin/v1/me', undefined, null)).statusCode).toBe(401);
    expect((await call('GET', '/admin/v1/me', undefined, 'basura')).statusCode).toBe(401);
    expect((await call('GET', '/admin/v1/me', undefined, 'a.b.c')).statusCode).toBe(401);
    const otherAudience = await call(
      'GET',
      '/admin/v1/me',
      undefined,
      tokenFor('x@volt.co', 'u0', { aud: 'otro' }),
    );
    expect(json(otherAudience)).toMatchObject({ error: { code: 'TOKEN_INVALID' } });
    const expired = await call(
      'GET',
      '/admin/v1/me',
      undefined,
      tokenFor('x@volt.co', 'u0', { expOffsetS: -120 }),
    );
    expect(json(expired)).toMatchObject({ error: { code: 'TOKEN_EXPIRED' } });
    const unknownKey = await call(
      'GET',
      '/admin/v1/me',
      undefined,
      tokenFor('x@volt.co', 'u0', { kid: 'k9' }),
    );
    expect(json(unknownKey)).toMatchObject({ error: { code: 'TOKEN_INVALID' } });
  });

  it('el token estático entra como administrador con el actor declarado y el arranque invitó al dueño', async () => {
    const me = await call('GET', '/admin/v1/me', undefined, ADMIN_TOKEN, {
      'x-actor': 'staff:ana',
    });
    expect(json(me)).toMatchObject({
      role: 'ADMIN',
      method: 'TOKEN',
      actor: 'staff:ana',
      id: null,
    });
    const staff = await call('GET', '/admin/v1/staff');
    expect(json<{ items: { email: string; role: string; status: string }[] }>(staff).items).toEqual(
      [expect.objectContaining({ email: 'dueno@volt.co', role: 'ADMIN', status: 'INVITED' })],
    );
  });

  it('vincula la invitación con correo verificado, exige MFA a OPERATIONS y aplica la antigüedad máxima', async () => {
    const invited = await call('POST', '/admin/v1/staff', {
      email: 'Ana@volt.co',
      displayName: 'Ana',
      role: 'OPERATIONS',
    });
    expect(invited.statusCode).toBe(201);
    anaId = json<{ id: string }>(invited).id;
    expect(json(invited)).toMatchObject({ email: 'ana@volt.co', status: 'INVITED', linked: false });

    const notInvited = await call(
      'GET',
      '/admin/v1/me',
      undefined,
      tokenFor('nadie@volt.co', 'u-nadie'),
    );
    expect(notInvited.statusCode).toBe(403);
    expect(json(notInvited)).toMatchObject({ error: { code: 'STAFF_NOT_INVITED' } });
    const unverified = await call(
      'GET',
      '/admin/v1/me',
      undefined,
      tokenFor('ana@volt.co', 'u-ana', { verified: false }),
    );
    expect(json(unverified)).toMatchObject({ error: { code: 'EMAIL_NOT_VERIFIED' } });
    const noMfa = await call('GET', '/admin/v1/me', undefined, tokenFor('ana@volt.co', 'u-ana'));
    expect(noMfa.statusCode).toBe(403);
    expect(json(noMfa)).toMatchObject({ error: { code: 'MFA_REQUIRED' } });
    const ok = await call(
      'GET',
      '/admin/v1/me',
      undefined,
      tokenFor('ana@volt.co', 'u-ana', { mfa: true }),
    );
    expect(ok.statusCode).toBe(200);
    expect(json(ok)).toMatchObject({
      id: anaId,
      actor: `staff:${anaId}`,
      role: 'OPERATIONS',
      method: 'IDENTITY_PLATFORM',
      mfa: true,
      email: 'ana@volt.co',
    });
    const linked = await call('GET', `/admin/v1/staff/${anaId}`);
    expect(json(linked)).toMatchObject({ status: 'ACTIVE', linked: true, mfa_enrolled: true });
    // Otra identidad con el mismo correo no puede apropiarse de la cuenta.
    const hijack = await call(
      'GET',
      '/admin/v1/me',
      undefined,
      tokenFor('ana@volt.co', 'u-otra', { mfa: true }),
    );
    expect(json(hijack)).toMatchObject({ error: { code: 'STAFF_ALREADY_BOUND' } });
    const stale = await call(
      'GET',
      '/admin/v1/me',
      undefined,
      tokenFor('ana@volt.co', 'u-ana', { mfa: true, authTimeOffsetS: -13 * 3600 }),
    );
    expect(stale.statusCode).toBe(401);
    expect(json(stale)).toMatchObject({ error: { code: 'REAUTH_REQUIRED' } });
  });

  it('autoriza por rol: OPERATIONS opera pero no gestiona personal; SUPPORT solo sus comandos; READ_ONLY solo lee', async () => {
    const ana = tokenFor('ana@volt.co', 'u-ana', { mfa: true });
    const site = await call(
      'POST',
      '/admin/v1/sites',
      {
        code: 'SEDE-A',
        name: 'Sede A',
        address: 'Calle 1',
        latitude: 4.6,
        longitude: -74.08,
      },
      ana,
    );
    expect(site.statusCode).toBe(201);
    siteA = json<{ id: string }>(site).id;
    const denied = await call(
      'POST',
      '/admin/v1/staff',
      { email: 'x@volt.co', role: 'SUPPORT' },
      ana,
    );
    expect(denied.statusCode).toBe(403);
    expect(json(denied)).toMatchObject({
      error: { code: 'FORBIDDEN', details: { permission: 'staff:manage' } },
    });

    const sop = await call('POST', '/admin/v1/staff', { email: 'sop@volt.co', role: 'SUPPORT' });
    sopId = json<{ id: string }>(sop).id;
    const sopToken = tokenFor('sop@volt.co', 'u-sop');
    expect((await call('GET', '/admin/v1/me', undefined, sopToken)).statusCode).toBe(200);
    const chargePoint = await call('POST', '/admin/v1/charge-points', {
      siteId: siteA,
      chargeBoxId: 'CP-STAFF-A',
      connectors: [{ ocppConnectorId: 1, standard: 'IEC_62196_T2_COMBO', powerType: 'DC' }],
    });
    expect(chargePoint.statusCode).toBe(201);
    const chargePointId = json<{ id: string }>(chargePoint).id;
    const reset = await call(
      'POST',
      `/admin/v1/charge-points/${chargePointId}/commands`,
      { action: 'Reset', payload: { type: 'Soft' } },
      sopToken,
    );
    expect(reset.statusCode).toBe(403);
    expect(json(reset)).toMatchObject({ error: { details: { permission: 'commands:execute' } } });
    // UnlockConnector sí es de soporte: pasa la política y falla después por falta de gateway (503).
    const unlock = await call(
      'POST',
      `/admin/v1/charge-points/${chargePointId}/commands`,
      { action: 'UnlockConnector', payload: { connectorId: 1 } },
      sopToken,
    );
    expect(unlock.statusCode).toBe(503);
    expect((await call('GET', '/admin/v1/tariffs', undefined, sopToken)).statusCode).toBe(200);
    expect(
      (
        await call(
          'PUT',
          '/admin/v1/parameters/pricing.exposure_limit_minor',
          { scopeType: 'TENANT', scopeId: 'a0000000-0000-4000-8000-000000000001', value: 1 },
          sopToken,
        )
      ).statusCode,
    ).toBe(403);

    await call('POST', '/admin/v1/staff', { email: 'lector@volt.co', role: 'READ_ONLY' });
    const reader = tokenFor('lector@volt.co', 'u-lector');
    expect((await call('GET', '/admin/v1/overview', undefined, reader)).statusCode).toBe(200);
    expect((await call('GET', '/admin/v1/audit', undefined, reader)).statusCode).toBe(200);
    expect(
      (
        await call(
          'POST',
          '/admin/v1/sites',
          { code: 'X', name: 'x', address: 'x', latitude: 1, longitude: 1 },
          reader,
        )
      ).statusCode,
    ).toBe(403);

    const disabled = await call('PATCH', `/admin/v1/staff/${sopId}`, {
      status: 'DISABLED',
      reason: 'prueba',
    });
    expect(json(disabled)).toMatchObject({ status: 'DISABLED' });
    const afterDisable = await call('GET', '/admin/v1/me', undefined, sopToken);
    expect(json(afterDisable)).toMatchObject({ error: { code: 'STAFF_DISABLED' } });
  });

  it('SITE_OWNER solo ve sus sedes, sus cargadores y su resumen', async () => {
    const other = await call('POST', '/admin/v1/sites', {
      code: 'SEDE-B',
      name: 'Sede B',
      address: 'Calle 2',
      latitude: 4.7,
      longitude: -74.1,
    });
    siteB = json<{ id: string }>(other).id;
    const owner = await call('POST', '/admin/v1/staff', {
      email: 'socio@volt.co',
      role: 'SITE_OWNER',
      siteIds: [siteA],
    });
    expect(owner.statusCode).toBe(201);
    const token = tokenFor('socio@volt.co', 'u-socio');
    const sites = await call('GET', '/admin/v1/sites', undefined, token);
    expect(json<{ items: { id: string }[] }>(sites).items.map((s) => s.id)).toEqual([siteA]);
    const forbidden = await call('GET', `/admin/v1/sites/${siteB}`, undefined, token);
    expect(forbidden.statusCode).toBe(403);
    expect(json(forbidden)).toMatchObject({ error: { code: 'OUT_OF_SCOPE' } });
    const chargePoints = await call('GET', '/admin/v1/charge-points', undefined, token);
    expect(
      json<{ items: { site_id: string }[] }>(chargePoints).items.every(
        (cp) => cp.site_id === siteA,
      ),
    ).toBe(true);
    const overview = await call('GET', '/admin/v1/overview', undefined, token);
    expect(json<{ counts: { sites: number } }>(overview).counts.sites).toBe(1);
    expect((await call('GET', '/admin/v1/tariffs', undefined, token)).statusCode).toBe(403);
    expect((await call('GET', '/admin/v1/me', undefined, token)).statusCode).toBe(200);
    expect(json(await call('GET', '/admin/v1/me', undefined, token))).toMatchObject({
      siteIds: [siteA],
    });
  });

  it('audita cada mutación con actor, resultado y secretos redactados, y la cadena verifica', async () => {
    const chargePoints = await call('GET', '/admin/v1/charge-points');
    const chargePointId = json<{ items: { id: string }[] }>(chargePoints).items[0]?.id as string;
    const credential = await call(
      'POST',
      `/admin/v1/charge-points/${chargePointId}/credentials`,
      undefined,
      ADMIN_TOKEN,
      {
        'x-actor': 'staff:tecnico',
      },
    );
    expect(credential.statusCode).toBe(201);
    expect(json<{ authorizationKey: string }>(credential).authorizationKey).toMatch(
      /^[0-9A-F]{40}$/,
    );

    const audit = await call('GET', '/admin/v1/audit?limit=200');
    const items = json<{ items: Record<string, unknown>[] }>(audit).items;
    const actions = items.map((i) => i.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'staff.invite',
        'site.create',
        'charge_point.create',
        'credential.issue',
        'staff.update',
      ]),
    );
    const credentialEntry = items.find((i) => i.action === 'credential.issue') as {
      actor_id: string;
      entity_id: string;
      outcome: string;
      after: { result: { authorizationKey: string }; status: number };
      hash: string;
      prevHash: string;
    };
    expect(credentialEntry.actor_id).toBe('staff:tecnico');
    expect(credentialEntry.entity_id).toBe(chargePointId);
    expect(credentialEntry.outcome).toBe('OK');
    expect(credentialEntry.after.status).toBe(201);
    expect(credentialEntry.after.result.authorizationKey).toBe('[redactado]');
    expect(credentialEntry.hash).toMatch(/^[0-9a-f]{64}$/);
    const denied = items.find((i) => i.action === 'staff.invite' && i.outcome === 'DENIED') as {
      actor_id: string;
    };
    expect(denied.actor_id).toBe(`staff:${anaId}`);
    const siteEntry = items.find(
      (i) => i.action === 'site.create' && i.actor_id === `staff:${anaId}`,
    ) as {
      entity_id: string;
    };
    expect(siteEntry.entity_id).toBe(siteA);
    const byEntity = await call(
      'GET',
      `/admin/v1/audit?entityType=charge_point&entityId=${chargePointId}`,
    );
    expect(json<{ items: unknown[] }>(byEntity).items.length).toBeGreaterThanOrEqual(2);
    const verify = await call('POST', '/admin/v1/audit/verify');
    expect(json(verify)).toMatchObject({ ok: true, brokenAtId: null });
    expect(json<{ checked: number }>(verify).checked).toBeGreaterThanOrEqual(items.length);
  });
});
