import { createChargePoint, createSite, listAlarms, VOLT_TENANT_ID } from '@volt/csms';
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { offlineFingerprint, watchConnections } from './connection-watch.ts';

const baseUrl = process.env.DATABASE_URL;

describe.skipIf(!baseUrl)('vigilancia de conexiones (alarma CHARGER_OFFLINE)', () => {
  let database: TemporaryDatabase;
  let sql: Sql;
  const logged: Record<string, unknown>[] = [];
  const logger = {
    info: (payload: unknown) => {
      if (payload && typeof payload === 'object') logged.push(payload as Record<string, unknown>);
    },
    error: () => undefined,
  };
  const ids: string[] = [];

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    sql = createSql(database.url, { max: 2 });
    const site = await createSite(sql, {
      tenantId: VOLT_TENANT_ID,
      code: 'WATCH',
      name: 'Sede vigilada',
      address: 'Calle 1',
      latitude: 4.6,
      longitude: -74.1,
      timezone: 'America/Bogota',
    });
    for (const code of ['WATCH-A', 'WATCH-B', 'WATCH-C']) {
      const cp = await createChargePoint(sql, {
        tenantId: VOLT_TENANT_ID,
        siteId: site.id,
        chargeBoxId: code,
        connectors: [{ ocppConnectorId: 1, standard: 'IEC_62196_T2_COMBO', powerType: 'DC' }],
      });
      ids.push(cp.id);
    }
    // Operativos y conectados hace un rato (sin pasar por el comisionamiento completo).
    await sql`
      UPDATE assets.charge_point
      SET lifecycle_status = 'OPERATIONAL', connected = true, last_seen_at = now() - interval '5 minutes',
          updated_at = now() - interval '10 minutes'
      WHERE id = ANY(${ids})`;
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await database.drop();
  });

  it('no abre alarmas mientras los cargadores están conectados', async () => {
    const summary = await watchConnections(sql, { graceS: 30, siteCriticalRatio: 0.3, logger });
    expect(summary).toEqual({ operational: 3, offline: 0, raised: 0, resolved: 0 });
  });

  it('respeta la gracia tras una desconexión y luego abre la alarma con la severidad por sede', async () => {
    await sql`
      UPDATE assets.charge_point SET connected = false, last_disconnect_at = now() - interval '10 seconds'
      WHERE id = ${ids[0] as string}`;
    let summary = await watchConnections(sql, { graceS: 30, siteCriticalRatio: 0.5, logger });
    expect(summary.offline).toBe(0);

    await sql`
      UPDATE assets.charge_point SET last_disconnect_at = now() - interval '2 minutes'
      WHERE id = ${ids[0] as string}`;
    summary = await watchConnections(sql, { graceS: 30, siteCriticalRatio: 0.5, logger });
    expect(summary).toMatchObject({ offline: 1, raised: 1, resolved: 0 });
    const alarms = await listAlarms(sql, { tenantId: VOLT_TENANT_ID });
    const alarm = alarms.find((a) => a.fingerprint === offlineFingerprint('WATCH-A'));
    expect(alarm?.severity).toBe('WARNING');
    expect(alarm?.status).toBe('OPEN');
    expect(logged.at(-1)).toMatchObject({ event: 'alarm.raised', kind: 'CHARGER_OFFLINE' });

    // Una segunda vuelta no vuelve a registrar la apertura.
    summary = await watchConnections(sql, { graceS: 30, siteCriticalRatio: 0.5, logger });
    expect(summary.raised).toBe(0);

    // Con dos de tres cargadores caídos la sede supera el umbral: la alarma pasa a CRITICAL.
    await sql`
      UPDATE assets.charge_point SET connected = false, last_disconnect_at = now() - interval '2 minutes'
      WHERE id = ${ids[1] as string}`;
    summary = await watchConnections(sql, { graceS: 30, siteCriticalRatio: 0.5, logger });
    expect(summary.offline).toBe(2);
    const critical = (await listAlarms(sql, { tenantId: VOLT_TENANT_ID })).filter(
      (a) => a.kind === 'CHARGER_OFFLINE' && a.status === 'OPEN',
    );
    expect(critical.map((a) => a.severity)).toEqual(['CRITICAL', 'CRITICAL']);
  });

  it('resuelve la alarma cuando el cargador vuelve a conectarse', async () => {
    await sql`
      UPDATE assets.charge_point SET connected = true, last_seen_at = now()
      WHERE id = ANY(${[ids[0] as string, ids[1] as string]})`;
    const summary = await watchConnections(sql, { graceS: 30, siteCriticalRatio: 0.5, logger });
    expect(summary).toMatchObject({ offline: 0, resolved: 2 });
    const open = (await listAlarms(sql, { tenantId: VOLT_TENANT_ID })).filter(
      (a) => a.kind === 'CHARGER_OFFLINE' && a.status === 'OPEN',
    );
    expect(open).toHaveLength(0);
    expect(logged.at(-1)).toMatchObject({ event: 'alarm.resolved' });
  });
});
