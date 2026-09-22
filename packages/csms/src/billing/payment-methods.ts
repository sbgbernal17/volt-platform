/**
 * Medios de pago del conductor (ADR 0002, punto 2): el token lo genera la app con la llave pública
 * (los datos de tarjeta nunca pasan por Volt); aquí se crea la fuente de pago en la pasarela y se
 * guarda solo su identificador, marca, últimos cuatro dígitos, vencimiento y estado 3DS.
 */
import { randomUUID } from 'node:crypto';
import { type PaymentGateway, PaymentGatewayError, type PaymentSource } from '@volt/payments';
import type { ISql } from 'postgres';
import { ConflictError, CsmsError, NotFoundError, ValidationError } from '../errors.ts';
import { getDriver } from '../sessions/drivers.ts';
import { toJson } from '../types.ts';
import type { PaymentMethodRow } from './rows.ts';

export type { PaymentMethodRow };

export interface RegisterPaymentMethodInput {
  tenantId: string;
  driverId: string;
  type: 'CARD' | 'NEQUI';
  token: string;
  acceptanceToken: string;
  personalDataAuthToken: string;
  customerEmail?: string | undefined;
}

/** Traduce un fallo de la pasarela a un error de negocio con código estable. */
export function gatewayErrorToCsms(error: unknown, context: string): never {
  if (error instanceof PaymentGatewayError) {
    if (error.code === 'VALIDATION' || error.code === 'NOT_FOUND') {
      throw new ValidationError(`${context}: ${error.message}`, error.details);
    }
    throw new CsmsError(`${context}: ${error.message}`, 502, 'PAYMENT_GATEWAY', {
      code: error.code,
    });
  }
  throw error;
}

function labelOf(source: PaymentSource): string {
  if (source.type === 'NEQUI') return `Nequi ${source.publicData.phone_number ?? ''}`.trim();
  const brand = source.publicData.brand ?? 'Tarjeta';
  return source.publicData.last_four
    ? `${brand} terminada en ${source.publicData.last_four}`
    : brand;
}

export async function registerPaymentMethod(
  db: ISql,
  gateway: PaymentGateway,
  input: RegisterPaymentMethodInput,
): Promise<PaymentMethodRow> {
  const driver = await getDriver(db, input.driverId);
  if (driver.tenant_id !== input.tenantId) throw new NotFoundError('driver', input.driverId);
  const customerEmail = input.customerEmail ?? driver.email;
  if (!customerEmail)
    throw new ValidationError('El conductor necesita un correo para registrar un medio de pago');
  let source: PaymentSource;
  try {
    source = await gateway.createPaymentSource({
      type: input.type,
      token: input.token,
      customerEmail,
      acceptanceToken: input.acceptanceToken,
      personalDataAuthToken: input.personalDataAuthToken,
    });
  } catch (error) {
    gatewayErrorToCsms(error, 'La pasarela rechazó el medio de pago');
  }
  const rows = await db<PaymentMethodRow[]>`
    INSERT INTO billing.payment_method
      (id, tenant_id, driver_id, psp, psp_method_id, kind, brand, last4, expires_month, expires_year, status,
       psp_environment, psp_source_status, three_ds, customer_email, label, acceptance)
    VALUES (${randomUUID()}, ${input.tenantId}, ${input.driverId}, ${gateway.provider}, ${String(source.id)},
            ${source.type === 'NEQUI' ? 'WALLET' : 'CARD'}, ${source.publicData.brand ?? null}, ${source.publicData.last_four ?? null},
            ${source.publicData.exp_month ? Number(source.publicData.exp_month) : null},
            ${source.publicData.exp_year ? normalizeYear(source.publicData.exp_year) : null}, 'ACTIVE',
            ${gateway.environment}, ${source.status}, ${source.threeDs ? toJson(db as never, source.threeDs) : null},
            ${customerEmail}, ${labelOf(source)},
            ${toJson(db as never, { acceptance_token: input.acceptanceToken, personal_data_auth_token: input.personalDataAuthToken, accepted_at: new Date().toISOString() })})
    ON CONFLICT (psp, psp_method_id) DO UPDATE SET
      status = 'ACTIVE', removed_at = NULL, psp_source_status = EXCLUDED.psp_source_status, three_ds = EXCLUDED.three_ds,
      updated_at = now()
    RETURNING *`;
  const row = rows[0] as PaymentMethodRow;
  await ensureDefault(db, row);
  return row;
}

function normalizeYear(value: string): number {
  const year = Number(value);
  return year < 100 ? 2000 + year : year;
}

