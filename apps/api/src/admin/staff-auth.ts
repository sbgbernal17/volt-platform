/**
 * Identidad y autorización del personal en /admin/v1 (SEG §3.1 y §3.2, ADR 0021).
 *
 * - Token estático `API_ADMIN_TOKEN` (laboratorio, pruebas y automatización): administrador con actor
 *   `staff:admin-token` o el `X-Actor` que declare; prohibido en producción (config).
 * - ID token de Identity Platform: se verifica la firma y se resuelve la cuenta de personal por `sub`
 *   (primer inicio: vinculación por correo verificado). El rol, el alcance y el estado salen de la base
 *   de datos en cada petición; los roles privilegiados exigen segundo factor y la sesión caduca por
 *   antigüedad del inicio de sesión (`auth.staff_session_max_h`).
 * - Cada ruta se autoriza con la política central (`policy.ts`) y las mutaciones se auditan en
 *   `audit.audit_log` con actor, petición, resultado y desenlace (OK, DENIED, ERROR).
 */
import {
  appendAudit,
  bindStaffIdentity,
  ForbiddenError,
  type Permission,
  permissionsForRole,
  recordStaffLogin,
  resolveParam,
  SCOPED_ROLES,
  type StaffRole,
  UnauthorizedError,
} from '@volt/csms';
import { constantTimeEquals } from '@volt/security';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import type { IdentityPlatformVerifier, IdTokenClaims } from './identity.ts';
import { policyFor } from './policy.ts';

export interface StaffPrincipal {
  /** Id en auth.staff_user; null con el token estático. */
  id: string | null;
  /** `staff:<id>` o `staff:admin-token` (o el X-Actor declarado con el token estático). */
  actor: string;
  tenantId: string;
  role: StaffRole;
  permissions: ReadonlySet<Permission>;
  /** Sedes permitidas (SITE_OWNER); null = todo el tenant. */
  siteIds: readonly string[] | null;
  email: string | null;
  displayName: string | null;
  locale: 'es' | 'en';
  mfa: boolean;
  method: 'TOKEN' | 'IDENTITY_PLATFORM';
  authTime: Date | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    staff?: StaffPrincipal;
  }
}

export interface StaffAuthenticatorOptions {
  sql: Sql;
  tenantId: string;
  staticToken?: string | undefined;
  verifier?: IdentityPlatformVerifier | undefined;
  clock?: (() => Date) | undefined;
}

interface StaffParams {
  mfaRoles: StaffRole[];
  sessionMaxH: number;
  loadedAt: number;
}

const ACTOR_PATTERN = /^[A-Za-z0-9:_.@-]{1,80}$/;

export class StaffAuthenticator {
  private params: StaffParams | undefined;
  private readonly clock: () => Date;

  constructor(private readonly options: StaffAuthenticatorOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  async authenticate(request: FastifyRequest): Promise<StaffPrincipal> {
    const header = request.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedError('Identidad de personal requerida');
    }
    if (this.options.staticToken && constantTimeEquals(token, this.options.staticToken)) {
      return this.tokenPrincipal(request);
    }
    if (!this.options.verifier || token.split('.').length !== 3) {
      throw new UnauthorizedError('Token de administración inválido');
    }
    return this.identityPrincipal(await this.options.verifier.verify(token));
  }

  private tokenPrincipal(request: FastifyRequest): StaffPrincipal {
    const header = request.headers['x-actor'];
    const declared = Array.isArray(header) ? header[0] : header;
    const actor = declared && ACTOR_PATTERN.test(declared) ? declared : 'staff:admin-token';
    return {
      id: null,
      actor,
      tenantId: this.options.tenantId,
      role: 'ADMIN',
      permissions: permissionsForRole('ADMIN'),
      siteIds: null,
      email: null,
      displayName: 'Token de administración',
      locale: 'es',
      mfa: true,
      method: 'TOKEN',
      authTime: null,
    };
  }

