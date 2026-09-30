import { describe, expect, it } from 'vitest';
import {
  formatClockDuration,
  isStale,
  minutesAgo,
  ringProgress,
  sessionPhase,
  stoppedByFault,
  supportCode,
} from './session-view.ts';

describe('vista de la sesión', () => {
  it('mapea estados a fases visibles', () => {
    expect(sessionPhase({ state: 'STARTING', detailedState: 'STARTING' })).toBe('starting');
    expect(sessionPhase({ state: 'ACTIVE', detailedState: 'CHARGING' })).toBe('live');
    expect(sessionPhase({ state: 'STOPPING', detailedState: 'STOPPING' })).toBe('stopping');
    expect(sessionPhase({ state: 'SETTLED', detailedState: 'PAID' })).toBe('completed');
    expect(sessionPhase({ state: 'FAILED', detailedState: 'FAILED' })).toBe('failed');
  });

  it('detecta datos desactualizados solo durante la carga', () => {
    const now = Date.parse('2026-09-30T13:00:00Z');
    const old = '2026-09-30T12:57:00Z';
    expect(isStale({ state: 'ACTIVE', lastSampleAt: old, startedAt: old }, now)).toBe(true);
    expect(
      isStale({ state: 'ACTIVE', lastSampleAt: '2026-09-30T12:59:30Z', startedAt: old }, now),
    ).toBe(false);
    expect(isStale({ state: 'ENDED', lastSampleAt: old, startedAt: old }, now)).toBe(false);
    expect(isStale({ state: 'ACTIVE', lastSampleAt: null, startedAt: null }, now)).toBe(false);
    expect(minutesAgo(old, now)).toBe(3);
  });

  it('avance del anillo y duración con formato de reloj', () => {
    expect(ringProgress({ soc: 82 })).toBeCloseTo(0.82);
    expect(ringProgress({ soc: null })).toBeNull();
    expect(ringProgress({ soc: 140 })).toBe(1);
    expect(formatClockDuration(1458)).toBe('00:24:18');
    expect(formatClockDuration(3661)).toBe('01:01:01');
    expect(formatClockDuration(null)).toBe('00:00:00');
  });

  it('reconoce paradas por falla y arma el código de soporte', () => {
    expect(stoppedByFault({ stopReason: 'PowerLoss', endKind: 'NORMAL' })).toBe(true);
    expect(stoppedByFault({ stopReason: 'Remote', endKind: 'ESTIMATED' })).toBe(true);
    expect(stoppedByFault({ stopReason: 'Remote', endKind: 'NORMAL' })).toBe(false);
    expect(supportCode({ sessionNo: 'S-000123', ocppTransactionId: 42 })).toBe('S-000123 · 42');
    expect(supportCode({ sessionNo: 'S-000123', ocppTransactionId: null })).toBe('S-000123');
  });
});
