/**
 * Aplica las migraciones SQL (Cloud Run Job `migrate`, ADR 0023). Sale con 0 si no hay nada que
 * aplicar. Lee DATABASE_URL y, con Cloud SQL, DATABASE_SSL_CA (verificación de la CA del servidor).
 */
import { runMigrations } from '@volt/db';
import { createLogger } from '@volt/logging';

const logger = createLogger({ service: 'migrate', level: 'info', env: process.env.VOLT_ENV });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  logger.fatal('falta DATABASE_URL');
  process.exit(2);
}

try {
  const applied = await runMigrations({
    databaseUrl,
    sslCa: process.env.DATABASE_SSL_CA,
    silent: true,
  });
  logger.info(
    { applied },
    applied.length === 0 ? 'sin migraciones pendientes' : 'migraciones aplicadas',
  );
  process.exit(0);
} catch (error) {
  logger.fatal({ err: error }, 'migración fallida');
  process.exit(1);
}
