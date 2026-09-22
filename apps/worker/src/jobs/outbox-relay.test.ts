import { appendEvent, VOLT_TENANT_ID } from '@volt/csms';
import { createSql } from '@volt/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@volt/db/testing';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryEventPublisher, relayOutbox } from './outbox-relay.ts';
import { ensureMonthlyPartitions } from './partitions.ts';

const baseUrl = process.env.DATABASE_URL;
const silent = { info: () => undefined, error: () => undefined };

describe.skipIf(!baseUrl)('relay del outbox y particiones', () => {
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

  it('publica los eventos pendientes en orden, con reintento tras un fallo', async () => {
    for (let i = 0; i < 3; i++) {
      await appendEvent(sql, {
        name: 'session.metered',
        tenantId: VOLT_TENANT_ID,
        aggregate: { type: 'session', id: 'ses-1' },
        orderingKey: 'CP-1',
        payload: { i },
      });
    }
    const publisher = new MemoryEventPublisher();
    publisher.failNext = true;
    expect(await relayOutbox(sql, publisher, { logger: silent })).toBe(0);
    const failed = await sql<{ attempts: number; last_error: string | null }[]>`
      SELECT attempts, last_error FROM ops.event_outbox ORDER BY id`;
    expect(failed.every((row) => row.attempts === 1 && row.last_error?.includes('simulada'))).toBe(
      true,
    );
    expect(await relayOutbox(sql, publisher, { logger: silent, batch: 2 })).toBe(2);
    expect(await relayOutbox(sql, publisher, { logger: silent, batch: 2 })).toBe(1);
    expect(await relayOutbox(sql, publisher, { logger: silent })).toBe(0);
    expect(publisher.published.map((e) => (e.payload.payload as { i: number }).i)).toEqual([
      0, 1, 2,
    ]);
    const pending = await sql<
      { count: bigint }[]
    >`SELECT count(*)::bigint AS count FROM ops.event_outbox WHERE published_at IS NULL`;
    expect(Number(pending[0]?.count)).toBe(0);
  });

  it('crea las particiones mensuales de mediciones y del log OCPP', async () => {
    const now = new Date('2027-03-15T00:00:00Z');
    const created = await ensureMonthlyPartitions(sql, { now, monthsAhead: 1, logger: silent });
    expect(created).toEqual([
      'sessions.meter_value_202703',
      'sessions.meter_value_202704',
      'ops.ocpp_message_log_202703',
      'ops.ocpp_message_log_202704',
    ]);
    expect(await ensureMonthlyPartitions(sql, { now, monthsAhead: 1, logger: silent })).toEqual([]);
    await sql`INSERT INTO ops.ocpp_message_log (ts, charge_box_id, direction, message_type, unique_id)
              VALUES ('2027-03-20T10:00:00Z', 'CP-P', 'CP2CS', 2, 'u')`;
    const placed = await sql<{ tableoid: string }[]>`
      SELECT tableoid::regclass::text AS tableoid FROM ops.ocpp_message_log WHERE charge_box_id = 'CP-P'`;
    expect(placed[0]?.tableoid).toBe('ops.ocpp_message_log_202703');
  });
});
