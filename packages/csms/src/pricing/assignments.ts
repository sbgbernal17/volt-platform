/**
 * Asignaciones de tarifa por alcance y segmento y su resolución (TAR §1.3): gana el alcance más
 * específico, luego la prioridad, luego la más reciente; el segmento pedido cae a PUBLIC si no tiene
 * asignación propia; sin ninguna tarifa vigente la resolución falla (fail-closed) salvo INTERNAL.
 */
import { randomUUID } from 'node:crypto';
import type { Adjustment } from '@volt/tariff-engine';
import type { ISql } from 'postgres';
import { CsmsError, NotFoundError, ValidationError } from '../errors.ts';
import { type EvseLiveRow, getEvseById } from '../sessions/locations.ts';
import { appendEvent } from '../sessions/outbox.ts';
import { CONNECTOR_STANDARDS, toJson } from '../types.ts';
import { adjustmentsSchema, segmentSchema } from './schema.ts';
import {
  findEffectiveVersion,
  getTariff,
  recordTariffAudit,
  type TariffRow,
  type TariffVersionRow,
} from './tariffs.ts';

export type AssignmentScopeType =
  | 'PLATFORM'
  | 'TENANT'
  | 'SITE'
  | 'CHARGE_POINT'
  | 'CONNECTOR'
  | 'CONNECTOR_TYPE';

export const ASSIGNMENT_SCOPE_TYPES: AssignmentScopeType[] = [
  'PLATFORM',
  'TENANT',
  'SITE',
  'CHARGE_POINT',
  'CONNECTOR',
  'CONNECTOR_TYPE',
];

/** Menor número = más específico. */
export const SCOPE_SPECIFICITY: Record<AssignmentScopeType, number> = {
  CONNECTOR: 0,
  CHARGE_POINT: 1,
  CONNECTOR_TYPE: 2,
  SITE: 3,
  TENANT: 4,
  PLATFORM: 5,
};

export interface TariffAssignmentRow {
  id: string;
  tenant_id: string;
  scope_type: AssignmentScopeType;
  scope_id: string;
  segment: string;
  tariff_id: string;
  adjustments: Adjustment[];
  priority: number;
  valid_from: Date;
  valid_to: Date | null;
  created_by: string;
  created_at: Date;
}

export class NoTariffError extends CsmsError {
  constructor(evseCode: string, segment: string, details?: unknown) {
    super(
      `No hay tarifa vigente para ${evseCode} (segmento ${segment}); no se puede iniciar sin precio`,
      409,
      'NO_TARIFF',
      details,
    );
  }
}

export interface CreateAssignmentInput {
  tenantId: string;
  scopeType: AssignmentScopeType;
  scopeId?: string | undefined;
  segment: string;
  tariffId: string;
  adjustments?: unknown;
  priority?: number | undefined;
  validFrom?: Date | undefined;
  validTo?: Date | null | undefined;
  createdBy: string;
}

export async function createAssignment(
  db: ISql,
  input: CreateAssignmentInput,
): Promise<TariffAssignmentRow> {
  const segment = segmentSchema.parse(input.segment);
  const adjustments = adjustmentsSchema.parse(input.adjustments ?? []);
  const tariff = await getTariff(db, input.tariffId);
  if (tariff.tenant_id !== input.tenantId) throw new NotFoundError('tariff', input.tariffId);
  const scopeId = await resolveScopeId(db, input);
  const validFrom = input.validFrom ?? new Date();
  const validTo = input.validTo ?? null;
  if (validTo && validTo <= validFrom)
    throw new ValidationError('validTo debe ser posterior a validFrom');
  const rows = await db<TariffAssignmentRow[]>`
    INSERT INTO tariffs.tariff_assignment
      (id, tenant_id, scope_type, scope_id, segment, tariff_id, adjustments, priority, valid_from, valid_to, created_by)
    VALUES (${randomUUID()}, ${input.tenantId}, ${input.scopeType}, ${scopeId}, ${segment}, ${tariff.id},
            ${toJson(db as never, adjustments)}, ${input.priority ?? 0}, ${validFrom}, ${validTo}, ${input.createdBy})
    RETURNING *`;
  const row = rows[0] as TariffAssignmentRow;
  await recordTariffAudit(db, {
    tenantId: input.tenantId,
    entity: 'tariff_assignment',
    entityId: row.id,
    action: 'CREATE',
    actor: input.createdBy,
    after: row,
  });
  await appendEvent(db, {
    name: 'tariff.assigned',
    tenantId: input.tenantId,
    aggregate: { type: 'tariff', id: tariff.id },
    payload: {
      assignmentId: row.id,
      tariffId: tariff.id,
      code: tariff.code,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      segment: row.segment,
      priority: row.priority,
      validFrom: row.valid_from.toISOString(),
      validTo: row.valid_to?.toISOString() ?? null,
    },
  });
  return row;
}

