import { randomUUID } from 'node:crypto';
import type { ISql } from 'postgres';
import { ConflictError, NotFoundError } from '../errors.ts';

export interface DriverRow {
  id: string;
  tenant_id: string;
  idp_subject: string | null;
  email: string | null;
  phone: string | null;
  /** Celular verificado por SMS (ADR 0031); NULL si no se ha verificado o cambió después. */
  phone_verified_at: Date | null;
  display_name: string | null;
  /** Nombre y apellidos separados (adquiriente de la factura electrónica); display_name los une. */
  first_name: string | null;
  last_name: string | null;
  locale: string;
  segment: string;
  status: 'ACTIVE' | 'BLOCKED' | 'DELETED';
  default_payment_method_id: string | null;
  /** Iteración 5: bloqueo por deuda o manual (ADR 0002). */
  billing_status: 'OK' | 'BLOCKED_DEBT' | 'BLOCKED_MANUAL';
  blocked_reason: string | null;
  blocked_at: Date | null;
  /** Consentimientos aceptados (términos, datos personales, mercadeo) con versión y fecha (iteración 7). */
  consents: Record<string, unknown>;
  anonymized_at: Date | null;
  /** Iteración 7: identidad en Identity Platform (ADR 0022). */
  email_verified: boolean;
  idp_provider: string | null;
  last_login_at: Date | null;
  /** Documento de identidad y factura electrónica (ADR 0027). */
  document_type: 'CC' | 'CE' | 'NIT' | 'PAS' | 'PPT' | null;
  document_number: string | null;
  wants_invoice: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateDriverInput {
  tenantId: string;
  email?: string | undefined;
  phone?: string | undefined;
  displayName?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  locale?: string | undefined;
  idpSubject?: string | undefined;
}

/** "Juan Carlos Pérez" → nombres "Juan" y apellidos "Carlos Pérez" (reparto por el primer espacio). */
export function splitDisplayName(full: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = (full ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return { firstName: null, lastName: null };
  const [first, ...rest] = trimmed.split(' ');
  return { firstName: first ?? null, lastName: rest.length ? rest.join(' ') : null };
}

export function joinDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  const joined = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ');
  return joined || null;
}

export async function createDriver(db: ISql, input: CreateDriverInput): Promise<DriverRow> {
  if (input.email) {
    const existing = await db`
      SELECT 1 FROM auth.driver WHERE tenant_id = ${input.tenantId} AND lower(email) = lower(${input.email}) AND anonymized_at IS NULL`;
    if (existing.length > 0)
      throw new ConflictError(`Ya existe un conductor con el correo ${input.email}`);
  }
  const names =
    input.firstName !== undefined || input.lastName !== undefined
      ? { firstName: input.firstName?.trim() || null, lastName: input.lastName?.trim() || null }
      : splitDisplayName(input.displayName);
  const displayName = input.displayName?.trim() || joinDisplayName(names.firstName, names.lastName);
  const rows = await db<DriverRow[]>`
    INSERT INTO auth.driver (id, tenant_id, idp_subject, email, phone, display_name, first_name, last_name, locale)
    VALUES (${randomUUID()}, ${input.tenantId}, ${input.idpSubject ?? null}, ${input.email ?? null},
            ${input.phone ?? null}, ${displayName}, ${names.firstName}, ${names.lastName}, ${input.locale ?? 'es'})
    RETURNING *`;
  return rows[0] as DriverRow;
}

export async function getDriver(db: ISql, id: string): Promise<DriverRow> {
  const rows = await db<DriverRow[]>`SELECT * FROM auth.driver WHERE id = ${id}`;
  const row = rows[0];
  if (!row) throw new NotFoundError('driver', id);
  return row;
}

export async function listDrivers(db: ISql, tenantId: string, limit = 100): Promise<DriverRow[]> {
  return db<DriverRow[]>`
    SELECT * FROM auth.driver WHERE tenant_id = ${tenantId} AND anonymized_at IS NULL
    ORDER BY created_at DESC LIMIT ${limit}`;
}
