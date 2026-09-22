import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { runMigrations } from './index.ts';

export interface TemporaryDatabase {
  /** URL de conexión de la base temporal ya migrada. */
  url: string;
  name: string;
  /** Elimina la base temporal (con FORCE) y cierra la conexión administrativa. */
  drop(): Promise<void>;
}

/**
 * Crea una base de datos temporal (`volt_test_<hex>`) a partir de la URL administrativa y aplica
 * todas las migraciones. Cada suite de pruebas usa la suya para no compartir estado.
 */
export async function createTemporaryDatabase(adminUrl: string): Promise<TemporaryDatabase> {
  const name = `volt_test_${randomBytes(4).toString('hex')}`;
  const admin = postgres(adminUrl, { max: 1 });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${name}`;
  const url = parsed.toString();
  try {
    await runMigrations({ databaseUrl: url, silent: true });
  } catch (error) {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
    throw error;
  }
  return {
    url,
    name,
    drop: async () => {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}