async function ensureDefault(db: ISql, method: PaymentMethodRow): Promise<void> {
  if (method.psp_source_status !== 'AVAILABLE' || method.status !== 'ACTIVE') return;
  await db`
    UPDATE auth.driver SET default_payment_method_id = ${method.id}, updated_at = now()
    WHERE id = ${method.driver_id}
      AND (default_payment_method_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM billing.payment_method m WHERE m.id = auth.driver.default_payment_method_id AND m.status = 'ACTIVE' AND m.psp_source_status = 'AVAILABLE'))`;
}

/** Consulta a la pasarela el estado de la fuente (3DS pendiente) y lo guarda. */
export async function refreshPaymentMethod(
  db: ISql,
  gateway: PaymentGateway,
  id: string,
): Promise<PaymentMethodRow> {
  const current = await getPaymentMethod(db, id);
  if (current.psp !== gateway.provider) return current;
  let source: PaymentSource;
  try {
    source = await gateway.getPaymentSource(Number(current.psp_method_id));
  } catch (error) {
    gatewayErrorToCsms(error, 'No se pudo consultar el medio de pago');
  }
  const rows = await db<PaymentMethodRow[]>`
    UPDATE billing.payment_method SET psp_source_status = ${source.status},
           three_ds = ${source.threeDs ? toJson(db as never, source.threeDs) : null}, updated_at = now()
    WHERE id = ${id} RETURNING *`;
  const row = rows[0] as PaymentMethodRow;
  await ensureDefault(db, row);
  return row;
}

export async function getPaymentMethod(db: ISql, id: string): Promise<PaymentMethodRow> {
  const rows = await db<PaymentMethodRow[]>`SELECT * FROM billing.payment_method WHERE id = ${id}`;
  const row = rows[0];
  if (!row) throw new NotFoundError('payment_method', id);
  return row;
}

export async function listPaymentMethods(db: ISql, driverId: string): Promise<PaymentMethodRow[]> {
  return db<PaymentMethodRow[]>`
    SELECT * FROM billing.payment_method WHERE driver_id = ${driverId} AND status <> 'REMOVED'
    ORDER BY created_at DESC`;
}

export async function removePaymentMethod(
  db: ISql,
  id: string,
  driverId: string,
): Promise<PaymentMethodRow> {
  const current = await getPaymentMethod(db, id);
  if (current.driver_id !== driverId) throw new NotFoundError('payment_method', id);
  const rows = await db<PaymentMethodRow[]>`
    UPDATE billing.payment_method SET status = 'REMOVED', removed_at = now(), updated_at = now() WHERE id = ${id} RETURNING *`;
  await db`
    UPDATE auth.driver SET default_payment_method_id = (
      SELECT m.id FROM billing.payment_method m
      WHERE m.driver_id = ${driverId} AND m.status = 'ACTIVE' AND m.psp_source_status = 'AVAILABLE'
      ORDER BY m.created_at DESC LIMIT 1), updated_at = now()
    WHERE id = ${driverId} AND default_payment_method_id = ${id}`;
  return rows[0] as PaymentMethodRow;
}

export async function setDefaultPaymentMethod(
  db: ISql,
  id: string,
  driverId: string,
): Promise<PaymentMethodRow> {
  const current = await getPaymentMethod(db, id);
  if (current.driver_id !== driverId || current.status !== 'ACTIVE')
    throw new NotFoundError('payment_method', id);
  if (current.psp_source_status !== 'AVAILABLE') {
    throw new ConflictError(
      `El medio de pago está ${current.psp_source_status}`,
      'PAYMENT_METHOD_NOT_AVAILABLE',
    );
  }
  await db`UPDATE auth.driver SET default_payment_method_id = ${id}, updated_at = now() WHERE id = ${driverId}`;
  return current;
}

/** Medio de pago con el que se cobra: el predeterminado si sirve; si no, el más reciente disponible. */
export async function findChargeablePaymentMethod(
  db: ISql,
  driverId: string,
): Promise<PaymentMethodRow | undefined> {
  const rows = await db<PaymentMethodRow[]>`
    SELECT m.* FROM billing.payment_method m JOIN auth.driver d ON d.id = m.driver_id
    WHERE m.driver_id = ${driverId} AND m.status = 'ACTIVE' AND m.psp_source_status = 'AVAILABLE'
    ORDER BY (m.id = d.default_payment_method_id) DESC, m.created_at DESC LIMIT 1`;
  return rows[0];
}

export async function hasPendingPaymentMethod(db: ISql, driverId: string): Promise<boolean> {
  const rows = await db`
    SELECT 1 FROM billing.payment_method WHERE driver_id = ${driverId} AND status = 'ACTIVE' AND psp_source_status = 'PENDING' LIMIT 1`;
  return rows.length > 0;
}
