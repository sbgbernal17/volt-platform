import { describe, expect, it } from 'vitest';
import type { Session } from '../api/types.ts';
import {
  groupByMonth,
  hasPendingPayment,
  monthKey,
  monthLabel,
  monthSummary,
  toMinor,
} from './activity.ts';

const session = (overrides: Partial<Session>): Session =>
  ({
    id: 'x',
    sessionNo: 'S-1',
    state: 'PAID',
    detailedState: 'PAID',
    evseId: 'VOLT-X-1',
    chargeBoxId: 'VOLT-X',
    connectorId: 1,
    ocppTransactionId: 1,
    isTest: false,
    requestedAt: '2026-09-30T18:00:00Z',
    startDeadlineAt: null,
    startedAt: '2026-09-30T18:00:00Z',
    endedAt: null,
    elapsedSeconds: 1440,
    energyKwh: 47.2,
    powerKw: null,
    voltageV: null,
    currentA: null,
    soc: null,
    lastSampleAt: null,
    idleSince: null,
    stopReason: 'Remote',
    endKind: 'NORMAL',
    failureCode: null,
    idleEndedAt: null,
    exposureLimit: null,
    cost: {
      currency: 'COP',
      taxIncluded: false,
      total: '38500',
      subtotal: '38500',
      tax: '0',
      discount: '0',
      isFinal: true,
      alerts: [],
      computedAt: null,
      tariffCode: null,
      tariffVersion: null,
    },
    paymentStatus: 'CAPTURED',
    paidAt: null,
    receipt: null,
    links: { events: '', cost: '' },
    ...overrides,
  }) as Session;

describe('actividad', () => {
  it('agrupa por mes en hora de Colombia, del más reciente al más antiguo', () => {
    const groups = groupByMonth([
      session({ id: 'a', startedAt: '2026-08-27T15:00:00Z' }),
      session({ id: 'b', startedAt: '2026-09-30T18:00:00Z' }),
      // 1 de octubre 02:00 UTC = 30 de septiembre 21:00 en Bogotá
      session({ id: 'c', startedAt: '2026-10-01T02:00:00Z' }),
    ]);
    expect(groups.map((g) => [g.key, g.sessions.map((s) => s.id)])).toEqual([
      ['2026-09', ['c', 'b']],
      ['2026-08', ['a']],
    ]);
    expect(monthLabel('2026-09')).toBe('Septiembre 2026');
    expect(monthLabel('2026-09', 'en')).toBe('September 2026');
    expect(monthKey(new Date('2026-10-01T02:00:00Z'))).toBe('2026-09');
  });

  it('resume el mes en curso solo con sesiones terminadas', () => {
    const now = new Date('2026-09-30T20:00:00Z');
    const summary = monthSummary(
      [
        session({ id: 'a', energyKwh: 47.2 }),
        session({
          id: 'b',
          energyKwh: 36.8,
          cost: { ...(session({}).cost ?? null), total: '30000' } as Session['cost'],
        }),
        session({ id: 'c', state: 'ACTIVE', energyKwh: 10 }),
        session({ id: 'd', startedAt: '2026-08-01T12:00:00Z', energyKwh: 51 }),
      ],
      'es',
      now,
    );
    expect(summary).toMatchObject({
      key: '2026-09',
      charges: 2,
      energyKwh: 84,
      totalMinor: 68500n,
      currency: 'COP',
    });
    expect(toMinor('12.5')).toBe(1250n);
    expect(toMinor('38500')).toBe(38500n);
  });

  it('marca pagos pendientes', () => {
    expect(hasPendingPayment({ paymentStatus: 'FAILED', state: 'SETTLED' })).toBe(true);
    expect(hasPendingPayment({ paymentStatus: 'CAPTURED', state: 'PAID' })).toBe(false);
  });
});
