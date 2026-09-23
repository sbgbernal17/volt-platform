/**
 * Personal del back-office (FUN M13, ADR 0021): invitación por correo con rol, vinculación con la
 * identidad de Identity Platform en el primer inicio de sesión con correo verificado, alta, baja y
 * cambio de rol. Nunca se guardan contraseñas: la identidad la emite Identity Platform.
 */
import { randomUUID } from 'node:crypto';
import type { ISql } from 'postgres';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.ts';
import { isStaffRole, SCOPED_ROLES, type StaffRole } from './rbac.ts';

export type StaffStatus = 'INVITED' | 'ACTIVE' | 'DISABLED';

export interface StaffUserRow {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string | null;
  role: StaffRole;
  site_ids: string[];
  status: StaffStatus;
  idp_subject: string | null;
  idp_provider: string | null;
  mfa_enrolled: boolean;
  locale: 'es' | 'en';
  invited_by: string;
  invited_at: Date;
  activated_at: Date | null;
  last_login_at: Date | null;
  disabled_at: Date | null;
  disabled_reason: string | null;
  updated_at: Date;
}

export interface CreateStaffInput {
  tenantId: string;
  email: string;
  role: StaffRole;
  displayName?: string | undefined;
  siteIds?: string[] | undefined;
  locale?: 'es' | 'en' | undefined;
  invitedBy: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (!EMAIL.test(value) || value.length > 254) throw new ValidationError('Correo inválido');
  return value;
}

function siteIdsFor(role: StaffRole, siteIds: string[] | undefined): string[] {
  if (!SCOPED_ROLES.includes(role)) return [];
  const ids = [...new Set(siteIds ?? [])];
  if (ids.length === 0) throw new ValidationError('El rol SITE_OWNER necesita al menos una sede');
  return ids;
}

export async function createStaffUser(db: ISql, input: CreateStaffInput): Promise<StaffUserRow> {
  if (!isStaffRole(input.role)) throw new ValidationError(`Rol desconocido: ${String(input.role)}`);
  const email = normalizeEmail(input.email);
  const existing = await db`
    SELECT 1 FROM auth.staff_user WHERE tenant_id = ${input.tenantId} AND lower(email) = ${email}`;
  if (existing.length > 0) throw new ConflictError(`Ya existe personal con el correo ${email}`);
  const rows = await db<StaffUserRow[]>`
    INSERT INTO auth.staff_user (id, tenant_id, email, display_name, role, site_ids, locale, invited_by)
    VALUES (${randomUUID()}, ${input.tenantId}, ${email}, ${input.displayName ?? null}, ${input.role},
            ${siteIdsFor(input.role, input.siteIds)}::uuid[], ${input.locale ?? 'es'}, ${input.invitedBy})
    RETURNING *`;
  return rows[0] as StaffUserRow;
}

export async function listStaffUsers(db: ISql, tenantId: string): Promise<StaffUserRow[]> {
  return db<StaffUserRow[]>`
    SELECT * FROM auth.staff_user WHERE tenant_id = ${tenantId} ORDER BY status, lower(email)`;
}

export async function getStaffUser(db: ISql, id: string): Promise<StaffUserRow> {
  const rows = await db<StaffUserRow[]>`SELECT * FROM auth.staff_user WHERE id = ${id}`;
  const row = rows[0];
  if (!row) throw new NotFoundError('staff_user', id);
  return row;
}

export async function findStaffBySubject(
  db: ISql,
  subject: string,
): Promise<StaffUserRow | undefined> {
  const rows = await db<StaffUserRow[]>`
    SELECT * FROM auth.staff_user WHERE idp_subject = ${subject}`;
  return rows[0];
}

export async function countActiveAdmins(db: ISql, tenantId: string): Promise<number> {
  const rows = await db<{ n: number }[]>`
    SELECT count(*)::int AS n FROM auth.staff_user
    WHERE tenant_id = ${tenantId} AND role = 'ADMIN' AND status <> 'DISABLED'`;
  return rows[0]?.n ?? 0;
}

export interface UpdateStaffInput {
  role?: StaffRole | undefined;
  siteIds?: string[] | undefined;
  displayName?: string | null | undefined;
  locale?: 'es' | 'en' | undefined;
  status?: 'ACTIVE' | 'DISABLED' | undefined;
  reason?: string | undefined;
}

/**
 * Cambia rol, alcance, nombre, idioma o estado. Reglas: nadie se deshabilita a sí mismo, y siempre
 * queda al menos un administrador activo en el tenant.
 */
