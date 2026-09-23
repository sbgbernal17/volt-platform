/**
 * Identidad del conductor en la app Volt (iteración 7, ADR 0022): Identity Platform emite el ID token
 * y la plataforma crea la cuenta en el primer inicio de sesión (`auth.driver.idp_subject`). Una cuenta
 * creada antes por el personal con el mismo correo se vincula solo si el correo llega verificado.
 * Consentimientos (términos y autorización de datos, Ley 1581) con versión, perfil y borrado de la
 * cuenta (anonimización, ADR 0005).
 */
import { randomUUID } from 'node:crypto';
import type { ISql, Sql } from 'postgres';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.ts';
import { resolveParam } from '../pricing/params.ts';
import type { DriverRow } from '../sessions/drivers.ts';
import { appendEvent } from '../sessions/outbox.ts';
import { toJson } from '../types.ts';

export const DRIVER_CONSENT_KEYS = ['terms', 'data_processing', 'marketing'] as const;
export type DriverConsentKey = (typeof DRIVER_CONSENT_KEYS)[number];
/** Sin estos dos no se puede registrar un medio de pago ni iniciar una carga. */
export const REQUIRED_DRIVER_CONSENTS: readonly DriverConsentKey[] = ['terms', 'data_processing'];

export const DRIVER_LOCALES = ['es', 'en'] as const;
export type DriverLocale = (typeof DRIVER_LOCALES)[number];

export interface DriverConsentRecord {
  version: string;
  acceptedAt: string;
  locale: string;
}

export type DriverConsents = Partial<Record<DriverConsentKey, DriverConsentRecord | null>>;

export interface DriverIdentityClaims {
  /** `sub` del ID token (uid de Identity Platform). */
  subject: string;
  email?: string | undefined;
  emailVerified: boolean;
  /** `firebase.sign_in_provider` (password, google.com, apple.com…). */
  provider?: string | undefined;
  displayName?: string | undefined;
}

export interface DriverIdentityResult {
  driver: DriverRow;
  /** La cuenta se creó en este inicio de sesión. */
  created: boolean;
  /** Se vinculó una cuenta que el personal había creado con el mismo correo. */
  bound: boolean;
}

const LOGIN_WRITE_INTERVAL_MS = 5 * 60_000;

/**
 * Resuelve (o crea) el conductor a partir de las reclamaciones del ID token. Nunca devuelve una cuenta
 * anonimizada: al borrar la cuenta se limpia `idp_subject`, así que un nuevo inicio de sesión con la
 * misma identidad crea una cuenta nueva.
 */
export async function resolveDriverIdentity(
  db: ISql,
  tenantId: string,
  claims: DriverIdentityClaims,
  now = new Date(),
): Promise<DriverIdentityResult> {
  if (!claims.subject) throw new ValidationError('Token sin sujeto');
  const bySubject = await db<DriverRow[]>`
    SELECT * FROM auth.driver WHERE idp_subject = ${claims.subject} AND anonymized_at IS NULL`;
  const existing = bySubject[0];
  if (existing) {
    if (existing.tenant_id !== tenantId)
      throw new ForbiddenError('La cuenta pertenece a otro operador');
    return { driver: await touchLogin(db, existing, claims, now), created: false, bound: false };
  }
  const email = claims.email?.trim().toLowerCase();
  if (email) {
    const byEmail = await db<DriverRow[]>`
      SELECT * FROM auth.driver
      WHERE tenant_id = ${tenantId} AND lower(email) = ${email} AND anonymized_at IS NULL`;
    const candidate = byEmail[0];
    if (candidate) {
      if (candidate.idp_subject && candidate.idp_subject !== claims.subject) {
        throw new ConflictError('Ya existe una cuenta con este correo', 'EMAIL_IN_USE');
      }
      // Cuenta creada por el personal (sin identidad): solo se vincula con el correo verificado, para
      // que nadie se apropie de ella registrando ese correo sin demostrar que le pertenece (SEG S4).
      if (!claims.emailVerified) {
        throw new ForbiddenError(
          'Verifique su correo para acceder a esta cuenta',
          'EMAIL_NOT_VERIFIED',
        );
      }
      const rows = await db<DriverRow[]>`
        UPDATE auth.driver SET
          idp_subject = ${claims.subject}, idp_provider = ${claims.provider ?? null}, email_verified = true,
          display_name = COALESCE(display_name, ${claims.displayName ?? null}),
          last_login_at = ${now}, updated_at = now()
        WHERE id = ${candidate.id} RETURNING *`;
      return { driver: rows[0] as DriverRow, created: false, bound: true };
    }
  }
  const rows = await db<DriverRow[]>`
    INSERT INTO auth.driver (id, tenant_id, idp_subject, idp_provider, email, email_verified, display_name, locale, last_login_at)
    VALUES (${randomUUID()}, ${tenantId}, ${claims.subject}, ${claims.provider ?? null}, ${email ?? null},
            ${claims.emailVerified && Boolean(email)}, ${claims.displayName ?? null}, 'es', ${now})
    RETURNING *`;
  return { driver: rows[0] as DriverRow, created: true, bound: false };
}

