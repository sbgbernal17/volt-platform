import { findChargePointByChargeBoxId, VOLT_TENANT_ID } from '@volt/csms';
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

    const second = await ensureSyntheticChargePoint(sql, {
      chargeBoxId: 'VOLT-SYNTH-TEST',
      siteCode: 'SYNTH',
    });
    expect(second.chargePointId).toBe(first.chargePointId);
    expect(second.authorizationKey).not.toBe(first.authorizationKey);
    const sites = await sql`SELECT id FROM assets.site WHERE code = 'SYNTH'`;
    expect(sites).toHaveLength(1);
  });
});
