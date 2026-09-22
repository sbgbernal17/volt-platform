import { randomUUID } from 'node:crypto';
import type { LifecycleState } from '@volt/domain';
import type { Sql } from 'postgres';
import { ConflictError, NotFoundError } from './errors.ts';
import { type ConnectorStandard, type PowerType, type SiteAccessType, toJson } from './types.ts';

// ---------- Sedes ----------

export interface CreateSiteInput {
  tenantId: string;
  code: string;
  name: string;
  address: string;
  city?: string | undefined;
  postalCode?: string | undefined;
  countryCode?: string | undefined;
  latitude: number;
  longitude: number;
  timezone: string;
  accessType?: SiteAccessType | undefined;
  openingHours?: Record<string, unknown> | undefined;
  gridMaxPowerW?: number | undefined;
}

export interface SiteRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  address: string;
  city: string | null;
  postal_code: string | null;
  country_code: string | null;
  latitude: string;
  longitude: string;
  timezone: string;
  access_type: SiteAccessType;
  opening_hours: Record<string, unknown>;
  grid_max_power_w: number | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export async function createSite(sql: Sql, input: CreateSiteInput): Promise<SiteRow> {
  const existing = await sql`
    SELECT 1 FROM assets.site WHERE tenant_id = ${input.tenantId} AND code = ${input.code}`;
  if (existing.length > 0) throw new ConflictError(`Ya existe una sede con código ${input.code}`);
  const rows = await sql<SiteRow[]>`
    INSERT INTO assets.site (id, tenant_id, code, name, address, city, postal_code, country_code,
                             latitude, longitude, timezone, access_type, opening_hours, grid_max_power_w)
    VALUES (${randomUUID()}, ${input.tenantId}, ${input.code}, ${input.name}, ${input.address},
            ${input.city ?? null}, ${input.postalCode ?? null}, ${input.countryCode ?? null},
            ${input.latitude}, ${input.longitude}, ${input.timezone}, ${input.accessType ?? 'PUBLIC'},
            ${toJson(sql, input.openingHours ?? { twentyfourseven: true })}, ${input.gridMaxPowerW ?? null})
    RETURNING *`;
  return rows[0] as SiteRow;
}

export async function listSites(sql: Sql, tenantId: string): Promise<SiteRow[]> {
  return sql<SiteRow[]>`SELECT * FROM assets.site WHERE tenant_id = ${tenantId} ORDER BY code`;
}

export async function getSite(sql: Sql, id: string): Promise<SiteRow> {
  const rows = await sql<SiteRow[]>`SELECT * FROM assets.site WHERE id = ${id}`;
  const row = rows[0];
  if (!row) throw new NotFoundError('site', id);
  return row;
}

// ---------- Plantillas de configuración ----------

export interface CreateConfigTemplateInput {
  tenantId: string;
  name: string;
  version?: number | undefined;
  description?: string | undefined;
  appliesTo?: Record<string, unknown> | undefined;
  /** Estado deseado por key (CiString50 → CiString500). */
  keys: Record<string, string>;
  readOnlyExpected?: string[] | undefined;
  /** Keys cuya respuesta Rejected/NotSupported no bloquea el paso a CONFIGURED (OPS §1.4). */
  optionalKeys?: string[] | undefined;
}

export interface ConfigTemplateRow {
  id: string;
  tenant_id: string;
  name: string;
  version: number;
  description: string | null;
  applies_to: Record<string, unknown>;
  keys: Record<string, string>;
  read_only_expected: string[];
  optional_keys: string[];
  created_at: Date;
}

