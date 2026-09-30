import {
  createChargePoint,
  createSite,
  ensureBaseTariff,
  findChargePointByChargeBoxId,
  issueCredential,
  transitionLifecycle,
  updateChargePointPower,
  VOLT_TENANT_ID,
} from '@volt/csms';
import type { LifecycleState } from '@volt/domain';
import type { Sql } from 'postgres';

export interface SyntheticSeedInput {
  chargeBoxId: string;
  siteCode: string;
  actor?: string;
  /**
   * Publica el cargador en la app como estación de pruebas (dev y staging) y garantiza la tarifa
   * base; por defecto queda oculto.
   */
  visibleInApp?: boolean | undefined;
}

/** Sede del cargador sintético según su modo: oculta (plataforma) o publicada como estación de pruebas. */
const SITE_PRESETS = {
  hidden: {
    name: 'Cargadores sintéticos (plataforma)',
    address: 'Virtual',
    city: 'Bogotá',
    latitude: 4.711,
    longitude: -74.0721,
    accessType: 'PRIVATE' as const,
  },
  visible: {
    name: 'Estación de pruebas Volt (virtual)',
    address: 'Cargador simulado por la plataforma; no existe físicamente',
    city: 'Itagüí',
    latitude: 6.1849,
    longitude: -75.5992,
    accessType: 'PUBLIC' as const,
  },
};

export interface SyntheticCredentials {
  chargePointId: string;
  chargeBoxId: string;
  authorizationKey: string;
}

/** Camino hasta OPERATIONAL desde cada estado del ciclo de vida (ADR 0013). */
const PATH_TO_OPERATIONAL: Record<LifecycleState, LifecycleState[]> = {
  INVENTORIED: ['PROVISIONED', 'CONNECTED_PENDING', 'CONFIGURED', 'TESTED', 'OPERATIONAL'],
  PROVISIONED: ['CONNECTED_PENDING', 'CONFIGURED', 'TESTED', 'OPERATIONAL'],
  CONNECTED_PENDING: ['CONFIGURED', 'TESTED', 'OPERATIONAL'],
  CONFIGURED: ['TESTED', 'OPERATIONAL'],
  TESTED: ['OPERATIONAL'],
  OPERATIONAL: [],
  MAINTENANCE: ['OPERATIONAL'],
  REJECTED: ['PROVISIONED', 'CONNECTED_PENDING', 'CONFIGURED', 'TESTED', 'OPERATIONAL'],
  DECOMMISSIONED: [],
};

/**
 * Alta idempotente del cargador sintético: sede `SYNTH`, cargador de dos conectores DC, credencial
 * de larga duración y ciclo de vida OPERATIONAL sin pasar por el comisionamiento (es un dispositivo
 * de la plataforma, no un cargador real). Oculto en la app salvo que se pida publicarlo como
 * estación de pruebas (iteración 9: dev y staging), en cuyo caso también garantiza la tarifa base
 * para que la app muestre precio y permita iniciar una carga.
 */
/** Gabinete de 180 kW compartido entre dos conectores, como los cargadores reales (ADR 0026). */
const SYNTHETIC_CABINET_POWER_W = 180_000;

export async function ensureSyntheticChargePoint(
  sql: Sql,
  input: SyntheticSeedInput,
): Promise<SyntheticCredentials> {
  const actor = input.actor ?? 'system:synthetic-charger';
  const visible = input.visibleInApp === true;
  const siteId = await ensureSite(sql, input.siteCode, visible);
  let chargePoint = await findChargePointByChargeBoxId(sql, input.chargeBoxId);
  if (!chargePoint) {
    chargePoint = await createChargePoint(sql, {
      tenantId: VOLT_TENANT_ID,
      siteId,
      chargeBoxId: input.chargeBoxId,
      vendor: 'VoltSim',
      model: 'SIM-DC180',
      serialNumber: `${input.chargeBoxId}-SN`,
      securityProfile: 2,
      heartbeatIntervalS: 60,
      maxPowerW: SYNTHETIC_CABINET_POWER_W,
      connectors: [1, 2].map((ocppConnectorId) => ({
        ocppConnectorId,
        standard: 'IEC_62196_T2_COMBO' as const,
        powerType: 'DC' as const,
        maxPowerW: SYNTHETIC_CABINET_POWER_W,
      })),
    });
  } else if (chargePoint.max_power_w === null) {
    // Cargadores creados antes de la potencia por gabinete (ADR 0026): 180 kW compartidos.
    chargePoint = await updateChargePointPower(sql, chargePoint.id, {
      maxPowerW: SYNTHETIC_CABINET_POWER_W,
      connectors: [1, 2].map((ocppConnectorId) => ({
        ocppConnectorId,
        maxPowerW: SYNTHETIC_CABINET_POWER_W,
      })),
    });
  }
  if (chargePoint.lifecycle_status === 'DECOMMISSIONED') {
    throw new Error(`el cargador sintético ${input.chargeBoxId} está dado de baja`);
  }
  const credential = await issueCredential(sql, {
    chargePointId: chargePoint.id,
    issuedBy: actor,
    bootstrapTtlHours: 24 * 365 * 5,
  });
  let current = credential.lifecycle as LifecycleState;
  for (const next of PATH_TO_OPERATIONAL[current] ?? []) {
    const result = await transitionLifecycle(sql, {
      chargePointId: chargePoint.id,
      to: next,
      actor,
      reason: 'cargador sintético de la plataforma',
    });
    current = result.to;
  }
  await sql`
    UPDATE assets.charge_point SET visible_in_app = ${visible}, updated_at = now()
    WHERE id = ${chargePoint.id} AND visible_in_app <> ${visible}`;
  if (visible) {
    await sql`UPDATE assets.evse SET visible_in_app = true WHERE charge_point_id = ${chargePoint.id}`;
    await ensureBaseTariff(sql, { tenantId: VOLT_TENANT_ID, actor });
  }
  return {
    chargePointId: chargePoint.id,
    chargeBoxId: input.chargeBoxId,
    authorizationKey: credential.authorizationKey,
  };
}

async function ensureSite(sql: Sql, code: string, visible: boolean): Promise<string> {
  const preset = visible ? SITE_PRESETS.visible : SITE_PRESETS.hidden;
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM assets.site WHERE tenant_id = ${VOLT_TENANT_ID} AND code = ${code}`;
  const existing = rows[0];
  if (existing) {
    // Cambio de modo (oculto ↔ estación de pruebas): la sede se renombra y se reubica.
    if (existing.name !== preset.name) {
      await sql`
        UPDATE assets.site
        SET name = ${preset.name}, address = ${preset.address}, city = ${preset.city},
            latitude = ${preset.latitude}, longitude = ${preset.longitude},
            access_type = ${preset.accessType}, updated_at = now()
        WHERE id = ${existing.id}`;
    }
    return existing.id;
  }
  const site = await createSite(sql, {
    tenantId: VOLT_TENANT_ID,
    code,
    name: preset.name,
    address: preset.address,
    city: preset.city,
    countryCode: 'CO',
    latitude: preset.latitude,
    longitude: preset.longitude,
    timezone: 'America/Bogota',
    accessType: preset.accessType,
  });
  return site.id;
}
