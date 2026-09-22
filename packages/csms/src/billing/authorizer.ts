/**
 * Validación antes de iniciar una carga (ADR 0002, punto 3): cuenta activa y no bloqueada, sin deuda
 * abierta, con un medio de pago disponible. Las sesiones de prueba y las de operador sin conductor
 * no pasan por aquí (cortesía o responsabilidad del operador). Para la primera carga de una cuenta
 * nueva aplica el tope reducido `pricing.exposure_limit_first_session_minor` (ADR 0002, punto 4).
 */
import type { ISql } from 'postgres';
import { resolveParam } from '../pricing/params.ts';
import { getDriver } from '../sessions/drivers.ts';
import type { ChargingSessionRow } from '../sessions/rows.ts';
import type { PaymentAuthorizer } from '../sessions/session-service.ts';
import { findChargeablePaymentMethod, hasPendingPaymentMethod } from './payment-methods.ts';
import type { DriverBillingStatus } from './rows.ts';

export type AuthorizationDenial =
  | 'DRIVER_INACTIVE'
  | 'DRIVER_BLOCKED'
  | 'DEBT_PENDING'
  | 'NO_PAYMENT_METHOD'
  | 'PAYMENT_METHOD_PENDING';

export const DENIAL_MESSAGES: Record<AuthorizationDenial, string> = {
  DRIVER_INACTIVE: 'La cuenta no está activa',
  DRIVER_BLOCKED: 'La cuenta está bloqueada; contacta a soporte',
  DEBT_PENDING: 'Tienes un cobro pendiente; págalo para volver a cargar',
  NO_PAYMENT_METHOD: 'Registra una tarjeta para poder cargar',
  PAYMENT_METHOD_PENDING: 'Tu tarjeta aún está en verificación; inténtalo en un momento',
};

export class BillingAuthorizer implements PaymentAuthorizer {
  constructor(private readonly db: ISql) {}

  async authorize(
    session: ChargingSessionRow,
  ): Promise<{ ok: true; preauthMinor?: bigint } | { ok: false; code: string; message: string }> {
    if (session.is_test || !session.driver_id) return { ok: true };
    return this.checkDriver(session.driver_id, session.tenant_id, session.id);
  }

  /** Misma comprobación sin sesión (la app la muestra antes de que el conductor intente cargar). */
  async checkDriver(
    driverId: string,
    tenantId: string,
    excludeSessionId?: string,
  ): Promise<{ ok: true; preauthMinor?: bigint } | { ok: false; code: string; message: string }> {
    const driver = await getDriver(this.db, driverId);
    const billingStatus: DriverBillingStatus = driver.billing_status ?? 'OK';
    if (driver.status !== 'ACTIVE') return deny('DRIVER_INACTIVE');
    if (billingStatus !== 'OK') return deny('DRIVER_BLOCKED');
    const blockOnDebt = await resolveParam<boolean>(this.db, 'billing.block_on_debt', { tenantId });
    if (blockOnDebt) {
      const debts = await this
        .db`SELECT 1 FROM billing.debt WHERE driver_id = ${driverId} AND status = 'OPEN' LIMIT 1`;
      if (debts.length > 0) return deny('DEBT_PENDING');
    }
    const method = await findChargeablePaymentMethod(this.db, driverId);
    if (!method) {
      return deny(
        (await hasPendingPaymentMethod(this.db, driverId))
          ? 'PAYMENT_METHOD_PENDING'
          : 'NO_PAYMENT_METHOD',
      );
    }
    const paid = await this.db`
      SELECT 1 FROM sessions.charging_session
      WHERE driver_id = ${driverId} AND state = 'PAID' AND (${excludeSessionId ?? null}::uuid IS NULL OR id <> ${excludeSessionId ?? null}::uuid)
      LIMIT 1`;
    if (paid.length === 0) {
      const firstLimit = await resolveParam<number>(
        this.db,
        'pricing.exposure_limit_first_session_minor',
        { tenantId },
      );
      if (firstLimit > 0) return { ok: true, preauthMinor: BigInt(firstLimit) };
    }
    return { ok: true };
  }
}

function deny(code: AuthorizationDenial): { ok: false; code: string; message: string } {
  return { ok: false, code, message: DENIAL_MESSAGES[code] };
}
