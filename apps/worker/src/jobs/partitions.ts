import type { Sql } from 'postgres';
import type { SchedulerLogger } from '../scheduler.ts';

/** Tablas particionadas por rango de tiempo con partición mensual gestionada por el worker. */
export const PARTITIONED_TABLES = [
  { schema: 'sessions', table: 'meter_value' },
  { schema: 'ops', table: 'ocpp_message_log' },
] as const;

function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/**
 * Crea (si no existen) las particiones del mes actual y de los siguientes `monthsAhead` meses
 * (DAT §6.5, sin pg_partman). La partición DEFAULT de cada tabla recoge lo que no encaje; si ya
 * contiene filas del mes que se intenta crear, PostgreSQL rechaza la partición y se deja avisado.
 */
export async function ensureMonthlyPartitions(
  sql: Sql,
  options: { now?: Date; monthsAhead?: number; logger?: SchedulerLogger } = {},
): Promise<string[]> {
  const now = options.now ?? new Date();
  const created: string[] = [];
  for (const { schema, table } of PARTITIONED_TABLES) {
    for (let offset = 0; offset <= (options.monthsAhead ?? 1); offset++) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth() + 1;
      const next = new Date(Date.UTC(year, month, 1));
      const name = `${table}_${year}${String(month).padStart(2, '0')}`;
      const exists = await sql`
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ${schema} AND c.relname = ${name}`;
      if (exists.length > 0) continue;
      try {
        await sql.unsafe(
          `CREATE TABLE ${schema}.${name} PARTITION OF ${schema}.${table}
           FOR VALUES FROM ('${monthStart(year, month)}') TO ('${monthStart(next.getUTCFullYear(), next.getUTCMonth() + 1)}')`,
        );
        created.push(`${schema}.${name}`);
      } catch (error) {
        options.logger?.error(
          { err: error, partition: `${schema}.${name}` },
          'no se pudo crear la partición',
        );
      }
    }
  }
  if (created.length > 0) options.logger?.info({ created }, 'particiones creadas');
  return created;
}
