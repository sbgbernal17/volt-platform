import { generateAuthorizationKey, hashSecret } from '@volt/security';
import type { Sql } from 'postgres';
import { ConflictError } from './errors.ts';
import { getChargePoint } from './inventory.ts';
import { transitionLifecycle } from './lifecycle.ts';

export interface IssueCredentialInput {
  chargePointId: string;
  issuedBy: string;
  /** Horas de validez de la clave de bootstrap sin conexión (OPS §1.3, paso 2). */
  bootstrapTtlHours?: number;
}

export interface IssuedCredential {
  chargeBoxId: string;
  /** Se muestra una sola vez; solo se guarda el hash. */
  authorizationKey: string;
  expiresAt: Date;
  lifecycle: string;
}

export interface CredentialRow {
  charge_point_id: string;
  issued_at: Date;
  issued_by: string;
  expires_at: Date;
  bootstrap: boolean;
  first_used_at: Date | null;
  last_used_at: Date | null;
  failed_attempts: number;
  locked_until: Date | null;
  rotation_started_at: Date | null;
}

/**
 * Emite (o reemplaza) la AuthorizationKey del cargador. INVENTORIED y REJECTED pasan a
 * PROVISIONED; en los demás estados la clave se reemplaza y el técnico debe cargarla a mano.
 */
export async function issueCredential(
  sql: Sql,
  input: IssueCredentialInput,
): Promise<IssuedCredential> {
  const chargePoint = await getChargePoint(sql, input.chargePointId);
  if (chargePoint.lifecycle_status === 'DECOMMISSIONED') {
    throw new ConflictError(
      'Un cargador dado de baja no puede recibir credenciales',
      'DECOMMISSIONED',
    );
  }
  const authorizationKey = generateAuthorizationKey();
  const keyHash = await hashSecret(authorizationKey);
  const ttlHours = input.bootstrapTtlHours ?? 24;
  const rows = await sql<{ expires_at: Date }[]>`
    INSERT INTO assets.charge_point_credential
      (charge_point_id, key_hash, issued_at, issued_by, expires_at, bootstrap)
    VALUES (${input.chargePointId}, ${keyHash}, now(), ${input.issuedBy},
            now() + make_interval(hours => ${ttlHours}), true)
    ON CONFLICT (charge_point_id) DO UPDATE SET
      key_hash = EXCLUDED.key_hash, next_key_hash = NULL, rotation_started_at = NULL,
      issued_at = now(), issued_by = EXCLUDED.issued_by, expires_at = EXCLUDED.expires_at,
      bootstrap = true, first_used_at = NULL, failed_attempts = 0, locked_until = NULL
    RETURNING expires_at`;
  let lifecycle: string = chargePoint.lifecycle_status;
  if (
    chargePoint.lifecycle_status === 'INVENTORIED' ||
    chargePoint.lifecycle_status === 'REJECTED'
  ) {
    const result = await transitionLifecycle(sql, {
      chargePointId: input.chargePointId,
      to: 'PROVISIONED',
      actor: input.issuedBy,
      reason: 'credencial emitida',
    });
    lifecycle = result.to;
  }
  return {
    chargeBoxId: chargePoint.charge_box_id,
    authorizationKey,
    expiresAt: rows[0]?.expires_at ?? new Date(),
    lifecycle,
  };
}

export async function getCredentialSummary(
  sql: Sql,
  chargePointId: string,
): Promise<CredentialRow | undefined> {
  const rows = await sql<CredentialRow[]>`
    SELECT charge_point_id, issued_at, issued_by, expires_at, bootstrap, first_used_at, last_used_at,
           failed_attempts, locked_until, rotation_started_at
    FROM assets.charge_point_credential WHERE charge_point_id = ${chargePointId}`;
  return rows[0];
}
