/**
 * Borra y recrea la base de datos local y vuelve a aplicar las migraciones.
 * Solo funciona contra localhost salvo que se pase --force (nunca en producción).
 */
import postgres from 'postgres';
import { runMigrations } from '../src/index.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}
const parsed = new URL(url);
const force = process.argv.includes('--force');
if (!['localhost', '127.0.0.1'].includes(parsed.hostname) && !force) {
  console.error(`Me niego a resetear ${parsed.hostname} sin --force`);
  process.exit(1);
}
const dbName = parsed.pathname.replace(/^\//, '');
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';

const admin = postgres(adminUrl.toString(), { max: 1 });
try {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
} finally {
  await admin.end();
}
const applied = await runMigrations({ databaseUrl: url });
console.log(`Base ${dbName} recreada; migraciones aplicadas: ${applied.join(', ') || 'ninguna'}`);
