import { currencyExponent, type SessionView } from '@volt/csms';
import { formatScaled, isTerminalSessionState, toAppSessionState } from '@volt/domain';

/** Costo visible para el conductor: en curso (estimado) o final (liquidado), importes al consumidor. */
export interface PublicCost {
  currency: string;
  taxIncluded: boolean;
  total: string;
  subtotal: string;
  tax: string;
  discount: string;
  isFinal: boolean;
  alerts: string[];
  computedAt: string | null;
  tariffCode: string | null;
  tariffVersion: number | null;
}

export function toPublicCost(row: SessionView): PublicCost | null {
  const isFinal = (row.state === 'SETTLED' || row.state === 'PAID') && row.total_minor !== null;
  if (isFinal) {
    const currency = row.currency ?? row.running_cost?.currency ?? 'COP';
    const exponent = currencyExponent(currency);
    const money = (value: bigint | null) => formatScaled(BigInt(value ?? 0), exponent);
    return {
      currency,
      taxIncluded: row.tax_included ?? true,
      total: money(row.total_minor),
      subtotal: money(row.subtotal_minor),
      tax: money(row.tax_minor),
      discount: money(row.discount_minor),
      isFinal: true,
      alerts: [],
      computedAt: row.settled_at?.toISOString() ?? null,
      tariffCode: row.tariff_code,
      tariffVersion: row.tariff_version,
    };
  }
  const running = row.running_cost;
  if (!running) return null;
  const exponent = currencyExponent(running.currency);
  return {
    currency: running.currency,
    taxIncluded: running.tax_included,
    total: formatScaled(BigInt(running.total_minor), exponent),
    subtotal: formatScaled(BigInt(running.subtotal_minor), exponent),
    tax: formatScaled(BigInt(running.tax_minor), exponent),
    discount: formatScaled(BigInt(running.discount_minor), exponent),
    isFinal: false,
    alerts: running.alerts,
    computedAt: running.computed_at,
    tariffCode: row.tariff_code,
    tariffVersion: row.tariff_version,
  };
}

/** Proyección de una sesión para la app Volt (ARQ §1.4) con el costo en curso o final (iteración 4). */
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
    idleEndedAt: row.idle_ended_at?.toISOString() ?? null,
    exposureLimit:
      row.exposure_limit_minor === null
        ? null
        : formatScaled(BigInt(row.exposure_limit_minor), currencyExponent(row.currency ?? 'COP')),
    cost: toPublicCost(row),
    paymentStatus: row.payment_status,
    paidAt: row.paid_at?.toISOString() ?? null,
    receipt: row.receipt_id ? `${base}/sessions/${row.id}/receipt` : null,
    links:
      isTerminalSessionState(row.state) || row.state === 'ENDED' || row.state === 'SETTLED'
        ? { events: `${base}/sessions/${row.id}/events`, cost: `${base}/sessions/${row.id}/cost` }
        : {
            events: `${base}/sessions/${row.id}/events`,
            stop: `${base}/sessions/${row.id}/stop`,
            cost: `${base}/sessions/${row.id}/cost`,
          },
  };
}

export function isSessionFinished(state: SessionView['state']): boolean {
  return (
    isTerminalSessionState(state) || state === 'ENDED' || state === 'EXPIRED' || state === 'SETTLED'
  );
}