export async function createConfigTemplate(
  sql: Sql,
  input: CreateConfigTemplateInput,
): Promise<ConfigTemplateRow> {
  const version = input.version ?? 1;
  const existing = await sql`
    SELECT 1 FROM config.ocpp_config_template
    WHERE tenant_id = ${input.tenantId} AND name = ${input.name} AND version = ${version}`;
  if (existing.length > 0) {
    throw new ConflictError(`Ya existe la plantilla ${input.name} v${version}`);
  }
  const rows = await sql<ConfigTemplateRow[]>`
    INSERT INTO config.ocpp_config_template
      (id, tenant_id, name, version, description, applies_to, keys, read_only_expected, optional_keys)
    VALUES (${randomUUID()}, ${input.tenantId}, ${input.name}, ${version}, ${input.description ?? null},
            ${toJson(sql, input.appliesTo ?? {})}, ${toJson(sql, input.keys)},
            ${textArray(sql, input.readOnlyExpected ?? [])}, ${textArray(sql, input.optionalKeys ?? [])})
    RETURNING *`;
  return rows[0] as ConfigTemplateRow;
}

export async function listConfigTemplates(
  sql: Sql,
  tenantId: string,
): Promise<ConfigTemplateRow[]> {
  return sql<ConfigTemplateRow[]>`
    SELECT * FROM config.ocpp_config_template WHERE tenant_id = ${tenantId} ORDER BY name, version`;
}

export async function getConfigTemplate(sql: Sql, id: string): Promise<ConfigTemplateRow> {
  const rows = await sql<
    ConfigTemplateRow[]
  >`SELECT * FROM config.ocpp_config_template WHERE id = ${id}`;
  const row = rows[0];
  if (!row) throw new NotFoundError('config_template', id);
  return row;
}

/** Fragmento `text[]` a partir de un array JS (también vacío) sin depender de la inferencia de tipos. */
export function textArray(sql: Sql, values: readonly string[]) {
  return sql`COALESCE((SELECT array_agg(x)::text[] FROM jsonb_array_elements_text(${sql.json([...values])}::jsonb) AS t(x)), '{}'::text[])`;
}

// ---------- Cargadores, EVSE y conectores ----------

export interface ExpectedConnector {
  ocppConnectorId: number;
  standard: ConnectorStandard;
  powerType: PowerType;
  maxPowerW?: number | undefined;
  maxCurrentA?: number | undefined;
  maxVoltageV?: number | undefined;
  minVoltageV?: number | undefined;
  /** Identificador público del EVSE (QR, roaming); por defecto `<chargeBoxId>-<n>`. */
  evseId?: string | undefined;
  physicalReference?: string | undefined;
}

export interface CreateChargePointInput {
  tenantId: string;
  siteId: string;
  chargeBoxId: string;
  vendor?: string | undefined;
  model?: string | undefined;
  serialNumber?: string | undefined;
  securityProfile?: number | undefined;
  configTemplateId?: string | undefined;
  heartbeatIntervalS?: number | undefined;
  connectors: ExpectedConnector[];
}

