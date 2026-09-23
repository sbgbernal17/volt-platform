/**
 * Bitácora por cargador (OPS §3.10 y §5): una sola cronología con mensajes OCPP, comandos, alarmas,
 * eventos de ciclo de vida, sesiones y conexiones WebSocket.
 */
import type { ISql } from 'postgres';
import { getChargePoint } from '../inventory.ts';

export const TIMELINE_KINDS = [
  'OCPP',
  'COMMAND',
  'ALARM',
  'LIFECYCLE',
  'SESSION',
  'CONNECTION',
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export interface TimelineEntry {
  kind: TimelineKind;
  at: Date;
  title: string;
  ref: string;
  details: Record<string, unknown>;
}

export interface TimelineFilter {
  limit?: number | undefined;
  before?: Date | undefined;
  kinds?: readonly TimelineKind[] | undefined;
  /** Ventana de mensajes OCPP crudos (días); son muchos y se conservan 30 días. */
  ocppDays?: number | undefined;
}

export async function listChargePointTimeline(
  db: ISql,
  chargePointId: string,
  filter: TimelineFilter = {},
): Promise<TimelineEntry[]> {
  const chargePoint = await getChargePoint(db as never, chargePointId);
  const kinds = filter.kinds && filter.kinds.length > 0 ? filter.kinds : TIMELINE_KINDS;
  const limit = Math.min(filter.limit ?? 200, 1000);
  const before = filter.before ?? null;
  const ocppDays = filter.ocppDays ?? 30;
  return db<TimelineEntry[]>`
    SELECT kind, at, title, ref, details FROM (
      SELECT 'OCPP'::text AS kind, l.ts AS at, coalesce(l.action, '?') AS title, l.unique_id AS ref,
             jsonb_build_object('direction', l.direction, 'messageType', l.message_type, 'payload', l.payload,
                                'errorCode', l.error_code, 'errorDescription', l.error_description,
                                'latencyMs', l.latency_ms) AS details
      FROM ops.ocpp_message_log l
      WHERE l.charge_box_id = ${chargePoint.charge_box_id}
        AND l.ts > now() - make_interval(days => ${ocppDays})
      UNION ALL
      SELECT 'COMMAND', c.requested_at, c.action, c.id::text,
             jsonb_build_object('state', c.state, 'requestedBy', c.requested_by, 'payload', c.payload,
                                'resultStatus', c.result_status, 'errorCode', c.error_code,
                                'respondedAt', c.responded_at)
      FROM ops.command c WHERE c.charge_point_id = ${chargePointId}
      UNION ALL
      SELECT 'ALARM', a.last_seen_at, a.kind, a.id::text,
             jsonb_build_object('severity', a.severity, 'status', a.status, 'occurrences', a.occurrences,
                                'firstSeenAt', a.first_seen_at, 'resolution', a.resolution, 'details', a.details)
      FROM ops.alarm a WHERE a.charge_point_id = ${chargePointId}
      UNION ALL
      SELECT 'LIFECYCLE', e.at, e.to_state, e.id::text,
             jsonb_build_object('from', e.from_state, 'actor', e.actor, 'reason', e.reason, 'evidence', e.evidence)
      FROM assets.charge_point_lifecycle_event e WHERE e.charge_point_id = ${chargePointId}
      UNION ALL
      SELECT 'SESSION', s.requested_at, s.state::text, s.id::text,
             jsonb_build_object('sessionNo', s.session_no, 'channel', s.start_channel, 'energyWh', s.energy_wh,
                                'endKind', s.end_kind, 'totalMinor', s.total_minor, 'endedAt', s.ended_at,
                                'paymentStatus', s.payment_status)
      FROM sessions.charging_session s WHERE s.charge_point_id = ${chargePointId}
      UNION ALL
      SELECT 'CONNECTION', c.connected_at,
             CASE WHEN c.disconnected_at IS NULL THEN 'connected' ELSE 'disconnected' END, c.id::text,
             jsonb_build_object('pod', c.pod, 'generation', c.generation, 'remoteIp', c.remote_ip::text,
                                'disconnectedAt', c.disconnected_at, 'closeCode', c.close_code,
                                'closeReason', c.close_reason, 'msgsIn', c.msgs_in, 'msgsOut', c.msgs_out)
      FROM ops.charge_point_connection c WHERE c.charge_point_id = ${chargePointId}
    ) t
    WHERE t.kind = ANY(${[...kinds]}::text[])
      AND (${before}::timestamptz IS NULL OR t.at < ${before})
    ORDER BY t.at DESC, t.kind LIMIT ${limit}`;
}