async function resolveScopeId(db: ISql, input: CreateAssignmentInput): Promise<string> {
  switch (input.scopeType) {
    case 'PLATFORM':
      return '*';
    case 'TENANT':
      return input.tenantId;
    case 'CONNECTOR_TYPE': {
      if (!input.scopeId || !(CONNECTOR_STANDARDS as readonly string[]).includes(input.scopeId)) {
        throw new ValidationError(
          'CONNECTOR_TYPE necesita un estándar de conector válido en scopeId',
          {
            allowed: CONNECTOR_STANDARDS,
          },
        );
      }
      return input.scopeId;
    }
    case 'SITE': {
      const rows = await db<{ id: string }[]>`
        SELECT id FROM assets.site WHERE id = ${requireUuid(input.scopeId)} AND tenant_id = ${input.tenantId}`;
      if (!rows[0]) throw new NotFoundError('site', input.scopeId ?? '');
      return rows[0].id;
    }
    case 'CHARGE_POINT': {
      const rows = await db<{ id: string }[]>`
        SELECT id FROM assets.charge_point WHERE id = ${requireUuid(input.scopeId)} AND tenant_id = ${input.tenantId}`;
      if (!rows[0]) throw new NotFoundError('charge_point', input.scopeId ?? '');
      return rows[0].id;
    }
    case 'CONNECTOR': {
      const rows = await db<{ id: string }[]>`
        SELECT c.id FROM assets.connector c JOIN assets.charge_point cp ON cp.id = c.charge_point_id
        WHERE c.id = ${requireUuid(input.scopeId)} AND cp.tenant_id = ${input.tenantId}`;
      if (!rows[0]) throw new NotFoundError('connector', input.scopeId ?? '');
      return rows[0].id;
    }
  }
}

function requireUuid(value: string | undefined): string {
  if (!value || !/^[0-9a-f-]{36}$/i.test(value))
    throw new ValidationError('scopeId debe ser un uuid');
  return value;
}

export interface AssignmentFilter {
  scopeType?: AssignmentScopeType | undefined;
  scopeId?: string | undefined;
  segment?: string | undefined;
  tariffId?: string | undefined;
  /** Incluye las asignaciones cuya vigencia ya terminó. */
  includeEnded?: boolean | undefined;
  /** Solo las vigentes en ese instante (por defecto: las no terminadas, aunque empiecen después). */
  activeAt?: Date | undefined;
}

export async function listAssignments(
  db: ISql,
  tenantId: string,
  filter: AssignmentFilter = {},
): Promise<TariffAssignmentRow[]> {
  return db<TariffAssignmentRow[]>`
    SELECT * FROM tariffs.tariff_assignment
    WHERE tenant_id = ${tenantId}
      AND (${filter.scopeType ?? null}::text IS NULL OR scope_type = ${filter.scopeType ?? null})
      AND (${filter.scopeId ?? null}::text IS NULL OR scope_id = ${filter.scopeId ?? null})
      AND (${filter.segment ?? null}::text IS NULL OR segment = ${filter.segment ?? null})
      AND (${filter.tariffId ?? null}::uuid IS NULL OR tariff_id = ${filter.tariffId ?? null})
      AND (${filter.includeEnded ?? false} OR valid_to IS NULL OR valid_to > ${filter.activeAt ?? new Date()})
      AND (${filter.activeAt === undefined} OR valid_from <= ${filter.activeAt ?? new Date()})
    ORDER BY scope_type, segment, priority DESC, created_at DESC`;
}

export async function getAssignment(db: ISql, id: string): Promise<TariffAssignmentRow> {
  const rows = await db<
    TariffAssignmentRow[]
  >`SELECT * FROM tariffs.tariff_assignment WHERE id = ${id}`;
  const row = rows[0];
  if (!row) throw new NotFoundError('tariff_assignment', id);
  return row;
}

/** Termina la vigencia de una asignación (no se borra: las sesiones pasadas la referencian en su snapshot). */
export async function endAssignment(
  db: ISql,
  input: { id: string; tenantId: string; actor: string; now?: Date | undefined },
): Promise<TariffAssignmentRow> {
  const now = input.now ?? new Date();
  const current = await getAssignment(db, input.id);
  if (current.tenant_id !== input.tenantId) throw new NotFoundError('tariff_assignment', input.id);
  if (current.valid_to && current.valid_to <= now) return current;
  const validTo = current.valid_from > now ? current.valid_from : now;
  const rows = await db<TariffAssignmentRow[]>`
    UPDATE tariffs.tariff_assignment SET valid_to = ${validTo} WHERE id = ${input.id} RETURNING *`;
  await recordTariffAudit(db, {
    tenantId: input.tenantId,
    entity: 'tariff_assignment',
    entityId: input.id,
    action: 'END',
    actor: input.actor,
    before: { valid_to: current.valid_to },
    after: { valid_to: validTo },
  });
  return rows[0] as TariffAssignmentRow;
}