/** Actualiza correo verificado, correo y último acceso (este último a lo sumo una vez cada 5 minutos). */
async function touchLogin(
  db: ISql,
  driver: DriverRow,
  claims: DriverIdentityClaims,
  now: Date,
): Promise<DriverRow> {
  const email = claims.email?.trim().toLowerCase();
  const verified = claims.emailVerified && Boolean(email);
  const emailChanged = Boolean(email) && verified && email !== (driver.email ?? '').toLowerCase();
  const loginStale =
    !driver.last_login_at ||
    now.getTime() - driver.last_login_at.getTime() > LOGIN_WRITE_INTERVAL_MS;
  if (driver.email_verified === verified && !emailChanged && !loginStale) return driver;
  if (emailChanged) {
    const clash = await db`
      SELECT 1 FROM auth.driver
      WHERE tenant_id = ${driver.tenant_id} AND lower(email) = ${email as string} AND anonymized_at IS NULL AND id <> ${driver.id}`;
    if (clash.length > 0)
      throw new ConflictError('Ya existe una cuenta con este correo', 'EMAIL_IN_USE');
  }
  const rows = await db<DriverRow[]>`
    UPDATE auth.driver SET
      email_verified = ${verified},
      email = ${emailChanged ? (email as string) : driver.email},
      idp_provider = COALESCE(${claims.provider ?? null}, idp_provider),
      last_login_at = ${loginStale ? now : driver.last_login_at},
      updated_at = now()
    WHERE id = ${driver.id} RETURNING *`;
  return rows[0] as DriverRow;
}

export interface DriverProfilePatch {
  displayName?: string | null | undefined;
  phone?: string | null | undefined;
  locale?: DriverLocale | undefined;
}

export async function updateDriverProfile(
  db: ISql,
  driverId: string,
  patch: DriverProfilePatch,
): Promise<DriverRow> {
  const rows = await db<DriverRow[]>`
    UPDATE auth.driver SET
      display_name = CASE WHEN ${patch.displayName !== undefined} THEN ${patch.displayName ?? null} ELSE display_name END,
      phone = CASE WHEN ${patch.phone !== undefined} THEN ${patch.phone ?? null} ELSE phone END,
      locale = COALESCE(${patch.locale ?? null}, locale),
      updated_at = now()
    WHERE id = ${driverId} AND anonymized_at IS NULL RETURNING *`;
  const row = rows[0];
  if (!row) throw new NotFoundError('driver', driverId);
  return row;
}

export function driverConsents(driver: Pick<DriverRow, 'consents'>): DriverConsents {
  const raw = (driver.consents ?? {}) as Record<string, unknown>;
  const result: DriverConsents = {};
  for (const key of DRIVER_CONSENT_KEYS) {
    const value = raw[key];
    result[key] =
      value &&
      typeof value === 'object' &&
      typeof (value as DriverConsentRecord).version === 'string'
        ? (value as DriverConsentRecord)
        : null;
  }
  return result;
}

/** Consentimientos obligatorios que faltan o que están en una versión distinta de la vigente. */
export function pendingConsents(
  driver: Pick<DriverRow, 'consents'>,
  version: string,
): DriverConsentKey[] {
  const consents = driverConsents(driver);
  return REQUIRED_DRIVER_CONSENTS.filter((key) => consents[key]?.version !== version);
}

export async function currentConsentVersion(db: ISql, tenantId: string): Promise<string> {
  return String(await resolveParam<string>(db, 'auth.driver_consent_version', { tenantId }));
}

export interface ConsentInput {
  accept: readonly DriverConsentKey[];
  revoke?: readonly DriverConsentKey[] | undefined;
  version: string;
  locale: string;
}

