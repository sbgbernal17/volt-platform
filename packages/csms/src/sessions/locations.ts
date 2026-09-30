import type { ISql } from 'postgres';
import { NotFoundError } from '../errors.ts';

/** EVSE con su estado en vivo, tal como lo ve la app (ARQ §1.4; DAT `assets.v_connector_live`). */
export interface EvseLiveRow {
  evse_code: string;
  evse_uuid: string;
  connector_uuid: string;
  charge_point_id: string;
  charge_box_id: string;
  site_id: string;
  ocpp_connector_id: number;
  standard: string;
  power_type: string;
  max_power_w: number | null;
  /** Potencia del gabinete (W) y si se reparte entre sus conectores (ADR 0026). */
  charger_max_power_w: number | null;
  power_shared: boolean;
  status: string;
  last_seen_at: Date | null;
  visible_in_app: boolean;
  lifecycle_status: string;
  connected: boolean;
}

export interface LocationRow {
  id: string;
  code: string;
  name: string;
  address: string;
  city: string | null;
  latitude: string;
  longitude: string;
  timezone: string;
  access_type: string;
  opening_hours: Record<string, unknown>;
}

const EVSE_LIVE_SELECT = (db: ISql) => db`
  SELECT e.evse_id AS evse_code, e.id AS evse_uuid, v.connector_id AS connector_uuid, v.charge_point_id,
         v.charge_box_id, v.site_id, v.ocpp_connector_id, v.standard::text, v.power_type::text, v.max_power_w,
         v.status, v.last_seen_at, (e.visible_in_app AND cp.visible_in_app) AS visible_in_app,
         cp.lifecycle_status, cp.connected, cp.max_power_w AS charger_max_power_w,
         (cp.max_power_w IS NOT NULL
          AND (SELECT COUNT(*) FROM assets.connector c2 WHERE c2.charge_point_id = cp.id) > 1
          AND cp.max_power_w < (SELECT SUM(COALESCE(c2.max_power_w, cp.max_power_w))
                                FROM assets.connector c2 WHERE c2.charge_point_id = cp.id)) AS power_shared
  FROM assets.v_connector_live v
  JOIN assets.evse e ON e.id = v.evse_id
  JOIN assets.charge_point cp ON cp.id = v.charge_point_id`;

/** Sedes activas con sus EVSE visibles en la app y su estado en vivo. */
export async function listLocations(
  db: ISql,
  tenantId: string,
): Promise<(LocationRow & { evses: EvseLiveRow[] })[]> {
  const sites = await db<LocationRow[]>`
    SELECT id, code, name, address, city, latitude, longitude, timezone, access_type, opening_hours
    FROM assets.site WHERE tenant_id = ${tenantId} AND status = 'ACTIVE' ORDER BY name`;
  const evses = await db<EvseLiveRow[]>`
    ${EVSE_LIVE_SELECT(db)} WHERE v.tenant_id = ${tenantId} ORDER BY v.charge_box_id, v.ocpp_connector_id`;
  return sites.map((site) => ({
    ...site,
    evses: evses.filter((evse) => evse.site_id === site.id && evse.visible_in_app),
  }));
}

export async function getEvseByCode(
  db: ISql,
  tenantId: string,
  evseCode: string,
): Promise<EvseLiveRow> {
  const rows = await db<EvseLiveRow[]>`
    ${EVSE_LIVE_SELECT(db)} WHERE v.tenant_id = ${tenantId} AND e.evse_id = ${evseCode}`;
  const row = rows[0];
  if (!row) throw new NotFoundError('evse', evseCode);
  return row;
}

export async function getEvseById(db: ISql, evseId: string): Promise<EvseLiveRow> {
  const rows = await db<EvseLiveRow[]>`${EVSE_LIVE_SELECT(db)} WHERE e.id = ${evseId}`;
  const row = rows[0];
  if (!row) throw new NotFoundError('evse', evseId);
  return row;
}
