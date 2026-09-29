import { raiseAlarm, resolveAlarm } from '@volt/csms';
import type { Sql } from 'postgres';
import type { SchedulerLogger } from '../scheduler.ts';

export interface ConnectionWatchOptions {
  /** Segundos sin conexión antes de abrir la alarma (absorbe reconexiones rápidas). */
  graceS: number;
  /** Fracción de cargadores de una sede fuera de línea a partir de la cual la alarma es CRITICAL. */
  siteCriticalRatio: number;
  logger: SchedulerLogger;
  now?: () => Date;
}

export interface ConnectionWatchSummary {
  operational: number;
  offline: number;
  raised: number;
  resolved: number;
}

interface WatchRow {
  id: string;
  tenant_id: string;
  site_id: string;
  charge_box_id: string;
  offline: boolean;
  offline_since: Date | null;
  site_total: number;
  site_offline: number;
}

export const OFFLINE_ALARM_KIND = 'CHARGER_OFFLINE';

export function offlineFingerprint(chargeBoxId: string): string {
  return `${OFFLINE_ALARM_KIND}|${chargeBoxId}`;
}

/**
 * Vigilancia de conexiones (OPS §2.3, capa 1 de ARQ §4.4): abre la alarma CHARGER_OFFLINE para cada
 * cargador OPERATIONAL sin socket vivo desde hace más de la gracia, CRITICAL cuando una sede tiene
 * una fracción alta de sus cargadores caídos, y la resuelve cuando el cargador vuelve. Cada apertura
 * y cierre deja una línea `alarm.raised`/`alarm.resolved` que Cloud Monitoring convierte en aviso.
 */
export async function watchConnections(
  sql: Sql,
  options: ConnectionWatchOptions,
): Promise<ConnectionWatchSummary> {
  const now = options.now?.() ?? new Date();
  const rows = await sql<WatchRow[]>`
    WITH cps AS (
      SELECT cp.id, cp.tenant_id, cp.site_id, cp.charge_box_id,
             GREATEST(cp.last_disconnect_at, cp.last_seen_at, cp.updated_at) AS offline_since,
             (NOT cp.connected
              AND GREATEST(cp.last_disconnect_at, cp.last_seen_at, cp.updated_at)
                  < ${now}::timestamptz - make_interval(secs => ${options.graceS})) AS offline
      FROM assets.charge_point cp
      WHERE cp.lifecycle_status = 'OPERATIONAL'
    )
    SELECT c.id, c.tenant_id, c.site_id, c.charge_box_id, c.offline,
           CASE WHEN c.offline THEN c.offline_since END AS offline_since,
           (SELECT count(*)::int FROM cps s WHERE s.site_id = c.site_id) AS site_total,
           (SELECT count(*)::int FROM cps s WHERE s.site_id = c.site_id AND s.offline) AS site_offline
    FROM cps c
    ORDER BY c.charge_box_id`;

  const openAlarms = await sql<{ fingerprint: string; severity: string }[]>`
    SELECT fingerprint, severity FROM ops.alarm
    WHERE kind = ${OFFLINE_ALARM_KIND} AND status <> 'RESOLVED'`;
  const open = new Map(openAlarms.map((a) => [a.fingerprint, a.severity]));

  const summary: ConnectionWatchSummary = {
    operational: rows.length,
    offline: 0,
    raised: 0,
    resolved: 0,
  };

  for (const row of rows) {
    const fingerprint = offlineFingerprint(row.charge_box_id);
    if (row.offline) {
      summary.offline += 1;
      const siteRatio = row.site_total > 0 ? row.site_offline / row.site_total : 0;
      const severity =
        row.site_total >= 2 && siteRatio >= options.siteCriticalRatio ? 'CRITICAL' : 'WARNING';
      const previous = open.get(fingerprint);
      const alarm = await raiseAlarm(sql, {
        tenantId: row.tenant_id,
        kind: OFFLINE_ALARM_KIND,
        severity,
        fingerprint,
        chargePointId: row.id,
        siteId: row.site_id,
        details: {
          chargeBoxId: row.charge_box_id,
          offlineSince: row.offline_since?.toISOString() ?? null,
          siteOffline: row.site_offline,
          siteTotal: row.site_total,
        },
      });
      if (!previous || (previous !== 'CRITICAL' && severity === 'CRITICAL')) {
        summary.raised += 1;
        options.logger.info(
          {
            event: 'alarm.raised',
            kind: OFFLINE_ALARM_KIND,
            severity,
            alarmId: alarm.id,
            chargeBoxId: row.charge_box_id,
            siteId: row.site_id,
            offlineSince: row.offline_since?.toISOString() ?? null,
            siteOffline: row.site_offline,
            siteTotal: row.site_total,
          },
          'alarma abierta: cargador fuera de línea',
        );
      }
    } else if (open.has(fingerprint)) {
      const resolved = await resolveAlarm(sql, fingerprint, 'cargador reconectado');
      if (resolved > 0) {
        summary.resolved += 1;
        options.logger.info(
          {
            event: 'alarm.resolved',
            kind: OFFLINE_ALARM_KIND,
            chargeBoxId: row.charge_box_id,
            siteId: row.site_id,
          },
          'alarma resuelta: cargador reconectado',
        );
      }
    }
  }
  return summary;
}
