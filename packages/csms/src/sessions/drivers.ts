import { randomUUID } from 'node:crypto';
import type { ISql } from 'postgres';
import { ConflictError, NotFoundError } from '../errors.ts';

export interface DriverRow {
  id: string;
  tenant_id: string;
  idp_subject: string | null;
  email: string | null;
  phone: string | null;
  display_name: string | null;
  locale: string;
  segment: string;
  status: 'ACTIVE' | 'BLOCKED' | 'DELETED';
  default_payment_method_id: string | null;
  /** Iteración 5: bloqueo por deuda o manual (ADR 0002). */
  billing_status: 'OK' | 'BLOCKED_DEBT' | 'BLOCKED_MANUAL';
  blocked_reason: string | null;
  blocked_at: Date | null;
  created_at: Date;
}

export interface CreateDriverInput {
  tenantId: string;
  email?: string | undefined;
  phone?: string | undefined;
  displayName?: string | undefined;
  locale?: string | undefined;
  idpSubject?: string | undefined;
}

export async function createDriver(db: ISql, input: CreateDriverInput): Promise<DriverRow> {
  if (input.email) {
    const existing = await db`
      SELECT 1 FROM auth.driver WHERE tenant_id = ${input.tenantId} AND lower(email) = lower(${input.email}) AND anonymized_at IS NULL`;
    if (existing.length > 0)
      throw new ConflictError(`Ya existe un conductor con el correo ${input.email}`);
  }
  const rows = await db<DriverRow[]>`
    INSERT INTO auth.driver (id, tenant_id, idp_subject, email, phone, display_name, locale)
    VALUES (${randomUUID()}, ${input.tenantId}, ${input.idpSubject ?? null}, ${input.email ?? null},
            ${input.phone ?? null}, ${input.displayName ?? null}, ${input.locale ?? 'es'})
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
