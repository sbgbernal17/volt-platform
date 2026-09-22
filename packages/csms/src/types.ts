import type { Sql } from 'postgres';

/** Parámetro jsonb a partir de cualquier valor serializable (los tipos de postgres.js son estrechos). */
export function toJson(sql: Sql, value: unknown) {
  return sql.json(value as Parameters<Sql['json']>[0]);
}

/** Enumeraciones del esquema `assets` (DAT §7, migración inicial). */
export const CONNECTOR_STANDARDS = [
  'IEC_62196_T1',
  'IEC_62196_T1_COMBO',
  'IEC_62196_T2',
  'IEC_62196_T2_COMBO',
  'CHADEMO',
  'GBT_AC',
  'GBT_DC',
  'NACS',
  'DOMESTIC_A',
  'DOMESTIC_F',
  'DOMESTIC_G',
  'OTHER',
] as const;
export type ConnectorStandard = (typeof CONNECTOR_STANDARDS)[number];

export const POWER_TYPES = ['AC_1_PHASE', 'AC_2_PHASE', 'AC_3_PHASE', 'DC'] as const;
export type PowerType = (typeof POWER_TYPES)[number];

export const SITE_ACCESS_TYPES = ['PUBLIC', 'PRIVATE', 'SEMI_PUBLIC'] as const;
export type SiteAccessType = (typeof SITE_ACCESS_TYPES)[number];

export const SITE_STATUSES = ['PLANNED', 'ACTIVE', 'MAINTENANCE', 'RETIRED'] as const;

/** Tenant único de la plataforma, sembrado por la migración 0002 (ADR 0004). */
export const VOLT_TENANT_ID = 'a0000000-0000-4000-8000-000000000001';

/** Logger mínimo compatible con pino. */
export interface CsmsLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export const silentLogger: CsmsLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
