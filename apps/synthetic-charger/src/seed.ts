import {
  createChargePoint,
  createSite,
  findChargePointByChargeBoxId,
  issueCredential,
  transitionLifecycle,
  VOLT_TENANT_ID,
} from '@volt/csms';
import type { LifecycleState } from '@volt/domain';
import type { Sql } from 'postgres';

export interface SyntheticSeedInput {
  chargeBoxId: string;
  siteCode: string;
  actor?: string;
}

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
 * Alta idempotente del cargador sintético: sede privada `SYNTH`, cargador de dos conectores DC,
 * credencial de larga duración y ciclo de vida OPERATIONAL sin pasar por el comisionamiento
 * (es un dispositivo de la plataforma, no un cargador real). Nunca es visible en la app.
 */
export async function ensureSyntheticChargePoint(
  sql: Sql,
  input: SyntheticSeedInput,
): Promise<SyntheticCredentials> {
  const actor = input.actor ?? 'system:synthetic-charger';
  let chargePoint = await findChargePointByChargeBoxId(sql, input.chargeBoxId);
  if (!chargePoint) {
    const siteId = await ensureSite(sql, input.siteCode);
    chargePoint = await createChargePoint(sql, {
      tenantId: VOLT_TENANT_ID,
      siteId,
      chargeBoxId: input.chargeBoxId,
      vendor: 'VoltSim',
      model: 'SIM-DC180',
      serialNumber: `${input.chargeBoxId}-SN`,
      securityProfile: 2,
      heartbeatIntervalS: 60,
      connectors: [1, 2].map((ocppConnectorId) => ({
        ocppConnectorId,
        standard: 'IEC_62196_T2_COMBO' as const,
        powerType: 'DC' as const,
        maxPowerW: 90_000,
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
    UPDATE assets.charge_point SET visible_in_app = false, updated_at = now()
    WHERE id = ${chargePoint.id} AND visible_in_app`;
  return {
    chargePointId: chargePoint.id,
    chargeBoxId: input.chargeBoxId,
    authorizationKey: credential.authorizationKey,
  };
}

async function ensureSite(sql: Sql, code: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM assets.site WHERE tenant_id = ${VOLT_TENANT_ID} AND code = ${code}`;
  if (rows[0]) return rows[0].id;
  const site = await createSite(sql, {
    tenantId: VOLT_TENANT_ID,
    code,
    name: 'Cargadores sintéticos (plataforma)',
    address: 'Virtual',
    city: 'Bogotá',
    countryCode: 'CO',
    latitude: 4.711,
    longitude: -74.0721,
    timezone: 'America/Bogota',
    accessType: 'PRIVATE',
  });
  return site.id;
}