  private async identityPrincipal(claims: IdTokenClaims): Promise<StaffPrincipal> {
    const { sql } = this.options;
    // El personal vive en el pool del proyecto; un token de un tenant (conductores, iteración 7) no entra.
    if (claims.firebase?.tenant) {
      throw new UnauthorizedError('El token no es del personal', 'WRONG_TENANT');
    }
    const staff = await bindStaffIdentity(sql, {
      subject: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified === true,
      provider: claims.firebase?.sign_in_provider,
    });
    if (staff.status === 'DISABLED') {
      throw new ForbiddenError('La cuenta está deshabilitada', 'STAFF_DISABLED');
    }
    if (staff.tenant_id !== this.options.tenantId) {
      throw new ForbiddenError('La cuenta no pertenece a este operador', 'FORBIDDEN');
    }
    const params = await this.loadParams();
    const secondFactor = claims.firebase?.sign_in_second_factor;
    const mfa = typeof secondFactor === 'string' && secondFactor.length > 0;
    if (params.mfaRoles.includes(staff.role) && !mfa) {
      throw new ForbiddenError('Este rol exige segundo factor (TOTP)', 'MFA_REQUIRED', {
        role: staff.role,
      });
    }
    const nowS = Math.floor(this.clock().getTime() / 1000);
    const authTimeS = typeof claims.auth_time === 'number' ? claims.auth_time : claims.iat;
    if (nowS - authTimeS > params.sessionMaxH * 3600) {
      throw new UnauthorizedError('La sesión superó su antigüedad máxima', 'REAUTH_REQUIRED', {
        maxHours: params.sessionMaxH,
      });
    }
    await recordStaffLogin(sql, staff.id, mfa);
    return {
      id: staff.id,
      actor: `staff:${staff.id}`,
      tenantId: staff.tenant_id,
      role: staff.role,
      permissions: permissionsForRole(staff.role),
      siteIds: SCOPED_ROLES.includes(staff.role) ? staff.site_ids : null,
      email: staff.email,
      displayName: staff.display_name,
      locale: staff.locale,
      mfa,
      method: 'IDENTITY_PLATFORM',
      authTime: new Date(authTimeS * 1000),
    };
  }

  /** Parámetros de identidad con caché de un minuto. */
  private async loadParams(): Promise<StaffParams> {
    if (this.params && Date.now() - this.params.loadedAt < 60_000) return this.params;
    const [roles, sessionMaxH] = await Promise.all([
      resolveParam<unknown>(this.options.sql, 'auth.staff_mfa_roles', {
        tenantId: this.options.tenantId,
      }),
      resolveParam<unknown>(this.options.sql, 'auth.staff_session_max_h', {
        tenantId: this.options.tenantId,
      }),
    ]);
    this.params = {
      mfaRoles: Array.isArray(roles)
        ? (roles.filter((r) => typeof r === 'string') as StaffRole[])
        : [],
      sessionMaxH: typeof sessionMaxH === 'number' ? sessionMaxH : 12,
      loadedAt: Date.now(),
    };
    return this.params;
  }
}

/** Principal de la petición; lanza 401 si el hook de autenticación no corrió. */
export function staffOf(request: FastifyRequest): StaffPrincipal {
  if (!request.staff) throw new UnauthorizedError('Identidad de personal requerida');
  return request.staff;
}

export function hasPermission(request: FastifyRequest, permission: Permission): boolean {
  return request.staff?.permissions.has(permission) ?? false;
}

export function requirePermission(request: FastifyRequest, permission: Permission): void {
  if (!hasPermission(request, permission)) {
    throw new ForbiddenError(`Requiere el permiso ${permission}`, 'FORBIDDEN', { permission });
  }
}

/** Sedes a las que se limita la petición (SITE_OWNER); undefined = sin restricción. */
export function siteScope(request: FastifyRequest): readonly string[] | undefined {
  return request.staff?.siteIds ?? undefined;
}

