/**
 * Parámetros configurables por alcance (FUN M20): definiciones sembradas por migración, valores por
 * alcance con vigencia y resolución CONNECTOR > CHARGE_POINT > SITE > TENANT > PLATFORM > default.
 */
import { randomUUID } from 'node:crypto';
import type { ISql } from 'postgres';
import { NotFoundError, ValidationError } from '../errors.ts';
import { toJson } from '../types.ts';

export type ParamScopeType = 'PLATFORM' | 'TENANT' | 'SITE' | 'CHARGE_POINT' | 'CONNECTOR';

export interface ParamDefinitionRow {
  key: string;
  value_schema: Record<string, unknown>;
  allowed_scopes: ParamScopeType[];
  default_value: unknown;
  description: string | null;
  requires_restart: boolean;
}

export interface ConfigParamRow {
  id: string;
  key: string;
  scope_type: ParamScopeType;
  scope_id: string | null;
  value: unknown;
  valid_from: Date;
  valid_to: Date | null;
  updated_by: string;
  reason: string | null;
}

export async function listParamDefinitions(db: ISql): Promise<ParamDefinitionRow[]> {
  return db<ParamDefinitionRow[]>`SELECT * FROM config.param_definition ORDER BY key`;
}

export async function getParamDefinition(db: ISql, key: string): Promise<ParamDefinitionRow> {
  const rows = await db<
    ParamDefinitionRow[]
  >`SELECT * FROM config.param_definition WHERE key = ${key}`;
  const row = rows[0];
  if (!row) throw new NotFoundError('parameter', key);
  return row;
}

/** Valores vigentes de un parámetro (o de todos) en todos los alcances. */
export async function listParamValues(db: ISql, key?: string): Promise<ConfigParamRow[]> {
  return db<ConfigParamRow[]>`
    SELECT * FROM config.config_param
    WHERE (${key ?? null}::text IS NULL OR key = ${key ?? null})
      AND now() >= valid_from AND (valid_to IS NULL OR now() < valid_to)
    ORDER BY key, scope_type, valid_from DESC`;
}

/**
 * Valor efectivo. Con `connectorId` usa `config.resolve` (cinco niveles); sin él resuelve
 * TENANT > PLATFORM > default, que es lo que necesitan los trabajos sin contexto de conector.
 */
export async function resolveParam<T = unknown>(
  db: ISql,
  key: string,
  scope: { connectorId?: string | null | undefined; tenantId?: string | undefined } = {},
): Promise<T> {
  if (scope.connectorId) {
    const rows = await db<
      { value: T | null }[]
    >`SELECT config.resolve(${key}, ${scope.connectorId}::uuid) AS value`;
    const value = rows[0]?.value;
    if (value !== null && value !== undefined) return value;
  }
  const rows = await db<{ value: T | null }[]>`
    SELECT COALESCE(
      (SELECT p.value FROM config.config_param p
        WHERE p.key = ${key} AND now() >= p.valid_from AND (p.valid_to IS NULL OR now() < p.valid_to)
          AND ((p.scope_type = 'TENANT' AND p.scope_id = ${scope.tenantId ?? null}::uuid) OR p.scope_type = 'PLATFORM')
        ORDER BY CASE p.scope_type WHEN 'TENANT' THEN 1 ELSE 2 END, p.valid_from DESC LIMIT 1),
      (SELECT default_value FROM config.param_definition WHERE key = ${key})) AS value`;
  const value = rows[0]?.value;
  if (value === null || value === undefined) throw new NotFoundError('parameter', key);
  return value;
}

export interface SetParamInput {
  key: string;
  scopeType: ParamScopeType;
  scopeId?: string | null | undefined;
  value: unknown;
  updatedBy: string;
  reason?: string | undefined;
  tenantId: string;
}

/** Fija un valor: cierra la vigencia del anterior en el mismo alcance y deja rastro en la auditoría. */
export async function setParam(db: ISql, input: SetParamInput): Promise<ConfigParamRow> {
  const definition = await getParamDefinition(db, input.key);
  if (!definition.allowed_scopes.includes(input.scopeType)) {
    throw new ValidationError(`El parámetro ${input.key} no admite el alcance ${input.scopeType}`, {
      allowedScopes: definition.allowed_scopes,
    });
  }
  const scopeId = input.scopeType === 'PLATFORM' ? null : (input.scopeId ?? null);
  if (input.scopeType !== 'PLATFORM' && !scopeId) {
    throw new ValidationError(`El alcance ${input.scopeType} necesita scopeId`);
  }
  const problem = checkValue(definition.value_schema, input.value);
  if (problem)
    throw new ValidationError(`Valor inválido para ${input.key}: ${problem}`, {
      schema: definition.value_schema,
    });
  const before = await db<ConfigParamRow[]>`
    SELECT * FROM config.config_param
    WHERE key = ${input.key} AND scope_type = ${input.scopeType} AND scope_id IS NOT DISTINCT FROM ${scopeId}::uuid
      AND valid_to IS NULL`;
  await db`
    UPDATE config.config_param SET valid_to = now()
    WHERE key = ${input.key} AND scope_type = ${input.scopeType} AND scope_id IS NOT DISTINCT FROM ${scopeId}::uuid
      AND valid_to IS NULL`;
  const rows = await db<ConfigParamRow[]>`
    INSERT INTO config.config_param (id, key, scope_type, scope_id, value, valid_from, updated_by, reason)
    VALUES (${randomUUID()}, ${input.key}, ${input.scopeType}, ${scopeId}::uuid, ${toJson(db as never, input.value)},
            now(), ${input.updatedBy}, ${input.reason ?? null})
    RETURNING *`;
  const row = rows[0] as ConfigParamRow;
  await db`
    INSERT INTO tariffs.tariff_audit (tenant_id, entity, entity_id, action, actor, before, after)
    VALUES (${input.tenantId}, 'parameter', ${`${input.key}@${input.scopeType}:${scopeId ?? '*'}`}, 'SET', ${input.updatedBy},
            ${before[0] ? toJson(db as never, { value: before[0].value }) : null},
            ${toJson(db as never, { value: input.value, reason: input.reason ?? null })})`;
  return row;
}

/** Comprobación mínima del JSON Schema de la definición (tipo, enum, mínimo, máximo). */
export function checkValue(schema: Record<string, unknown>, value: unknown): string | null {
  const type = schema.type;
  if (type === 'integer' && !(typeof value === 'number' && Number.isInteger(value)))
    return 'debe ser un entero';
  if (type === 'number' && typeof value !== 'number') return 'debe ser un número';
  if (type === 'boolean' && typeof value !== 'boolean') return 'debe ser booleano';
  if (type === 'string' && typeof value !== 'string') return 'debe ser texto';
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    return `debe ser uno de ${schema.enum.join(', ')}`;
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum)
      return `debe ser ≥ ${schema.minimum}`;
    if (typeof schema.maximum === 'number' && value > schema.maximum)
      return `debe ser ≤ ${schema.maximum}`;
  }
  return null;
}