export async function updateStaffUser(
  db: ISql,
  id: string,
  input: UpdateStaffInput,
  actorStaffId: string | null,
): Promise<StaffUserRow> {
  const current = await getStaffUser(db, id);
  const role = input.role ?? current.role;
  if (!isStaffRole(role)) throw new ValidationError(`Rol desconocido: ${String(role)}`);
  const status = input.status ?? (current.status === 'DISABLED' ? 'DISABLED' : current.status);
  if (input.status === 'DISABLED' && actorStaffId === id) {
    throw new ForbiddenError('No puedes deshabilitar tu propia cuenta', 'SELF_DISABLE');
  }
  const losesAdmin =
    current.role === 'ADMIN' &&
    current.status !== 'DISABLED' &&
    (role !== 'ADMIN' || status === 'DISABLED');
  if (losesAdmin && (await countActiveAdmins(db, current.tenant_id)) <= 1) {
    throw new ConflictError('Debe quedar al menos un administrador activo', 'LAST_ADMIN');
  }
  const siteIds = siteIdsFor(role, input.siteIds ?? current.site_ids);
  const nextStatus: StaffStatus =
    input.status === 'DISABLED'
      ? 'DISABLED'
      : input.status === 'ACTIVE'
        ? current.idp_subject
          ? 'ACTIVE'
          : 'INVITED'
        : current.status;
  const rows = await db<StaffUserRow[]>`
    UPDATE auth.staff_user
    SET role = ${role}, site_ids = ${siteIds}::uuid[],
        display_name = ${input.displayName === undefined ? current.display_name : input.displayName},
        locale = ${input.locale ?? current.locale},
        status = ${nextStatus},
        disabled_at = ${nextStatus === 'DISABLED' ? (current.disabled_at ?? new Date()) : null},
        disabled_reason = ${nextStatus === 'DISABLED' ? (input.reason ?? current.disabled_reason) : null},
        updated_at = now()
    WHERE id = ${id}
    RETURNING *`;
  return rows[0] as StaffUserRow;
}

export interface BindIdentityInput {
  subject: string;
  email: string | undefined;
  emailVerified: boolean;
  provider: string | undefined;
}

/**
 * Primer inicio de sesión: enlaza el `sub` de Identity Platform con la invitación cuyo correo
 * coincide. Exige correo verificado para que nadie se apropie de una invitación registrando ese
 * correo sin controlarlo (SEG §3.1).
 */
export async function bindStaffIdentity(db: ISql, input: BindIdentityInput): Promise<StaffUserRow> {
  const bySubject = await findStaffBySubject(db, input.subject);
  if (bySubject) return bySubject;
  if (!input.email) throw new ForbiddenError('El token no trae correo', 'STAFF_NOT_INVITED');
  const email = input.email.trim().toLowerCase();
  const rows = await db<StaffUserRow[]>`
    SELECT * FROM auth.staff_user WHERE lower(email) = ${email} ORDER BY invited_at DESC LIMIT 1`;
  const invited = rows[0];
  if (!invited) {
    throw new ForbiddenError(
      `El correo ${email} no tiene invitación al back-office`,
      'STAFF_NOT_INVITED',
    );
  }
  if (invited.status === 'DISABLED') {
    throw new ForbiddenError('La cuenta está deshabilitada', 'STAFF_DISABLED');
  }
  if (invited.idp_subject && invited.idp_subject !== input.subject) {
    throw new ForbiddenError('El correo ya está vinculado a otra identidad', 'STAFF_ALREADY_BOUND');
  }
  if (!input.emailVerified) {
    throw new ForbiddenError(
      'Verifica tu correo en Identity Platform antes de entrar al back-office',
      'EMAIL_NOT_VERIFIED',
    );
  }
  const updated = await db<StaffUserRow[]>`
    UPDATE auth.staff_user
    SET idp_subject = ${input.subject}, idp_provider = ${input.provider ?? null},
        status = 'ACTIVE', activated_at = COALESCE(activated_at, now()), updated_at = now()
    WHERE id = ${invited.id} AND idp_subject IS NULL
    RETURNING *`;
  const row = updated[0];
  if (!row) throw new ConflictError('La invitación ya fue vinculada', 'STAFF_ALREADY_BOUND');
  return row;
}

/** Registra el inicio de sesión (como máximo una escritura cada cinco minutos) y si trajo MFA. */
export async function recordStaffLogin(db: ISql, id: string, mfa: boolean): Promise<void> {
  await db`
    UPDATE auth.staff_user
    SET last_login_at = now(), mfa_enrolled = ${mfa}, updated_at = now()
    WHERE id = ${id}
      AND (last_login_at IS NULL OR last_login_at < now() - interval '5 minutes' OR mfa_enrolled <> ${mfa})`;
}

/** Sin personal registrado, crea la primera invitación de administrador (arranque del ambiente). */
export async function bootstrapFirstAdmin(
  db: ISql,
  tenantId: string,
  email: string,
): Promise<StaffUserRow | undefined> {
  const rows = await db<{ n: number }[]>`
    SELECT count(*)::int AS n FROM auth.staff_user WHERE tenant_id = ${tenantId}`;
  if ((rows[0]?.n ?? 0) > 0) return undefined;
  return createStaffUser(db, { tenantId, email, role: 'ADMIN', invitedBy: 'system:bootstrap' });
}
