/**
 * Tarifas lógicas y versiones inmutables (TAR §1.5, §2.4): borrador → programada/activa → retirada.
 * Cada versión guarda la definición OCPI validada, su hash canónico y quién la creó y aprobó; todo
 * cambio deja rastro en `tariffs.tariff_audit` y emite un evento de dominio.
 */
import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256Hex, type Tariff } from '@volt/tariff-engine';
import type { ISql, Sql } from 'postgres';
import { ConflictError, NotFoundError, ValidationError } from '../errors.ts';
import { appendEvent } from '../sessions/outbox.ts';
import { toJson } from '../types.ts';
import { validateTariffDefinition } from './schema.ts';

export type TariffVersionStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'RETIRED';

export interface TariffRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  currency: string;
  created_by: string;
  created_at: Date;
}

export interface TariffListRow extends TariffRow {
  versions: number;
  active_version: number | null;
}

export interface TariffVersionRow {
  id: string;
  tariff_id: string;
  version: number;
  status: TariffVersionStatus;
  valid_from: Date | null;
  valid_to: Date | null;
  tax_included: boolean;
  definition: Tariff;
  definition_hash: string;
  notes: string | null;
  created_by: string;
  approved_by: string | null;
  created_at: Date;
  published_at: Date | null;
  retired_at: Date | null;
}

export interface TariffAuditRow {
  id: bigint;
  tenant_id: string;
  entity: string;
  entity_id: string;
  action: string;
  actor: string;
  at: Date;
  before: unknown;
  after: unknown;
}

const TARIFF_CODE = /^[A-Z0-9][A-Z0-9_-]{1,35}$/;

