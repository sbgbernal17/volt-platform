import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ISql } from 'postgres';

export interface DriverIdentity {
  driverId: string;
  tenantId: string;
  /** Origen de la identidad: Identity Platform (iteración 7) o el token de desarrollo. */
  source: 'identity-platform' | 'dev';
  emailVerified: boolean;
  status: 'ACTIVE' | 'BLOCKED';
}

/** Puerto de identidad del conductor. Lo implementa Identity Platform (JWT) y, en local, el token de desarrollo. */
export interface DriverVerifier {
  verify(token: string): Promise<DriverIdentity | undefined>;
}

/**
 * Verificador de desarrollo: `Authorization: Bearer dev:<driverId>`. Solo se activa con
 * API_DEV_DRIVER_AUTH=true y nunca en producción (lo impide la configuración). Se considera el correo
 * verificado y los consentimientos aceptados (son cuentas creadas por el personal en laboratorio).
 */
export class DevDriverVerifier implements DriverVerifier {
  constructor(private readonly sql: ISql) {}

  async verify(token: string): Promise<DriverIdentity | undefined> {
    if (!token.startsWith('dev:')) return undefined;
    const driverId = token.slice(4);
    if (!/^[0-9a-f-]{36}$/i.test(driverId)) return undefined;
    const rows = await this.sql<{ id: string; tenant_id: string }[]>`
      SELECT id, tenant_id FROM auth.driver WHERE id = ${driverId} AND status = 'ACTIVE' AND anonymized_at IS NULL`;
    const row = rows[0];
    return row
      ? {
          driverId: row.id,
          tenantId: row.tenant_id,
          source: 'dev',
          emailVerified: true,
          status: 'ACTIVE',
        }
      : undefined;
  }
}

/** Prueba cada verificador en orden (token de desarrollo y luego Identity Platform). */
export class CompositeDriverVerifier implements DriverVerifier {
  constructor(private readonly verifiers: readonly DriverVerifier[]) {}

  async verify(token: string): Promise<DriverIdentity | undefined> {
    for (const verifier of this.verifiers) {
      const identity = await verifier.verify(token);
      if (identity) return identity;
    }
    return undefined;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    driver?: DriverIdentity;
  }
}

/** Hook de autenticación de conductor para las rutas privadas de /v1. */
export function driverAuthHook(verifier: DriverVerifier | undefined) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    const identity =
      verifier && scheme?.toLowerCase() === 'bearer' && token
        ? await verifier.verify(token)
        : undefined;
    if (!identity) {
      reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Identidad de conductor requerida' } });
      return;
    }
    request.driver = identity;
  };
}

export const driverOf = (request: FastifyRequest): DriverIdentity =>
  request.driver as NonNullable<FastifyRequest['driver']>;