/** Registra aceptaciones (con versión y fecha) y revocaciones; los obligatorios no se revocan aquí. */
export async function recordDriverConsents(
  db: ISql,
  driverId: string,
  input: ConsentInput,
  now = new Date(),
): Promise<DriverRow> {
  for (const key of input.revoke ?? []) {
    if (REQUIRED_DRIVER_CONSENTS.includes(key)) {
      throw new ValidationError(
        `El consentimiento ${key} es obligatorio; para retirarlo elimine la cuenta`,
      );
    }
  }
  const rows = await db<
    DriverRow[]
  >`SELECT * FROM auth.driver WHERE id = ${driverId} AND anonymized_at IS NULL`;
  const driver = rows[0];
  if (!driver) throw new NotFoundError('driver', driverId);
  const next: Record<string, DriverConsentRecord | null> = {
    ...(driver.consents as Record<string, DriverConsentRecord | null>),
  };
  for (const key of input.accept) {
    next[key] = { version: input.version, acceptedAt: now.toISOString(), locale: input.locale };
  }
  for (const key of input.revoke ?? []) next[key] = null;
  const updated = await db<DriverRow[]>`
    UPDATE auth.driver SET consents = ${toJson(db as never, next)}, updated_at = now()
    WHERE id = ${driverId} RETURNING *`;
  return updated[0] as DriverRow;
}

/**
 * Borrado de la cuenta (derecho de supresión, Ley 1581; retención de ADR 0005): se anonimizan los
 * datos personales, se retiran los medios de pago y los dispositivos y se conserva el historial de
 * sesiones y recibos sin datos personales (obligación tributaria). No se permite con cargas en curso
 * o sin liquidar ni con deudas abiertas.
 */
export async function anonymizeDriver(
  db: Sql,
  driverId: string,
  options: { actor: string; now?: Date | undefined },
): Promise<DriverRow> {
  const now = options.now ?? new Date();
  return db.begin(async (tx) => {
    const rows = await tx<DriverRow[]>`SELECT * FROM auth.driver WHERE id = ${driverId} FOR UPDATE`;
    const driver = rows[0];
    if (!driver) throw new NotFoundError('driver', driverId);
    if (driver.anonymized_at) return driver;
    const open = await tx<{ id: string; state: string }[]>`
      SELECT id, state::text FROM sessions.charging_session
      WHERE driver_id = ${driverId}
        AND state::text NOT IN ('PAID','FAILED','CANCELLED','EXPIRED')
        AND NOT (state::text = 'SETTLED' AND payment_status = 'WAIVED')
      LIMIT 1`;
    if (open.length > 0) {
      throw new ConflictError(
        'Hay una carga en curso o pendiente de cobro; espere a que termine para eliminar la cuenta',
        'ACTIVE_SESSION',
        { sessionId: open[0]?.id, state: open[0]?.state },
      );
    }
    const debts =
      await tx`SELECT 1 FROM billing.debt WHERE driver_id = ${driverId} AND status = 'OPEN' LIMIT 1`;
    if (debts.length > 0) {
      throw new ConflictError(
        'Tiene un cobro pendiente; páguelo antes de eliminar la cuenta',
        'DEBT_PENDING',
      );
    }
    await tx`
      UPDATE billing.payment_method SET status = 'REMOVED', removed_at = COALESCE(removed_at, ${now}), customer_email = NULL, updated_at = now()
      WHERE driver_id = ${driverId} AND status <> 'REMOVED'`;
    await tx`
      UPDATE auth.driver_device SET status = 'REMOVED', device_name = NULL, updated_at = now()
      WHERE driver_id = ${driverId} AND status <> 'REMOVED'`;
    await tx`DELETE FROM auth.driver_notification WHERE driver_id = ${driverId}`;
    await tx`
      UPDATE auth.id_token SET status = 'INVALID' WHERE driver_id = ${driverId} AND status = 'ACTIVE'`;
    const updated = await tx<DriverRow[]>`
      UPDATE auth.driver SET
        email = NULL, phone = NULL, display_name = NULL, idp_subject = NULL, idp_provider = NULL,
        email_verified = false, consents = '{}'::jsonb, default_payment_method_id = NULL,
        status = 'DELETED', anonymized_at = ${now}, updated_at = now()
      WHERE id = ${driverId} RETURNING *`;
    await appendEvent(tx, {
      name: 'driver.anonymized',
      tenantId: driver.tenant_id,
      aggregate: { type: 'driver', id: driverId },
      occurredAt: now,
      payload: { driverId, requestedBy: options.actor },
    });
    return updated[0] as DriverRow;
  });
}
