import { fileURLToPath } from 'node:url';
import { type RunnerOption, runner } from 'node-pg-migrate';
import postgres, { type Sql } from 'postgres';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export interface MigrateOptions {
  databaseUrl: string;
  direction?: 'up' | 'down';
  /** Número de migraciones a aplicar; por defecto todas. */
  count?: number;
  silent?: boolean;
}

/** Aplica las migraciones SQL de `migrations/` con node-pg-migrate y devuelve sus nombres. */
export async function runMigrations(options: MigrateOptions): Promise<string[]> {
  const runnerOptions: RunnerOption = {
    databaseUrl: options.databaseUrl,
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
}

/** Cliente postgres.js para consultas de la aplicación (una instancia por proceso). */
export function createSql(databaseUrl: string, options: SqlOptions = {}): Sql {
  return postgres(databaseUrl, {
    max: options.max ?? 10,
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