export async function recordTariffAudit(
  db: ISql,
  input: {
    tenantId: string;
    entity: 'tariff' | 'tariff_version' | 'tariff_assignment' | 'parameter';
    entityId: string;
    action: string;
    actor: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await db`
    INSERT INTO tariffs.tariff_audit (tenant_id, entity, entity_id, action, actor, before, after)
    VALUES (${input.tenantId}, ${input.entity}, ${input.entityId}, ${input.action}, ${input.actor},
            ${input.before === undefined ? null : toJson(db as never, input.before)},
            ${input.after === undefined ? null : toJson(db as never, input.after)})`;
}

export async function listTariffAudit(
  db: ISql,
  tenantId: string,
  filter: {
    entity?: string | undefined;
    entityId?: string | undefined;
    limit?: number | undefined;
  } = {},
): Promise<TariffAuditRow[]> {
  return db<TariffAuditRow[]>`
    SELECT * FROM tariffs.tariff_audit
    WHERE tenant_id = ${tenantId}
      AND (${filter.entity ?? null}::text IS NULL OR entity = ${filter.entity ?? null})
      AND (${filter.entityId ?? null}::text IS NULL OR entity_id = ${filter.entityId ?? null})
    ORDER BY at DESC, id DESC LIMIT ${filter.limit ?? 100}`;
}

export interface CreateTariffInput {
  tenantId: string;
  code: string;
  name: string;
  currency: string;
  createdBy: string;
}

export async function createTariff(db: ISql, input: CreateTariffInput): Promise<TariffRow> {
  if (!TARIFF_CODE.test(input.code)) {
    throw new ValidationError(
      'El código de tarifa admite mayúsculas, dígitos, guion y guion bajo (2 a 36 caracteres)',
    );
  }
  if (!/^[A-Z]{3}$/.test(input.currency))
    throw new ValidationError('La moneda debe ser un código ISO 4217');
  const existing = await db<{ id: string }[]>`
    SELECT id FROM tariffs.tariff WHERE tenant_id = ${input.tenantId} AND code = ${input.code}`;
  if (existing[0]) throw new ConflictError(`Ya existe la tarifa ${input.code}`, 'TARIFF_EXISTS');
  const rows = await db<TariffRow[]>`
    INSERT INTO tariffs.tariff (id, tenant_id, code, name, currency, created_by)
    VALUES (${randomUUID()}, ${input.tenantId}, ${input.code}, ${input.name}, ${input.currency}, ${input.createdBy})
    RETURNING *`;
  const row = rows[0] as TariffRow;
  await recordTariffAudit(db, {
    tenantId: input.tenantId,
    entity: 'tariff',
    entityId: row.id,
    action: 'CREATE',
    actor: input.createdBy,
    after: row,
  });
  return row;
}

export async function listTariffs(db: ISql, tenantId: string): Promise<TariffListRow[]> {
  return db<TariffListRow[]>`
    SELECT t.*,
           (SELECT count(*)::int FROM tariffs.tariff_version v WHERE v.tariff_id = t.id) AS versions,
           (SELECT v.version FROM tariffs.tariff_version v
             WHERE v.tariff_id = t.id AND v.status IN ('ACTIVE','SCHEDULED')
               AND v.valid_from <= now() AND (v.valid_to IS NULL OR v.valid_to > now())
             ORDER BY v.valid_from DESC LIMIT 1) AS active_version
    FROM tariffs.tariff t WHERE t.tenant_id = ${tenantId} ORDER BY t.code`;
}

export async function getTariff(db: ISql, tariffId: string): Promise<TariffRow> {
  const rows = await db<TariffRow[]>`SELECT * FROM tariffs.tariff WHERE id = ${tariffId}`;
  const row = rows[0];
  if (!row) throw new NotFoundError('tariff', tariffId);
  return row;
}

export async function findTariffByCode(
  db: ISql,
  tenantId: string,
  code: string,
): Promise<TariffRow | undefined> {
  const rows = await db<
    TariffRow[]
  >`SELECT * FROM tariffs.tariff WHERE tenant_id = ${tenantId} AND code = ${code}`;
  return rows[0];
}

export interface CreateTariffVersionInput {
  tariffId: string;
  definition: unknown;
  taxIncluded?: boolean | undefined;
  notes?: string | undefined;
  createdBy: string;
}

export async function createTariffVersion(
  db: ISql,
  input: CreateTariffVersionInput,
): Promise<TariffVersionRow & { warnings: string[] }> {
  const tariff = await getTariff(db, input.tariffId);
  const validation = validateTariffDefinition(input.definition);
  if (validation.definition.currency !== tariff.currency) {
    throw new ValidationError(
      `La definición usa ${validation.definition.currency} y la tarifa ${tariff.code} está en ${tariff.currency}`,
    );
  }
  const next = await db<{ version: number }[]>`
    SELECT COALESCE(MAX(version), 0) + 1 AS version FROM tariffs.tariff_version WHERE tariff_id = ${tariff.id}`;
  const version = next[0]?.version ?? 1;
  const definition: Tariff = {
    ...validation.definition,
    id: tariff.code,
    version,
    last_updated: new Date().toISOString(),
  };
  const hash = sha256Hex(canonicalJson(definition));
  const rows = await db<TariffVersionRow[]>`
    INSERT INTO tariffs.tariff_version
      (id, tariff_id, version, status, tax_included, definition, definition_hash, notes, created_by)
    VALUES (${randomUUID()}, ${tariff.id}, ${version}, 'DRAFT', ${input.taxIncluded ?? true},
            ${toJson(db as never, definition)}, ${hash}, ${input.notes ?? null}, ${input.createdBy})
    RETURNING *`;
  const row = rows[0] as TariffVersionRow;
  await recordTariffAudit(db, {
    tenantId: tariff.tenant_id,
    entity: 'tariff_version',
    entityId: row.id,
    action: 'CREATE',
    actor: input.createdBy,
    after: { tariffId: tariff.id, version, definition_hash: hash, warnings: validation.warnings },
  });
  return { ...row, warnings: validation.warnings };
}

export async function listTariffVersions(db: ISql, tariffId: string): Promise<TariffVersionRow[]> {
  return db<TariffVersionRow[]>`
    SELECT * FROM tariffs.tariff_version WHERE tariff_id = ${tariffId} ORDER BY version DESC`;
}

export async function getTariffVersion(
  db: ISql,
  tariffId: string,
  version: number,
): Promise<TariffVersionRow> {
  const rows = await db<TariffVersionRow[]>`
    SELECT * FROM tariffs.tariff_version WHERE tariff_id = ${tariffId} AND version = ${version}`;
  const row = rows[0];
  if (!row) throw new NotFoundError('tariff_version', `${tariffId}/${version}`);
  return row;
}

export async function getTariffVersionById(db: ISql, id: string): Promise<TariffVersionRow> {
  const rows = await db<TariffVersionRow[]>`SELECT * FROM tariffs.tariff_version WHERE id = ${id}`;
  const row = rows[0];
  if (!row) throw new NotFoundError('tariff_version', id);
  return row;
}

/** Versión vigente en un instante (ACTIVE, o SCHEDULED cuya vigencia ya empezó aunque el trabajo no la haya activado). */
export async function findEffectiveVersion(
  db: ISql,
  tariffId: string,
  at: Date,
): Promise<TariffVersionRow | undefined> {
  const rows = await db<TariffVersionRow[]>`
    SELECT * FROM tariffs.tariff_version
    WHERE tariff_id = ${tariffId} AND status IN ('ACTIVE','SCHEDULED')
      AND valid_from <= ${at} AND (valid_to IS NULL OR valid_to > ${at})
    ORDER BY valid_from DESC LIMIT 1`;
  return rows[0];
}

export interface PublishTariffVersionInput {
  tariffId: string;
  version: number;
  validFrom?: Date | undefined;
  validTo?: Date | null | undefined;
  approvedBy: string;
  requireFourEyes?: boolean | undefined;
  now?: Date | undefined;
}

/**
 * Publica un borrador: ACTIVE si la vigencia ya empezó, SCHEDULED si empieza después. La versión
 * vigente anterior termina cuando empieza la nueva (nunca dos versiones solapadas: exclusión GiST).
 */
export async function publishTariffVersion(
  sql: Sql,
  input: PublishTariffVersionInput,
): Promise<TariffVersionRow> {
  const now = input.now ?? new Date();
  const validFrom = input.validFrom ?? now;
  const validTo = input.validTo ?? null;
  if (validTo && validTo <= validFrom)
    throw new ValidationError('validTo debe ser posterior a validFrom');
  return sql.begin(async (tx) => {
    const rows = await tx<TariffVersionRow[]>`
      SELECT * FROM tariffs.tariff_version WHERE tariff_id = ${input.tariffId} AND version = ${input.version} FOR UPDATE`;
    const target = rows[0];
    if (!target) throw new NotFoundError('tariff_version', `${input.tariffId}/${input.version}`);
    if (target.status !== 'DRAFT') {
      throw new ConflictError(
        `La versión ${input.version} está en ${target.status}; solo se publica un borrador`,
        'TARIFF_VERSION_NOT_DRAFT',
      );
    }
    if (input.requireFourEyes && target.created_by === input.approvedBy) {
      throw new ConflictError(
        'Quien publica debe ser distinto de quien creó la versión (cuatro ojos)',
        'FOUR_EYES_REQUIRED',
      );
    }
    const tariff = await getTariff(tx, input.tariffId);
    const others = await tx<TariffVersionRow[]>`
      SELECT * FROM tariffs.tariff_version
      WHERE tariff_id = ${input.tariffId} AND status IN ('ACTIVE','SCHEDULED') AND id <> ${target.id} FOR UPDATE`;
    for (const other of others) {
      const otherFrom = other.valid_from as Date;
      const otherTo = other.valid_to;
      const overlaps =
        otherFrom < (validTo ?? new Date(8.64e15)) && (otherTo === null || otherTo > validFrom);
      if (!overlaps) continue;
      if (otherFrom >= validFrom) {
        throw new ConflictError(
          `La versión ${other.version} (${other.status}) empieza en ${otherFrom.toISOString()}; retírala antes de publicar una vigencia que la solape`,
          'TARIFF_OVERLAP',
        );
      }
      const retire = validFrom <= now && other.status === 'ACTIVE';
      await tx`
        UPDATE tariffs.tariff_version
        SET valid_to = ${validFrom}, status = ${retire ? 'RETIRED' : other.status}, retired_at = ${retire ? now : other.retired_at}
        WHERE id = ${other.id}`;
      await recordTariffAudit(tx, {
        tenantId: tariff.tenant_id,
        entity: 'tariff_version',
        entityId: other.id,
        action: retire ? 'RETIRE' : 'END',
        actor: input.approvedBy,
        before: { status: other.status, valid_to: other.valid_to },
        after: {
          status: retire ? 'RETIRED' : other.status,
          valid_to: validFrom,
          reason: `sustituida por la versión ${target.version}`,
        },
      });
    }
    const status: TariffVersionStatus = validFrom > now ? 'SCHEDULED' : 'ACTIVE';
    let updated: TariffVersionRow;
    try {
      const result = await tx<TariffVersionRow[]>`
        UPDATE tariffs.tariff_version
        SET status = ${status}, valid_from = ${validFrom}, valid_to = ${validTo}, approved_by = ${input.approvedBy}, published_at = ${now}
        WHERE id = ${target.id} RETURNING *`;
      updated = result[0] as TariffVersionRow;
    } catch (error) {
      if ((error as { code?: string }).code === '23P01') {
        throw new ConflictError(
          'La vigencia se solapa con otra versión publicada',
          'TARIFF_OVERLAP',
        );
      }
      throw error;
    }
    await recordTariffAudit(tx, {
      tenantId: tariff.tenant_id,
      entity: 'tariff_version',
      entityId: target.id,
      action: 'PUBLISH',
      actor: input.approvedBy,
      before: { status: 'DRAFT' },
      after: {
        status,
        valid_from: validFrom,
        valid_to: validTo,
        definition_hash: target.definition_hash,
      },
    });
    await appendEvent(tx, {
      name: 'tariff.published',
      tenantId: tariff.tenant_id,
      aggregate: { type: 'tariff', id: tariff.id },
      occurredAt: now,
      payload: {
        tariffId: tariff.id,
        code: tariff.code,
        version: target.version,
        status,
        validFrom: validFrom.toISOString(),
        validTo: validTo?.toISOString() ?? null,
        approvedBy: input.approvedBy,
      },
    });
    return updated;
  });
}

export async function retireTariffVersion(
  sql: Sql,
  input: { tariffId: string; version: number; actor: string; now?: Date | undefined },
): Promise<TariffVersionRow> {
  const now = input.now ?? new Date();
  return sql.begin(async (tx) => {
    const rows = await tx<TariffVersionRow[]>`
      SELECT * FROM tariffs.tariff_version WHERE tariff_id = ${input.tariffId} AND version = ${input.version} FOR UPDATE`;
    const target = rows[0];
    if (!target) throw new NotFoundError('tariff_version', `${input.tariffId}/${input.version}`);
    if (target.status !== 'ACTIVE' && target.status !== 'SCHEDULED') {
      throw new ConflictError(
        `La versión está en ${target.status}; solo se retira una versión activa o programada`,
        'TARIFF_VERSION_NOT_ACTIVE',
      );
    }
    const validTo = target.valid_from && target.valid_from > now ? target.valid_from : now;
    const updated = await tx<TariffVersionRow[]>`
      UPDATE tariffs.tariff_version SET status = 'RETIRED', valid_to = ${validTo}, retired_at = ${now}
      WHERE id = ${target.id} RETURNING *`;
    const tariff = await getTariff(tx, input.tariffId);
    await recordTariffAudit(tx, {
      tenantId: tariff.tenant_id,
      entity: 'tariff_version',
      entityId: target.id,
      action: 'RETIRE',
      actor: input.actor,
      before: { status: target.status, valid_to: target.valid_to },
      after: { status: 'RETIRED', valid_to: validTo },
    });
    await appendEvent(tx, {
      name: 'tariff.retired',
      tenantId: tariff.tenant_id,
      aggregate: { type: 'tariff', id: tariff.id },
      occurredAt: now,
      payload: {
        tariffId: tariff.id,
        code: tariff.code,
        version: target.version,
        actor: input.actor,
      },
    });
    return updated[0] as TariffVersionRow;
  });
}

/** Trabajo periódico: SCHEDULED cuya vigencia empezó → ACTIVE; ACTIVE cuya vigencia terminó → RETIRED. */
export async function activateScheduledVersions(
  db: ISql,
  now = new Date(),
): Promise<{ activated: number; retired: number }> {
  const activated = await db`
    UPDATE tariffs.tariff_version SET status = 'ACTIVE'
    WHERE status = 'SCHEDULED' AND valid_from <= ${now} AND (valid_to IS NULL OR valid_to > ${now})`;
  const retired = await db`
    UPDATE tariffs.tariff_version SET status = 'RETIRED', retired_at = ${now}
    WHERE status IN ('ACTIVE','SCHEDULED') AND valid_to IS NOT NULL AND valid_to <= ${now}`;
  return { activated: activated.count, retired: retired.count };
}
