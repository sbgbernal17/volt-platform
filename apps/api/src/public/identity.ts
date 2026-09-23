/**
 * Identidad del conductor con Identity Platform (iteración 7, ADR 0022): el ID token de la app se
 * verifica como el del personal (RS256, JWKS de Google, emisor y audiencia del proyecto) y la cuenta
 * se crea o se vincula en el primer inicio de sesión. Si la plataforma usa un tenant de Identity
 * Platform para conductores, el token debe traerlo en `firebase.tenant`.
 */
import { resolveDriverIdentity, UnauthorizedError } from '@volt/csms';
import type { Sql } from 'postgres';
import type { IdentityPlatformVerifier } from '../admin/identity.ts';
import type { DriverIdentity, DriverVerifier } from './auth.ts';

export interface DriverIdentityVerifierOptions {
  sql: Sql;
  tenantId: string;
  verifier: IdentityPlatformVerifier;
  /** Tenant de Identity Platform reservado a conductores (`firebase.tenant`); sin él, el pool del proyecto. */
  driverTenantId?: string | undefined;
  clock?: (() => Date) | undefined;
}

export class DriverIdentityVerifier implements DriverVerifier {
  constructor(private readonly options: DriverIdentityVerifierOptions) {}

  async verify(token: string): Promise<DriverIdentity | undefined> {
    // Los tokens de desarrollo (`dev:`) y cualquier cosa que no sea un JWT no son de este verificador.
    if (token.split('.').length !== 3) return undefined;
    const claims = await this.options.verifier.verify(token);
    const tenant = claims.firebase?.tenant;
    if (this.options.driverTenantId) {
      if (tenant !== this.options.driverTenantId) {
        throw new UnauthorizedError('El token no es de la app Volt', 'WRONG_TENANT');
      }
    } else if (tenant) {
      throw new UnauthorizedError('El token no es de la app Volt', 'WRONG_TENANT');
    }
    const { driver } = await resolveDriverIdentity(
      this.options.sql,
      this.options.tenantId,
      {
        subject: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified === true,
        provider: claims.firebase?.sign_in_provider,
        displayName: claims.name,
      },
      this.options.clock?.() ?? new Date(),
    );
    if (driver.status === 'DELETED') return undefined;
    return {
      driverId: driver.id,
      tenantId: driver.tenant_id,
      source: 'identity-platform',
      emailVerified: driver.email_verified,
      status: driver.status,
    };
  }
}
