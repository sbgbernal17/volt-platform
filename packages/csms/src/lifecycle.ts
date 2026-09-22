import { canTransitionLifecycle, type LifecycleState } from '@volt/domain';
import type { Sql } from 'postgres';
import { ConflictError, NotFoundError } from './errors.ts';
import { toJson } from './types.ts';

export interface TransitionInput {
  chargePointId: string;
  to: LifecycleState;
  /** `staff:<id>`, `system:ocpp-gateway`, `system:commissioning`... */
  actor: string;
  reason?: string;
  /** Evidencia OCPP: `{"uniqueId":"…","action":"BootNotification"}` o `{"commandIds":[…]}`. */
  evidence?: Record<string, unknown>;
}

export interface TransitionResult {
  from: LifecycleState;
  to: LifecycleState;
  changed: boolean;
}

export interface LifecycleEventRow {
  id: bigint;
  charge_point_id: string;
  from_state: LifecycleState | null;
  to_state: LifecycleState;
  actor: string;
  reason: string | null;
  evidence: Record<string, unknown>;
  at: Date;
}

/**
 * Aplica una transición del ciclo de vida (OPS §1.2) con bloqueo de fila, valida el grafo del
 * dominio, registra el evento con evidencia y aplica los efectos: visibilidad en la app al pasar a
 * OPERATIONAL, ocultación en MAINTENANCE/REJECTED/DECOMMISSIONED y revocación de credenciales al
 * dar de baja. La misma transición repetida es idempotente (no cambia nada, no registra evento).
 */
export async function transitionLifecycle(
  sql: Sql,
  input: TransitionInput,
): Promise<TransitionResult> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ lifecycle_status: LifecycleState }[]>`
      SELECT lifecycle_status FROM assets.charge_point WHERE id = ${input.chargePointId} FOR UPDATE`;
    const current = rows[0]?.lifecycle_status;
    if (!current) throw new NotFoundError('charge_point', input.chargePointId);
    if (current === input.to) return { from: current, to: current, changed: false };
    if (!canTransitionLifecycle(current, input.to)) {
      throw new ConflictError(
        `Transición de ciclo de vida no permitida: ${current} -> ${input.to}`,
        'LIFECYCLE_TRANSITION',
        { from: current, to: input.to },
      );
    }
    const visible = input.to === 'OPERATIONAL';
    const hide =
      input.to === 'MAINTENANCE' || input.to === 'REJECTED' || input.to === 'DECOMMISSIONED';
    await tx`
      UPDATE assets.charge_point SET
        lifecycle_status = ${input.to},
        visible_in_app = CASE WHEN ${visible} THEN true WHEN ${hide} THEN false ELSE visible_in_app END,
        approved_by = CASE WHEN ${visible} THEN ${input.actor} ELSE approved_by END,
        approved_at = CASE WHEN ${visible} THEN now() ELSE approved_at END,
        updated_at = now()
      WHERE id = ${input.chargePointId}`;
    if (input.to === 'DECOMMISSIONED') {
      await tx`DELETE FROM assets.charge_point_credential WHERE charge_point_id = ${input.chargePointId}`;
    }
    await tx`
      INSERT INTO assets.charge_point_lifecycle_event (charge_point_id, from_state, to_state, actor, reason, evidence)
      VALUES (${input.chargePointId}, ${current}, ${input.to}, ${input.actor}, ${input.reason ?? null},
              ${toJson(tx as unknown as Sql, input.evidence ?? {})})`;
    return { from: current, to: input.to, changed: true };
  });
}

export async function listLifecycleEvents(
  sql: Sql,
  chargePointId: string,
  limit = 100,
): Promise<LifecycleEventRow[]> {
  return sql<LifecycleEventRow[]>`
    SELECT id, charge_point_id, from_state, to_state, actor, reason, evidence, at
    FROM assets.charge_point_lifecycle_event
    WHERE charge_point_id = ${chargePointId}
    ORDER BY at DESC, id DESC LIMIT ${limit}`;
}
