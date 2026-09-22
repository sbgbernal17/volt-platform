import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { toJson } from './types.ts';

export type AlarmSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlarmStatus = 'OPEN' | 'ACKED' | 'RESOLVED';

export interface RaiseAlarmInput {
  tenantId: string;
  kind: string;
  severity: AlarmSeverity;
  /** `kind|chargeBoxId|…`: una sola alarma abierta por huella (índice parcial `alarm_open_uq`). */
  fingerprint: string;
  chargePointId?: string;
  siteId?: string;
  evseId?: string;
  details?: Record<string, unknown>;
}

export interface AlarmRow {
  id: string;
  tenant_id: string;
  site_id: string | null;
  charge_point_id: string | null;
  evse_id: string | null;
  kind: string;
  severity: AlarmSeverity;
  fingerprint: string;
  status: AlarmStatus;
  occurrences: number;
  first_seen_at: Date;
  last_seen_at: Date;
  resolved_at: Date | null;
  resolution: string | null;
  details: Record<string, unknown>;
}

/** Abre la alarma o, si ya hay una abierta con la misma huella, incrementa sus ocurrencias. */
export async function raiseAlarm(sql: Sql, input: RaiseAlarmInput): Promise<AlarmRow> {
  const rows = await sql<AlarmRow[]>`
    INSERT INTO ops.alarm (id, tenant_id, site_id, charge_point_id, evse_id, kind, severity, fingerprint, details)
    VALUES (${randomUUID()}, ${input.tenantId}, ${input.siteId ?? null}, ${input.chargePointId ?? null},
            ${input.evseId ?? null}, ${input.kind}, ${input.severity}, ${input.fingerprint},
            ${toJson(sql, input.details ?? {})})
    ON CONFLICT (fingerprint) WHERE status <> 'RESOLVED'
    DO UPDATE SET occurrences = ops.alarm.occurrences + 1, last_seen_at = now(),
                  severity = EXCLUDED.severity, details = EXCLUDED.details
    RETURNING *`;
  const row = rows[0];
  if (!row) throw new Error('raiseAlarm: sin fila devuelta');
  return row;
}

/** Resuelve la alarma abierta con esa huella; devuelve cuántas filas se resolvieron (0 o 1). */
export async function resolveAlarm(
  sql: Sql,
  fingerprint: string,
  resolution: string,
): Promise<number> {
  const result = await sql`
    UPDATE ops.alarm SET status = 'RESOLVED', resolved_at = now(), resolution = ${resolution}
    WHERE fingerprint = ${fingerprint} AND status <> 'RESOLVED'`;
  return result.count;
}

export async function listAlarms(
  sql: Sql,
  filter: {
    tenantId: string;
    chargePointId?: string | undefined;
    includeResolved?: boolean | undefined;
    limit?: number | undefined;
  },
): Promise<AlarmRow[]> {
  return sql<AlarmRow[]>`
    SELECT * FROM ops.alarm
    WHERE tenant_id = ${filter.tenantId}
      AND (${filter.chargePointId ?? null}::uuid IS NULL OR charge_point_id = ${filter.chargePointId ?? null})
      AND (${filter.includeResolved ?? false} OR status <> 'RESOLVED')
    ORDER BY last_seen_at DESC LIMIT ${filter.limit ?? 100}`;
}

/** Resuelve una alarma por id (back-office). Devuelve la fila o undefined si no existe. */
export async function resolveAlarmById(
  sql: Sql,
  id: string,
  resolution: string,
  actor: string,
): Promise<AlarmRow | undefined> {
  const rows = await sql<AlarmRow[]>`
    UPDATE ops.alarm SET status = 'RESOLVED', resolved_at = now(), resolution = ${resolution},
           acked_by = COALESCE(acked_by, ${actor}), acked_at = COALESCE(acked_at, now())
    WHERE id = ${id} AND status <> 'RESOLVED'
    RETURNING *`;
  return rows[0];
}
