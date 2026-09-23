import type { SessionState } from '@volt/domain';
import type { ISql } from 'postgres';
import { NotFoundError } from '../errors.ts';
import type { ChargingSessionRow } from './rows.ts';

/** Sesión con los datos del EVSE, el cargador y la transacción que necesitan la app y el back-office. */
export interface SessionView extends ChargingSessionRow {
  evse_code: string;
  charge_box_id: string;
  ocpp_connector_id: number | null;
  ocpp_transaction_no: number | null;
  transaction_state: string | null;
  driver_display_name: string | null;
  /** Del snapshot de tarifa (iteración 4). */
  tariff_code: string | null;
  tariff_version: number | null;
  tax_included: boolean | null;
}

const VIEW_SELECT = (db: ISql) => db`
  SELECT s.*, e.evse_id AS evse_code, cp.charge_box_id, c.ocpp_connector_id,
         t.ocpp_transaction_id AS ocpp_transaction_no, t.state::text AS transaction_state,
         d.display_name AS driver_display_name,
         ts.snapshot->>'tariff_code' AS tariff_code, (ts.snapshot->>'tariff_version')::int AS tariff_version,
         (ts.snapshot->>'tax_included')::boolean AS tax_included
  FROM sessions.charging_session s
  JOIN assets.evse e ON e.id = s.evse_id
  JOIN assets.charge_point cp ON cp.id = s.charge_point_id
  LEFT JOIN assets.connector c ON c.id = s.connector_id
  LEFT JOIN sessions.ocpp_transaction t ON t.id = s.ocpp_transaction_id
  LEFT JOIN auth.driver d ON d.id = s.driver_id
  LEFT JOIN tariffs.session_tariff_snapshot ts ON ts.session_id = s.id`;

export async function getSessionView(db: ISql, sessionId: string): Promise<SessionView> {
  const rows = await db<SessionView[]>`${VIEW_SELECT(db)} WHERE s.id = ${sessionId}`;
  const row = rows[0];
  if (!row) throw new NotFoundError('session', sessionId);
  return row;
}

export interface SessionViewFilter {
  tenantId: string;
  driverId?: string | undefined;
  chargePointId?: string | undefined;
  /** Alcance por sedes (SITE_OWNER); undefined = todas. */
  siteIds?: readonly string[] | undefined;
  state?: SessionState | undefined;
  limit?: number | undefined;
}

export async function listSessionViews(
  db: ISql,
  filter: SessionViewFilter,
): Promise<SessionView[]> {
  const scope = filter.siteIds ? [...filter.siteIds] : null;
  return db<SessionView[]>`
    ${VIEW_SELECT(db)}
    WHERE s.tenant_id = ${filter.tenantId}
      AND (${filter.driverId ?? null}::uuid IS NULL OR s.driver_id = ${filter.driverId ?? null})
      AND (${filter.chargePointId ?? null}::uuid IS NULL OR s.charge_point_id = ${filter.chargePointId ?? null})
      AND (${scope}::uuid[] IS NULL OR s.site_id = ANY(${scope}::uuid[]))
      AND (${filter.state ?? null}::text IS NULL OR s.state::text = ${filter.state ?? null})
    ORDER BY s.requested_at DESC LIMIT ${filter.limit ?? 50}`;
}
