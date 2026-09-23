/**
 * Resumen "ahora" del back-office (OPS §3.1): sedes con sus cargadores y conectores en vivo, conteos por
 * estado, sesiones activas y alarmas abiertas. Acepta el alcance por sedes de SITE_OWNER.
 */
import type { ISql } from 'postgres';
import { listAlarms } from '../alarms.ts';
import type { SiteRow } from '../inventory.ts';
import { listSessionViews } from '../sessions/views.ts';

export interface OverviewConnector {
  id: string;
  evse_id: string;
  evse_code: string;
  ocpp_connector_id: number;
  standard: string;
  power_type: string;
  max_power_w: number | null;
  status: string;
  error_code: string;
  status_received_at: Date | null;
  current_transaction_id: string | null;
  visible_in_app: boolean;
}

export interface OverviewChargePoint {
  id: string;
  site_id: string;
  charge_box_id: string;
  vendor: string | null;
  model: string | null;
  lifecycle_status: string;
  connected: boolean;
  last_seen_at: Date | null;
  cp_status: string;
  visible_in_app: boolean;
  connectors: OverviewConnector[];
}

export interface Overview {
  sites: (SiteRow & { chargePoints: OverviewChargePoint[] })[];
  counts: {
    sites: number;
    chargePoints: number;
    online: number;
    offline: number;
    connectorsByStatus: Record<string, number>;
    activeSessions: number;
    openAlarms: Record<string, number>;
  };
  activeSessions: Awaited<ReturnType<typeof listSessionViews>>;
  openAlarms: Awaited<ReturnType<typeof listAlarms>>;
}

const ACTIVE_STATES = ['AUTHORIZING', 'STARTING', 'CHARGING', 'SUSPENDED', 'STOPPING'];

export async function getOverview(
  db: ISql,
  tenantId: string,
  siteIds?: readonly string[] | undefined,
): Promise<Overview> {
  const scope = siteIds ? [...siteIds] : null;
  const sites = await db<SiteRow[]>`
    SELECT * FROM assets.site
    WHERE tenant_id = ${tenantId} AND (${scope}::uuid[] IS NULL OR id = ANY(${scope}::uuid[]))
    ORDER BY code`;
  const chargePoints = await db<Omit<OverviewChargePoint, 'connectors'>[]>`
    SELECT id, site_id, charge_box_id, vendor, model, lifecycle_status, connected, last_seen_at, cp_status, visible_in_app
    FROM assets.charge_point
    WHERE tenant_id = ${tenantId} AND (${scope}::uuid[] IS NULL OR site_id = ANY(${scope}::uuid[]))
    ORDER BY charge_box_id`;
  const connectors = await db<(OverviewConnector & { charge_point_id: string })[]>`
    SELECT c.id, c.evse_id, e.evse_id AS evse_code, c.charge_point_id, c.ocpp_connector_id, c.standard::text,
           c.power_type::text, c.max_power_w, c.ocpp_status AS status, c.error_code, c.status_received_at,
           c.current_transaction_id, e.visible_in_app
    FROM assets.connector c
    JOIN assets.evse e ON e.id = c.evse_id
    JOIN assets.charge_point cp ON cp.id = c.charge_point_id
    WHERE cp.tenant_id = ${tenantId} AND (${scope}::uuid[] IS NULL OR cp.site_id = ANY(${scope}::uuid[]))
    ORDER BY c.charge_point_id, c.ocpp_connector_id`;
  const byChargePoint = new Map<string, OverviewConnector[]>();
  for (const { charge_point_id, ...connector } of connectors) {
    const list = byChargePoint.get(charge_point_id) ?? [];
    list.push(connector);
    byChargePoint.set(charge_point_id, list);
  }
  const withConnectors: OverviewChargePoint[] = chargePoints.map((cp) => ({
    ...cp,
    connectors: byChargePoint.get(cp.id) ?? [],
  }));
  const connectorsByStatus: Record<string, number> = {};
  for (const connector of connectors) {
    const cp = chargePoints.find((c) => c.id === connector.charge_point_id);
    const status = cp?.connected ? connector.status : 'Offline';
    connectorsByStatus[status] = (connectorsByStatus[status] ?? 0) + 1;
  }
  const sessions = await listSessionViews(db, { tenantId, siteIds, limit: 200 });
  const activeSessions = sessions.filter((s) => ACTIVE_STATES.includes(s.state));
  const alarms = await listAlarms(db as never, { tenantId, siteIds, limit: 200 });
  const openAlarms: Record<string, number> = { CRITICAL: 0, WARNING: 0, INFO: 0 };
  for (const alarm of alarms) openAlarms[alarm.severity] = (openAlarms[alarm.severity] ?? 0) + 1;
  return {
    sites: sites.map((site) => ({
      ...site,
      chargePoints: withConnectors.filter((cp) => cp.site_id === site.id),
    })),
    counts: {
      sites: sites.length,
      chargePoints: chargePoints.length,
      online: chargePoints.filter((cp) => cp.connected).length,
      offline: chargePoints.filter((cp) => !cp.connected).length,
      connectorsByStatus,
      activeSessions: activeSessions.length,
      openAlarms,
    },
    activeSessions,
    openAlarms: alarms,
  };
}
