import {
  CommandService,
  CommissioningService,
  createChargePoint,
  createConfigTemplate,
  createSite,
  type GatewaySender,
  listAlarms,
  VOLT_TENANT_ID,
} from '@volt/csms';
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { CallOutcome, SendCallInput } from '@volt/gateway-client';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dailyAt, runConfigDriftCheck } from './config-drift.ts';

const baseUrl = process.env.DATABASE_URL;
const silent = { info: () => undefined, error: () => undefined };

describe('dailyAt', () => {
  it('ejecuta una sola vez al día a la hora indicada', async () => {
    let now = new Date('2026-09-22T08:59:00Z');
    let runs = 0;
    const job = dailyAt(
      'x',
      9,
      async () => {
        runs += 1;
      },
      () => now,
    );
    await job.run();
    expect(runs).toBe(0);
    now = new Date('2026-09-22T09:00:30Z');
    await job.run();
    await job.run();
    expect(runs).toBe(1);
    now = new Date('2026-09-23T09:15:00Z');
    await job.run();
    expect(runs).toBe(2);
  });
});

class FakeGateway implements GatewaySender {
  private calls = 0;
  constructor(private readonly heartbeat: string) {}
  async sendCall(input: SendCallInput): Promise<CallOutcome> {
    this.calls += 1;
    if (input.chargeBoxId === 'CP-OFF') {
      return { ok: false, error: { code: 'NOT_CONNECTED', description: 'sin socket' } };
    }
    return {
      ok: true,
      uniqueId: `${this.heartbeat}-${this.calls}`,
      rttMs: 1,
      podId: 'fake',
      result: {
        configurationKey: [{ key: 'HeartbeatInterval', readonly: false, value: this.heartbeat }],
        unknownKey: [],
      },
    };
  }
}

describe.skipIf(!baseUrl)('revisión diaria de deriva', () => {
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

  it('consulta los cargadores operativos conectados y abre alarma cuando hay deriva', async () => {
    const site = await createSite(sql, {
      tenantId: VOLT_TENANT_ID,
      code: 'S',
      name: 'S',
      address: 'a',
      latitude: 1,
      longitude: 1,
      timezone: 'America/Bogota',
    });
    const template = await createConfigTemplate(sql, {
      tenantId: VOLT_TENANT_ID,
      name: 't',
      keys: { HeartbeatInterval: '300' },
    });
    const ids: string[] = [];
    for (const chargeBoxId of ['CP-OK', 'CP-OFF', 'CP-INV']) {
      const cp = await createChargePoint(sql, {
        tenantId: VOLT_TENANT_ID,
        siteId: site.id,
        chargeBoxId,
        configTemplateId: template.id,
        connectors: [{ ocppConnectorId: 1, standard: 'IEC_62196_T2', powerType: 'AC_3_PHASE' }],
      });
      ids.push(cp.id);
    }
    // CP-OK y CP-OFF operativos y conectados; CP-INV sigue en inventario y no se consulta.
    await sql`UPDATE assets.charge_point SET lifecycle_status = 'OPERATIONAL', connected = true WHERE charge_box_id IN ('CP-OK', 'CP-OFF')`;
    const commissioning = new CommissioningService(
      sql,
      new CommandService(sql, new FakeGateway('60')),
    );
    const summary = await runConfigDriftCheck({
      sql,
      commissioning,
      logger: silent,
      ratePerSecond: 1000,
    });
    expect(summary).toEqual({ checked: 1, drifted: 1, offline: 1, failed: 0 });
    const alarms = await listAlarms(sql, { tenantId: VOLT_TENANT_ID });
    expect(alarms.map((a) => [a.kind, a.charge_point_id])).toEqual([['CONFIG_DRIFT', ids[0]]]);

    // El cargador vuelve al valor deseado: la alarma se resuelve.
    const fixed = new CommissioningService(sql, new CommandService(sql, new FakeGateway('300')));
    const again = await runConfigDriftCheck({
      sql,
      commissioning: fixed,
      logger: silent,
      ratePerSecond: 1000,
    });
    expect(again).toMatchObject({ checked: 1, drifted: 0 });
    expect(await listAlarms(sql, { tenantId: VOLT_TENANT_ID })).toEqual([]);
  }, 30_000);
});
