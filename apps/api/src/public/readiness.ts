/**
 * Condiciones para registrar un medio de pago o iniciar una carga desde la app (ADR 0022): correo
 * verificado (parámetro `auth.driver_require_verified_email`) y consentimientos obligatorios en su
 * versión vigente (`auth.driver_consent_version`). Las identidades de desarrollo no pasan por aquí.
 */
import {
  currentConsentVersion,
  ForbiddenError,
  getDriver,
  pendingConsents,
  resolveParam,
} from '@volt/csms';
import type { ISql } from 'postgres';
import type { DriverIdentity } from './auth.ts';

export async function assertDriverReady(sql: ISql, identity: DriverIdentity): Promise<void> {
  if (identity.source === 'dev') return;
  const driver = await getDriver(sql, identity.driverId);
  const requireVerified = await resolveParam<boolean>(sql, 'auth.driver_require_verified_email', {
    tenantId: identity.tenantId,
  });
  if (requireVerified && !driver.email_verified) {
    throw new ForbiddenError('Verifique su correo para continuar', 'EMAIL_NOT_VERIFIED');
  }
  const version = await currentConsentVersion(sql, identity.tenantId);
  const pending = pendingConsents(driver, version);
  if (pending.length > 0) {
    throw new ForbiddenError(
      'Acepte los términos y la autorización de datos para continuar',
      'CONSENT_REQUIRED',
      { pending, version },
    );
  }
}
