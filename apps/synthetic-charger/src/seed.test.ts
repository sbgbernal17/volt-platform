import { findChargePointByChargeBoxId, listLocations, quoteEvse, VOLT_TENANT_ID } from '@volt/csms';
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureSyntheticChargePoint } from './seed.ts';

const baseUrl = process.env.DATABASE_URL;

describe.skipIf(!baseUrl)('alta del cargador sintético', () => {
  let database: TemporaryDatabase;
  let sql: Sql;

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    sql = createSql(database.url, { max: 2 });
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await database.drop();
  });

  it('crea sede, cargador operativo oculto y credencial; repetir solo rota la credencial', async () => {
    const first = await ensureSyntheticChargePoint(sql, {
      chargeBoxId: 'VOLT-SYNTH-TEST',
      siteCode: 'SYNTH',
    });
    expect(first.authorizationKey.length).toBeGreaterThan(16);
    const cp = await findChargePointByChargeBoxId(sql, 'VOLT-SYNTH-TEST');
    expect(cp?.lifecycle_status).toBe('OPERATIONAL');
    expect(cp?.visible_in_app).toBe(false);
    expect(cp?.tenant_id).toBe(VOLT_TENANT_ID);
    expect(cp?.max_power_w).toBe(180_000);

    const second = await ensureSyntheticChargePoint(sql, {
      chargeBoxId: 'VOLT-SYNTH-TEST',
      siteCode: 'SYNTH',
    });
    expect(second.chargePointId).toBe(first.chargePointId);
    expect(second.authorizationKey).not.toBe(first.authorizationKey);
    const sites = await sql`SELECT id FROM assets.site WHERE code = 'SYNTH'`;
    expect(sites).toHaveLength(1);
  });

  it('publicado como estación de pruebas: visible en la app, con tarifa base y precio cotizable', async () => {
    await ensureSyntheticChargePoint(sql, {
      chargeBoxId: 'VOLT-SYNTH-TEST',
      siteCode: 'SYNTH',
      visibleInApp: true,
    });
    const cp = await findChargePointByChargeBoxId(sql, 'VOLT-SYNTH-TEST');
    expect(cp?.visible_in_app).toBe(true);
    const locations = await listLocations(sql, VOLT_TENANT_ID);
    const site = locations.find((l) => l.code === 'SYNTH');
    expect(site?.name).toBe('Estación de pruebas Volt (virtual)');
    expect(site?.evses.map((e) => e.evse_code)).toEqual(['VOLT-SYNTH-TEST-1', 'VOLT-SYNTH-TEST-2']);
    // Gabinete de 180 kW compartido entre los dos conectores (ADR 0026).
    expect(site?.evses.map((e) => [e.charger_max_power_w, e.power_shared])).toEqual([
      [180_000, true],
      [180_000, true],
    ]);
    const evse = site?.evses[0];
    const quote = await quoteEvse(sql, {
      tenantId: VOLT_TENANT_ID,
      evseId: evse?.evse_uuid as string,
      segment: 'PUBLIC',
    });
    expect(quote.tariffCode).toBe('VOLT-BASE');

    // Volver al modo oculto: desaparece de la app y la sede recupera su nombre de plataforma.
    await ensureSyntheticChargePoint(sql, { chargeBoxId: 'VOLT-SYNTH-TEST', siteCode: 'SYNTH' });
    const hidden = await listLocations(sql, VOLT_TENANT_ID);
    expect(hidden.find((l) => l.code === 'SYNTH')?.evses).toEqual([]);
    expect(hidden.find((l) => l.code === 'SYNTH')?.name).toBe('Cargadores sintéticos (plataforma)');
  });
});
