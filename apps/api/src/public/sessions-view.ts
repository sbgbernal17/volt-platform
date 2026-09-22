import type { SessionView } from '@volt/csms';
import { isTerminalSessionState, toAppSessionState } from '@volt/domain';

/** Proyección de una sesión para la app Volt (ARQ §1.4). El costo llega con la iteración 4. */
export function toPublicSession(row: SessionView, base = '/v1') {
  const now = Date.now();
  const startedAt = row.started_at?.getTime();
  const endedAt = row.ended_at?.getTime() ?? now;
  const sample = row.last_sample;
  return {
    id: row.id,
    sessionNo: row.session_no,
    state: toAppSessionState(row.state),
    detailedState: row.state,
    evseId: row.evse_code,
    chargeBoxId: row.charge_box_id,
    connectorId: row.ocpp_connector_id,
    ocppTransactionId: row.ocpp_transaction_no,
    isTest: row.is_test,
    requestedAt: row.requested_at.toISOString(),
    startDeadlineAt: row.start_deadline_at?.toISOString() ?? null,
    startedAt: row.started_at?.toISOString() ?? null,
    endedAt: row.ended_at?.toISOString() ?? null,
    elapsedSeconds: startedAt ? Math.max(0, Math.round((endedAt - startedAt) / 1000)) : 0,
    energyKwh: row.energy_wh === null ? null : Number(row.energy_wh) / 1000,
    powerKw: sample?.powerW === null || sample?.powerW === undefined ? null : sample.powerW / 1000,
    voltageV: sample?.voltageV ?? null,
    currentA: sample?.currentA ?? null,
    soc: sample?.soc ?? null,
    lastSampleAt: sample?.at ?? null,
    idleSince: row.idle_since?.toISOString() ?? null,
    stopReason: row.stop_reason,
    endKind: row.end_kind,
    failureCode: row.failure_code,
    cost: null,
    links:
      isTerminalSessionState(row.state) || row.state === 'ENDED'
        ? { events: `${base}/sessions/${row.id}/events` }
        : { events: `${base}/sessions/${row.id}/events`, stop: `${base}/sessions/${row.id}/stop` },
  };
}

export function isSessionFinished(state: SessionView['state']): boolean {
  return (
    isTerminalSessionState(state) || state === 'ENDED' || state === 'EXPIRED' || state === 'SETTLED'
  );
}