export interface ResolutionCandidate {
  assignmentId: string;
  scopeType: AssignmentScopeType;
  scopeId: string;
  segment: string;
  priority: number;
  tariffId: string;
  chosen: boolean;
  reason: string;
}

export type TariffResolution =
  | {
      kind: 'TARIFF';
      evse: EvseLiveRow;
      segmentRequested: string;
      segmentUsed: string;
      assignment: TariffAssignmentRow;
      tariff: TariffRow;
      version: TariffVersionRow;
      adjustments: Adjustment[];
      candidates: ResolutionCandidate[];
      at: Date;
    }
  | {
      kind: 'INTERNAL';
      evse: EvseLiveRow;
      segmentRequested: 'INTERNAL';
      segmentUsed: 'INTERNAL';
      candidates: ResolutionCandidate[];
      at: Date;
    };

export interface ResolveTariffInput {
  tenantId: string;
  evseId: string;
  segment: string;
  at?: Date | undefined;
}

/** Resolución explicable de la tarifa de un EVSE para un segmento en un instante (TAR §1.3, T11). */
export async function resolveTariff(
  db: ISql,
  input: ResolveTariffInput,
): Promise<TariffResolution> {
  const at = input.at ?? new Date();
  const segment = segmentSchema.parse(input.segment);
  const evse = await getEvseById(db, input.evseId);
  const rows = await db<TariffAssignmentRow[]>`
    SELECT * FROM tariffs.tariff_assignment
    WHERE tenant_id = ${input.tenantId}
      AND segment IN (${segment}, 'PUBLIC')
      AND valid_from <= ${at} AND (valid_to IS NULL OR valid_to > ${at})
      AND ((scope_type = 'PLATFORM')
        OR (scope_type = 'TENANT' AND scope_id = ${input.tenantId})
        OR (scope_type = 'SITE' AND scope_id = ${evse.site_id})
        OR (scope_type = 'CHARGE_POINT' AND scope_id = ${evse.charge_point_id})
        OR (scope_type = 'CONNECTOR' AND scope_id = ${evse.connector_uuid})
        OR (scope_type = 'CONNECTOR_TYPE' AND scope_id = ${evse.standard}))`;
  const ordered = rows
    .filter((row) => segment !== 'INTERNAL' || row.segment === 'INTERNAL')
    .sort(
      (a, b) =>
        Number(a.segment !== segment) - Number(b.segment !== segment) ||
        SCOPE_SPECIFICITY[a.scope_type] - SCOPE_SPECIFICITY[b.scope_type] ||
        b.priority - a.priority ||
        b.created_at.getTime() - a.created_at.getTime(),
    );
  const candidates: ResolutionCandidate[] = [];
  let chosen: { assignment: TariffAssignmentRow; version: TariffVersionRow } | undefined;
  for (const assignment of ordered) {
    const candidate: ResolutionCandidate = {
      assignmentId: assignment.id,
      scopeType: assignment.scope_type,
      scopeId: assignment.scope_id,
      segment: assignment.segment,
      priority: assignment.priority,
      tariffId: assignment.tariff_id,
      chosen: false,
      reason: '',
    };
    if (chosen) {
      candidate.reason = 'menos específica, menor prioridad o más antigua';
    } else {
      const version = await findEffectiveVersion(db, assignment.tariff_id, at);
      if (version) {
        chosen = { assignment, version };
        candidate.chosen = true;
        candidate.reason =
          assignment.segment === segment
            ? 'asignación más específica del segmento'
            : 'respaldo PUBLIC';
      } else {
        candidate.reason = 'la tarifa no tiene versión vigente';
      }
    }
    candidates.push(candidate);
  }
  if (!chosen) {
    if (segment === 'INTERNAL') {
      return {
        kind: 'INTERNAL',
        evse,
        segmentRequested: 'INTERNAL',
        segmentUsed: 'INTERNAL',
        candidates,
        at,
      };
    }
    throw new NoTariffError(evse.evse_code, segment, { candidates });
  }
  const tariff = await getTariff(db, chosen.assignment.tariff_id);
  return {
    kind: 'TARIFF',
    evse,
    segmentRequested: segment,
    segmentUsed: chosen.assignment.segment,
    assignment: chosen.assignment,
    tariff,
    version: chosen.version,
    adjustments: chosen.assignment.adjustments,
    candidates,
    at,
  };
}
