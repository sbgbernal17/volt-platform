/**
 * Verificación diaria de la cadena de hashes de `audit.audit_log` (SEG §2.8): si una fila fue alterada
 * o la cadena se rompió, abre la alarma CRITICAL `AUDIT_CHAIN_BROKEN`; si está íntegra, la resuelve.
 */
import { raiseAlarm, resolveAlarm, VOLT_TENANT_ID, verifyAuditChain } from '@volt/csms';
import type { Sql } from 'postgres';

export interface AuditJobLogger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export const AUDIT_CHAIN_FINGERPRINT = 'AUDIT_CHAIN_BROKEN|audit_log';

export async function runAuditChainCheck(sql: Sql, logger: AuditJobLogger): Promise<void> {
  const result = await verifyAuditChain(sql);
  if (result.ok) {
    logger.info(
      { checked: result.checked, lastId: result.lastId?.toString() },
      'auditoría íntegra',
    );
    await resolveAlarm(sql, AUDIT_CHAIN_FINGERPRINT, 'La cadena volvió a verificar');
    return;
  }
  logger.error(
    { brokenAtId: result.brokenAtId?.toString(), checked: result.checked },
    'cadena de auditoría rota',
  );
  await raiseAlarm(sql, {
    tenantId: VOLT_TENANT_ID,
    kind: 'AUDIT_CHAIN_BROKEN',
    severity: 'CRITICAL',
    fingerprint: AUDIT_CHAIN_FINGERPRINT,
    details: {
      brokenAtId: result.brokenAtId?.toString() ?? null,
      checked: result.checked,
      lastGoodId: result.lastId?.toString() ?? null,
    },
  });
}