export interface ChargePointRow {
  id: string;
  tenant_id: string;
  site_id: string;
  charge_box_id: string;
  serial_number: string | null;
  vendor: string | null;
  model: string | null;
  firmware_version: string | null;
  iccid: string | null;
  imsi: string | null;
  meter_type: string | null;
  meter_serial: string | null;
  ocpp_version: string;
  security_profile: number;
  registration_status: 'Accepted' | 'Pending' | 'Rejected';
  lifecycle_status: LifecycleState;
  config_template_id: string | null;
  supported_profiles: string[];
  number_of_connectors: number | null;
  heartbeat_interval_s: number;
  cp_status: string;
  cp_error_code: string;
  connected: boolean;
  connection_generation: bigint;
  last_seen_at: Date | null;
  last_boot_at: Date | null;
  last_disconnect_at: Date | null;
  clock_offset_s: number | null;
  visible_in_app: boolean;
  boot_vendor: string | null;
  boot_model: string | null;
  config_synced_at: Date | null;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ConnectorRow {
  id: string;
  evse_id: string;
  evse_code: string;
  charge_point_id: string;
  ocpp_connector_id: number;
  standard: ConnectorStandard;
  power_type: PowerType;
  max_voltage_v: number | null;
  min_voltage_v: number | null;
  max_current_a: number | null;
  max_power_w: number | null;
  ocpp_status: string;
  error_code: string;
  vendor_error_code: string | null;
  status_info: string | null;
  status_at_cp: Date | null;
  status_received_at: Date | null;
  current_transaction_id: string | null;
  visible_in_app: boolean;
  admin_status: string;
}

export async function createChargePoint(
  sql: Sql,
  input: CreateChargePointInput,
): Promise<ChargePointRow> {
  if (input.connectors.length === 0) {
    throw new ConflictError('Un cargador necesita al menos un conector esperado', 'VALIDATION');
  }
  const ids = new Set(input.connectors.map((c) => c.ocppConnectorId));
  if (ids.size !== input.connectors.length) {
    throw new ConflictError('connectorId repetido en los conectores esperados', 'VALIDATION');
  }
  const duplicated =
    await sql`SELECT 1 FROM assets.charge_point WHERE charge_box_id = ${input.chargeBoxId}`;
  if (duplicated.length > 0) {
    throw new ConflictError(`Ya existe un cargador con chargeBoxId ${input.chargeBoxId}`);
  }
  await getSite(sql, input.siteId);
  if (input.configTemplateId) await getConfigTemplate(sql, input.configTemplateId);

  return sql
    .begin(async (tx) => {
      const id = randomUUID();
      const rows = await tx<ChargePointRow[]>`
      INSERT INTO assets.charge_point
        (id, tenant_id, site_id, charge_box_id, serial_number, vendor, model, security_profile,
         config_template_id, number_of_connectors, heartbeat_interval_s, lifecycle_status)
      VALUES (${id}, ${input.tenantId}, ${input.siteId}, ${input.chargeBoxId},
              ${input.serialNumber ?? null}, ${input.vendor ?? null}, ${input.model ?? null},
              ${input.securityProfile ?? 2}, ${input.configTemplateId ?? null},
              ${input.connectors.length}, ${input.heartbeatIntervalS ?? 300}, 'INVENTORIED')
      RETURNING *`;
      for (const connector of input.connectors) {
        const evseId = randomUUID();
        await tx`
        INSERT INTO assets.evse (id, charge_point_id, ocpp_evse_id, evse_id, physical_reference, max_power_w)
        VALUES (${evseId}, ${id}, ${connector.ocppConnectorId},
                ${connector.evseId ?? `${input.chargeBoxId}-${connector.ocppConnectorId}`},
                ${connector.physicalReference ?? null}, ${connector.maxPowerW ?? null})`;
        await tx`
        INSERT INTO assets.connector (id, evse_id, charge_point_id, ocpp_connector_id, standard, power_type,
                                      max_voltage_v, min_voltage_v, max_current_a, max_power_w)
        VALUES (${randomUUID()}, ${evseId}, ${id}, ${connector.ocppConnectorId}, ${connector.standard},
                ${connector.powerType}, ${connector.maxVoltageV ?? null}, ${connector.minVoltageV ?? null},
                ${connector.maxCurrentA ?? null}, ${connector.maxPowerW ?? null})`;
      }
      await tx`
      INSERT INTO assets.charge_point_lifecycle_event (charge_point_id, from_state, to_state, actor, reason)
      VALUES (${id}, NULL, 'INVENTORIED', 'system:inventory', 'alta en inventario')`;
      return rows[0] as ChargePointRow;
    })
    .then(async (row) => {
      if (input.configTemplateId)
        await seedDesiredConfiguration(sql, row.id, input.configTemplateId);
      return row;
    });
}

/** Copia las keys de la plantilla como estado deseado (sin pisar overrides). */
export async function seedDesiredConfiguration(
  sql: Sql,
  chargePointId: string,
  templateId: string,
): Promise<number> {
  const result = await sql`
    INSERT INTO assets.charge_point_config (charge_point_id, key, desired_value, source, last_changed_at)
    SELECT ${chargePointId}, k.key, k.value, 'TEMPLATE', now()
    FROM config.ocpp_config_template t, jsonb_each_text(t.keys) AS k
    WHERE t.id = ${templateId}
    ON CONFLICT (charge_point_id, key) DO UPDATE
      SET desired_value = EXCLUDED.desired_value, source = 'TEMPLATE', last_changed_at = now()
      WHERE assets.charge_point_config.source <> 'OVERRIDE'`;
  return result.count;
}

export async function assignTemplate(
  sql: Sql,
  chargePointId: string,
  templateId: string,
): Promise<void> {
  await getChargePoint(sql, chargePointId);
  await getConfigTemplate(sql, templateId);
  await sql`
    UPDATE assets.charge_point SET config_template_id = ${templateId}, updated_at = now()
    WHERE id = ${chargePointId}`;
  await seedDesiredConfiguration(sql, chargePointId, templateId);
}

export interface ChargePointFilter {
  tenantId: string;
  siteId?: string | undefined;
  lifecycle?: LifecycleState | undefined;
}

export async function listChargePoints(
  sql: Sql,
  filter: ChargePointFilter,
): Promise<ChargePointRow[]> {
  return sql<ChargePointRow[]>`
    SELECT * FROM assets.charge_point
    WHERE tenant_id = ${filter.tenantId}
      AND (${filter.siteId ?? null}::uuid IS NULL OR site_id = ${filter.siteId ?? null})
      AND (${filter.lifecycle ?? null}::text IS NULL OR lifecycle_status = ${filter.lifecycle ?? null})
    ORDER BY charge_box_id`;
}

export async function getChargePoint(sql: Sql, id: string): Promise<ChargePointRow> {
  const rows = await sql<ChargePointRow[]>`SELECT * FROM assets.charge_point WHERE id = ${id}`;
  const row = rows[0];
  if (!row) throw new NotFoundError('charge_point', id);
  return row;
}

export async function findChargePointByChargeBoxId(
  sql: Sql,
  chargeBoxId: string,
): Promise<ChargePointRow | undefined> {
  const rows = await sql<ChargePointRow[]>`
    SELECT * FROM assets.charge_point WHERE charge_box_id = ${chargeBoxId}`;
  return rows[0];
}

export async function listConnectors(sql: Sql, chargePointId: string): Promise<ConnectorRow[]> {
  return sql<ConnectorRow[]>`
    SELECT c.id, c.evse_id, e.evse_id AS evse_code, c.charge_point_id, c.ocpp_connector_id, c.standard,
           c.power_type, c.max_voltage_v, c.min_voltage_v, c.max_current_a, c.max_power_w, c.ocpp_status,
           c.error_code, c.vendor_error_code, c.status_info, c.status_at_cp, c.status_received_at,
           c.current_transaction_id, e.visible_in_app, e.admin_status
    FROM assets.connector c JOIN assets.evse e ON e.id = c.evse_id
    WHERE c.charge_point_id = ${chargePointId}
    ORDER BY c.ocpp_connector_id`;
}

export interface ConfigRow {
  key: string;
  desired_value: string | null;
  observed_value: string | null;
  readonly: boolean | null;
  source: 'TEMPLATE' | 'OVERRIDE' | 'DEVICE';
  last_result: string | null;
  last_synced_at: Date | null;
  last_changed_at: Date | null;
  drift: boolean;
}

export async function listConfiguration(sql: Sql, chargePointId: string): Promise<ConfigRow[]> {
  return sql<ConfigRow[]>`
    SELECT key, desired_value, observed_value, readonly, source, last_result, last_synced_at,
           last_changed_at, drift
    FROM assets.charge_point_config WHERE charge_point_id = ${chargePointId} ORDER BY key`;
}

/** Vista en vivo de los conectores (estado OCPP + Offline derivado) para app y back-office. */
export interface ConnectorLiveRow {
  connector_id: string;
  evse_code: string;
  charge_box_id: string;
  ocpp_connector_id: number;
  status: string;
  last_ocpp_status: string;
  error_code: string;
  last_seen_at: Date | null;
}

export async function listConnectorsLive(
  sql: Sql,
  chargePointId: string,
): Promise<ConnectorLiveRow[]> {
  return sql<ConnectorLiveRow[]>`
    SELECT connector_id, evse_code, charge_box_id, ocpp_connector_id, status, last_ocpp_status,
           error_code, last_seen_at
    FROM assets.v_connector_live WHERE charge_point_id = ${chargePointId} ORDER BY ocpp_connector_id`;
}