/** 404 (no 403) cuando la entidad queda fuera del alcance: no revela que existe. */
export function assertInScope(request: FastifyRequest, siteId: string | null | undefined): void {
  const scope = siteScope(request);
  if (scope && (!siteId || !scope.includes(siteId))) {
    throw new ForbiddenError('Fuera del alcance de tus sedes', 'OUT_OF_SCOPE');
  }
}

const SENSITIVE_KEY = /key|secret|password|token|authorization|cvc|pan$/i;
const MAX_AUDIT_JSON = 8000;

/** Copia de un valor para auditoría: sin secretos y acotada en tamaño. */
export function redactForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth > 6) return '[profundidad]';
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => redactForAudit(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] =
      SENSITIVE_KEY.test(key) && item != null ? '[redactado]' : redactForAudit(item, depth + 1);
  }
  return out;
}

function bounded(value: unknown): unknown {
  const redacted = redactForAudit(value);
  const json = JSON.stringify(redacted) ?? 'null';
  if (json.length <= MAX_AUDIT_JSON) return redacted;
  const id = (redacted as { id?: unknown } | null)?.id;
  return { truncated: true, bytes: json.length, ...(id !== undefined ? { id } : {}) };
}

export interface StaffAuthHooksOptions {
  sql: Sql;
  tenantId: string;
  authenticator: StaffAuthenticator;
}

/**
 * Hooks de /admin/v1: autenticación y autorización por política en `onRequest`, captura del cuerpo de
 * la respuesta en `onSend` y auditoría en `onResponse` (después de responder; un fallo al auditar se
 * registra en el log y no afecta la respuesta).
 */
export function registerStaffAuth(app: FastifyInstance, options: StaffAuthHooksOptions): void {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    request.staff = await options.authenticator.authenticate(request);
    const policy = policyFor(request.method, request.routeOptions.url);
    if (!policy) {
      request.log.error({ url: request.routeOptions.url }, 'ruta de administración sin política');
      throw new ForbiddenError('Ruta sin política de acceso', 'NO_POLICY');
    }
    if (policy.permission !== 'any' && !request.staff.permissions.has(policy.permission)) {
      throw new ForbiddenError(`Requiere el permiso ${policy.permission}`, 'FORBIDDEN', {
        permission: policy.permission,
        role: request.staff.role,
      });
    }
  });

  /**
   * La auditoría se escribe en `onSend`, antes de que el cliente reciba la respuesta: la fila existe
   * cuando el resultado se conoce. Si fallara, se registra en el log y la respuesta sigue su curso.
   */
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    const policy = policyFor(request.method, request.routeOptions.url);
    const principal = request.staff;
    if (!policy?.audit || !principal) return payload;
    let response: unknown;
    if (typeof payload === 'string' && payload.length <= 256_000) {
      try {
        response = JSON.parse(payload);
      } catch {
        response = undefined;
      }
    }
    const status = reply.statusCode;
    const params = (request.params ?? {}) as Record<string, string | undefined>;
    const responseId = (response as { id?: unknown } | undefined)?.id;
    const idFromResponse = typeof responseId === 'string' ? responseId : undefined;
    const entityId =
      policy.audit.idFrom === 'params:key'
        ? params.key
        : policy.audit.idFrom === 'response:id'
          ? (idFromResponse ?? params.id)
          : (params.id ?? params.key ?? idFromResponse);
    try {
      await appendAudit(options.sql, {
        tenantId: options.tenantId,
        actorType: 'staff',
        actorId: principal.actor,
        action: policy.audit.action,
        entityType: policy.audit.entity,
        entityId: entityId ?? '-',
        after: {
          status,
          method: request.method,
          route: request.routeOptions.url ?? request.url,
          params: bounded(params),
          query: bounded(request.query ?? {}),
          input: bounded(request.body ?? null),
          result: bounded(response ?? null),
        },
        requestId: request.id,
        remoteIp: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        outcome: status < 400 ? 'OK' : status === 403 ? 'DENIED' : 'ERROR',
      });
    } catch (error) {
      request.log.error({ err: error }, 'no se pudo escribir la auditoría');
    }
    return payload;
  });
}
