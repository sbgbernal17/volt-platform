import { fileURLToPath } from 'node:url';
import { type RunnerOption, runner } from 'node-pg-migrate';
import postgres, { type Sql } from 'postgres';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export interface MigrateOptions {
  databaseUrl: string;
  /** CA del servidor (PEM) para verificar el certificado de Cloud SQL (modo verify-ca). */
  sslCa?: string | undefined;
  direction?: 'up' | 'down';
  /** Número de migraciones a aplicar; por defecto todas. */
  count?: number;
  silent?: boolean;
}

/** Aplica las migraciones SQL de `migrations/` con node-pg-migrate y devuelve sus nombres. */
export async function runMigrations(options: MigrateOptions): Promise<string[]> {
  const ssl = sslOptions(options.sslCa);
  const runnerOptions: RunnerOption = {
    databaseUrl: ssl ? { connectionString: options.databaseUrl, ssl } : options.databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: options.direction ?? 'up',
    migrationsTable: 'pgmigrations',
    count: options.count ?? Number.POSITIVE_INFINITY,
    verbose: false,
    ...(options.silent ? { log: () => undefined } : {}),
  };
  const applied = await runner(runnerOptions);
  return applied.map((migration) => migration.name);
}

export interface SqlOptions {
  max?: number;
  applicationName?: string;
  /** CA del servidor (PEM): TLS con verificación de cadena; el nombre no se comprueba porque el certificado de Cloud SQL lleva el nombre de la instancia, no la IP. */
  sslCa?: string | undefined;
}

/** Opciones TLS equivalentes a `sslmode=verify-ca`; `undefined` cuando no hay CA (desarrollo local). */
export function sslOptions(sslCa: string | undefined) {
  if (!sslCa) return undefined;
  return { ca: sslCa, rejectUnauthorized: true, checkServerIdentity: () => undefined };
}

/** Cliente postgres.js para consultas de la aplicación (una instancia por proceso). */
export function createSql(databaseUrl: string, options: SqlOptions = {}): Sql {
  const ssl = sslOptions(options.sslCa);
  return postgres(databaseUrl, {
    max: options.max ?? 10,
    ...(ssl ? { ssl } : {}),
    connection: { application_name: options.applicationName ?? 'volt' },
    // BIGINT como bigint nativo: los importes y contadores nunca pasan por Number.
    types: { bigint: postgres.BigInt },
    transform: { undefined: null },
  });
}

/** Esquemas de la aplicación creados por la migración inicial. */
export const APP_SCHEMAS = [
  'assets',
  'auth',
  'sessions',
  'tariffs',
  'billing',
  'ops',
  'config',
  'audit',
  'archive',
] as const;
