import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_SCHEMAS, createSql, runMigrations } from './index.ts';

const baseUrl = process.env.DATABASE_URL;

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

describe.skipIf(!baseUrl)('migración inicial del modelo de datos', () => {
  const dbName = `volt_test_${randomBytes(4).toString('hex')}`;
  const adminUrl = baseUrl as string;
  const testUrl = withDatabase(adminUrl, dbName);
  const admin = postgres(adminUrl, { max: 1 });

  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
  }, 30_000);

  afterAll(async () => {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }, 30_000);

  it('aplica la migración en una base vacía y crea los esquemas, tablas y funciones', async () => {
    const applied = await runMigrations({ databaseUrl: testUrl, silent: true });
    expect(applied.length).toBeGreaterThanOrEqual(1);

    const sql = createSql(testUrl, { max: 1 });
    try {
      const schemas = await sql<{ nspname: string }[]>`
        SELECT nspname FROM pg_namespace WHERE nspname = ANY(${[...APP_SCHEMAS]})`;
      expect(schemas.map((s) => s.nspname).sort()).toEqual([...APP_SCHEMAS].sort());

      const tables = await sql<{ count: bigint }[]>`
        SELECT count(*)::bigint AS count FROM information_schema.tables
        WHERE table_schema = ANY(${[...APP_SCHEMAS]}) AND table_type = 'BASE TABLE'`;
      expect(Number(tables[0]?.count ?? 0)).toBeGreaterThanOrEqual(29);

      const functions = await sql<{ proname: string }[]>`
        SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = ANY(${[...APP_SCHEMAS]})`;
      expect(functions.length).toBeGreaterThan(0);

      // La migración es idempotente: una segunda ejecución no aplica nada.
      const again = await runMigrations({ databaseUrl: testUrl, silent: true });
      expect(again).toEqual([]);
    } finally {
      await sql.end();
    }
  }, 60_000);
});
