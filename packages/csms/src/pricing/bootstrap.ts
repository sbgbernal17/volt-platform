/**
 * Arranque de precios de un tenant: crea la tarifa base de Volt (versión 1 publicada) y la
 * asignación de respaldo PLATFORM/PUBLIC si no existen. Idempotente; pensado para el primer
 * despliegue, las pruebas y el laboratorio. Los precios se cambian después creando versiones.
 */
import { VOLT_BASE_TARIFF } from '@volt/tariff-engine';
import type { Sql } from 'postgres';
import { createAssignment, listAssignments, type TariffAssignmentRow } from './assignments.ts';
import {
  createTariff,
  createTariffVersion,
  findEffectiveVersion,
  findTariffByCode,
  publishTariffVersion,
  type TariffRow,
  type TariffVersionRow,
} from './tariffs.ts';

export interface EnsureBaseTariffInput {
  tenantId: string;
  actor: string;
  /** Definición alternativa (por defecto la tarifa base de Volt). */
  definition?: unknown;
  code?: string | undefined;
  name?: string | undefined;
  taxIncluded?: boolean | undefined;
  validFrom?: Date | undefined;
  now?: Date | undefined;
}

export interface EnsureBaseTariffResult {
  tariff: TariffRow;
  version: TariffVersionRow;
  assignment: TariffAssignmentRow;
  created: { tariff: boolean; version: boolean; assignment: boolean };
}

export async function ensureBaseTariff(
  sql: Sql,
  input: EnsureBaseTariffInput,
): Promise<EnsureBaseTariffResult> {
  const now = input.now ?? new Date();
  const code = input.code ?? VOLT_BASE_TARIFF.id;
  const definition = input.definition ?? VOLT_BASE_TARIFF;
  const created = { tariff: false, version: false, assignment: false };
  let tariff = await findTariffByCode(sql, input.tenantId, code);
  if (!tariff) {
    tariff = await createTariff(sql, {
      tenantId: input.tenantId,
      code,
      name: input.name ?? 'Tarifa base Volt',
      currency: (definition as { currency?: string }).currency ?? 'COP',
      createdBy: input.actor,
    });
    created.tariff = true;
  }
  let version = await findEffectiveVersion(sql, tariff.id, now);
  if (!version) {
    const draft = await createTariffVersion(sql, {
      tariffId: tariff.id,
      definition,
      taxIncluded: input.taxIncluded,
      notes: 'versión inicial (bootstrap)',
      createdBy: input.actor,
    });
    version = await publishTariffVersion(sql, {
      tariffId: tariff.id,
      version: draft.version,
      validFrom: input.validFrom ?? now,
      approvedBy: input.actor,
      now,
    });
    created.version = true;
  }
  const assignments = await listAssignments(sql, input.tenantId, {
    scopeType: 'PLATFORM',
    segment: 'PUBLIC',
  });
  let assignment = assignments.find((a) => a.tariff_id === tariff.id) ?? assignments[0];
  if (!assignment) {
    assignment = await createAssignment(sql, {
      tenantId: input.tenantId,
      scopeType: 'PLATFORM',
      segment: 'PUBLIC',
      tariffId: tariff.id,
      priority: 0,
      validFrom: input.validFrom ?? now,
      createdBy: input.actor,
    });
    created.assignment = true;
  }
  return { tariff, version, assignment, created };
}
