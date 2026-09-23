/**
 * Auditoría inmutable (FUN M19, SEG §2.8): cada fila lleva `hash = sha256(prev_hash || json canónico)`
 * y la tabla solo admite INSERT. Las escrituras se serializan con un bloqueo consultivo para que la
 * cadena no se bifurque; `verifyAuditChain` recalcula la cadena y localiza la primera fila alterada.
 */
import { createHash } from 'node:crypto';
import type { ISql, Sql } from 'postgres';
import { toJson } from '../types.ts';

export type AuditActorType = 'staff' | 'driver' | 'system' | 'charge_point';
export type AuditOutcome = 'OK' | 'DENIED' | 'ERROR';

export interface AuditEntryInput {
  tenantId?: string | null | undefined;
  actorType: AuditActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  requestId?: string | null | undefined;
  remoteIp?: string | null | undefined;
  userAgent?: string | null | undefined;
  outcome?: AuditOutcome | undefined;
  at?: Date | undefined;
}

export interface AuditLogRow {
  id: bigint;
  ts: Date;
  tenant_id: string | null;
  actor_type: AuditActorType;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  request_id: string | null;
  remote_ip: string | null;
  user_agent: string | null;
  outcome: AuditOutcome;
  prev_hash: Uint8Array;
  hash: Uint8Array;
}

export const GENESIS_HASH: Buffer = Buffer.alloc(32, 0);

/** JSON determinista: claves ordenadas en todos los niveles, sin `undefined`. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/** Contenido cubierto por el hash (sin id ni hashes). Idéntico al insertar y al verificar. */
function hashedPayload(row: {
  ts: Date;
  tenant_id: string | null;
  actor_type: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  request_id: string | null;
  remote_ip: string | null;
  user_agent: string | null;
  outcome: string;
}): string {
  return canonicalJson({
    ts: row.ts.toISOString(),
    tenant_id: row.tenant_id,
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    before: row.before ?? null,
    after: row.after ?? null,
    request_id: row.request_id,
    remote_ip: row.remote_ip,
    user_agent: row.user_agent,
    outcome: row.outcome,
  });
}

export function computeHash(prevHash: Uint8Array, payload: string): Buffer {
  return createHash('sha256').update(prevHash).update(payload, 'utf8').digest();
}

/** Normaliza un valor pasando por JSON (así el hash coincide con lo que devuelve jsonb). */
function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(canonicalJson(value));
}

export async function appendAudit(sql: Sql, input: AuditEntryInput): Promise<AuditLogRow> {
  const ts = input.at ?? new Date();
  const row = {
    ts,
    tenant_id: input.tenantId ?? null,
    actor_type: input.actorType,
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    before: normalize(input.before),
    after: normalize(input.after),
    request_id: input.requestId ?? null,
    remote_ip: input.remoteIp ?? null,
    user_agent: input.userAgent ? input.userAgent.slice(0, 300) : null,
    outcome: input.outcome ?? 'OK',
  };
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('audit.audit_log'))`;
    const last = await tx<{ hash: Uint8Array }[]>`
      SELECT hash FROM audit.audit_log ORDER BY id DESC LIMIT 1`;
    const prevHash = last[0]?.hash ?? GENESIS_HASH;
    const hash = computeHash(prevHash, hashedPayload(row));
    const inserted = await tx<AuditLogRow[]>`
      INSERT INTO audit.audit_log (ts, tenant_id, actor_type, actor_id, action, entity_type, entity_id,
                                   before, after, request_id, remote_ip, user_agent, outcome, prev_hash, hash)
      VALUES (${row.ts}, ${row.tenant_id}, ${row.actor_type}, ${row.actor_id}, ${row.action}, ${row.entity_type},
              ${row.entity_id}, ${row.before === null ? null : toJson(tx as unknown as Sql, row.before)},
              ${row.after === null ? null : toJson(tx as unknown as Sql, row.after)},
              ${row.request_id}, ${row.remote_ip}, ${row.user_agent}, ${row.outcome},
              ${Buffer.from(prevHash)}, ${hash})
      RETURNING *`;
    return inserted[0] as AuditLogRow;
  }) as Promise<AuditLogRow>;
}

export interface AuditFilter {
  tenantId?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  actorId?: string | undefined;
  action?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  beforeId?: bigint | undefined;
  limit?: number | undefined;
}

export async function listAudit(db: ISql, filter: AuditFilter = {}): Promise<AuditLogRow[]> {
  const like = filter.action ? `${filter.action}%` : null;
  return db<AuditLogRow[]>`
    SELECT * FROM audit.audit_log
    WHERE (${filter.tenantId ?? null}::uuid IS NULL OR tenant_id = ${filter.tenantId ?? null})
      AND (${filter.entityType ?? null}::text IS NULL OR entity_type = ${filter.entityType ?? null})
      AND (${filter.entityId ?? null}::text IS NULL OR entity_id = ${filter.entityId ?? null})
      AND (${filter.actorId ?? null}::text IS NULL OR actor_id = ${filter.actorId ?? null})
      AND (${like}::text IS NULL OR action LIKE ${like})
      AND (${filter.from ?? null}::timestamptz IS NULL OR ts >= ${filter.from ?? null})
      AND (${filter.to ?? null}::timestamptz IS NULL OR ts < ${filter.to ?? null})
      AND (${filter.beforeId?.toString() ?? null}::bigint IS NULL OR id < ${filter.beforeId?.toString() ?? null}::bigint)
    ORDER BY id DESC LIMIT ${Math.min(filter.limit ?? 100, 500)}`;
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  /** Primera fila cuya cadena no cuadra (hash o enlace con la anterior). */
  brokenAtId: bigint | null;
  lastId: bigint | null;
  lastHash: string | null;
}

/** Recorre la cadena por lotes desde el inicio (o desde `afterId`) y recalcula cada hash. */
export async function verifyAuditChain(
  db: ISql,
  options: { afterId?: bigint | undefined; batch?: number | undefined } = {},
): Promise<ChainVerification> {
  const batch = options.batch ?? 1000;
  let cursor = options.afterId ?? 0n;
  let prevHash: Uint8Array = GENESIS_HASH;
  if (cursor > 0n) {
    const start = await db<{ hash: Uint8Array }[]>`
      SELECT hash FROM audit.audit_log WHERE id = ${cursor.toString()}::bigint`;
    if (!start[0])
      return { ok: false, checked: 0, brokenAtId: cursor, lastId: null, lastHash: null };
    prevHash = start[0].hash;
  }
  let checked = 0;
  let lastId: bigint | null = cursor > 0n ? cursor : null;
  for (;;) {
    const rows = await db<AuditLogRow[]>`
      SELECT * FROM audit.audit_log WHERE id > ${cursor.toString()}::bigint ORDER BY id ASC LIMIT ${batch}`;
    if (rows.length === 0) break;
    for (const row of rows) {
      const expected = computeHash(prevHash, hashedPayload(row));
      if (
        !Buffer.from(row.prev_hash).equals(Buffer.from(prevHash)) ||
        !Buffer.from(row.hash).equals(expected)
      ) {
        return {
          ok: false,
          checked,
          brokenAtId: BigInt(row.id),
          lastId,
          lastHash: Buffer.from(prevHash).toString('hex'),
        };
      }
      prevHash = row.hash;
      lastId = BigInt(row.id);
      checked += 1;
    }
    cursor = BigInt(rows[rows.length - 1]?.id ?? cursor);
  }
  return {
    ok: true,
    checked,
    brokenAtId: null,
    lastId,
    lastHash: lastId === null ? null : Buffer.from(prevHash).toString('hex'),
  };
}
