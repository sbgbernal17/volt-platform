import { describe, expect, it } from 'vitest';
import { summarizeCost } from './session-cost.ts';
import type { SessionCostView } from './types.ts';

const base: SessionCostView = {
  session_id: 's1',
  state: 'CHARGING',
  currency: 'COP',
  segment: null,
  snapshot: null,
  running: null,
  final: null,
  calcs: [],
};

describe('summarizeCost', () => {
  it('sin cálculo: no supone líneas ni banderas (la causa del detalle en blanco)', () => {
    const summary = summarizeCost(base);
    expect(summary.kind).toBe('none');
    expect(summary.lines).toEqual([]);
    expect(summary.flags).toEqual([]);
    expect(summary.totalMinor).toBeNull();
    expect(summary.currency).toBe('COP');
  });

  it('sesión abierta: usa el costo en curso (snake_case) y marca el tope por bandera', () => {
    const summary = summarizeCost({
      ...base,
      running: {
        currency: 'COP',
        tax_included: false,
        total_minor: '12500',
        subtotal_minor: '12500',
        tax_minor: '0',
        discount_minor: '0',
        energy_wh: 9260,
        alerts: [],
        flags: ['EXPOSURE_CAP'],
        computed_at: '2026-09-30T10:00:00.000Z',
        engine_version: '1',
      },
    });
    expect(summary.kind).toBe('running');
    expect(summary.totalMinor).toBe('12500');
    expect(summary.capped).toBe(true);
    expect(summary.lines).toEqual([]);
    expect(summary.computedAt).toBe('2026-09-30T10:00:00.000Z');
  });

  it('sesión liquidada: prefiere el cálculo final con sus líneas', () => {
    const summary = summarizeCost({
      ...base,
      state: 'SETTLED',
      running: {
        currency: 'COP',
        tax_included: false,
        total_minor: '1',
        subtotal_minor: '1',
        tax_minor: '0',
        discount_minor: '0',
        energy_wh: 1,
        alerts: [],
        flags: [],
        computed_at: '2026-09-30T09:00:00.000Z',
        engine_version: '1',
      },
      final: {
        id: 'c1',
        calcVersion: 1,
        kind: 'FINAL',
        engineVersion: '1',
        currency: 'COP',
        subtotal: '63720',
        discount: '0',
        tax: '0',
        total: '63720',
        subtotalMinor: '63720',
        discountMinor: '0',
        taxMinor: '0',
        totalMinor: '63720',
        capped: false,
        flags: [],
        alerts: [],
        reason: null,
        computedBy: 'system',
        computedAt: '2026-09-30T10:00:00.000Z',
        lines: [
          {
            seq: 1,
            dimension: 'ENERGY',
            elementRef: null,
            periodStart: null,
            periodEnd: null,
            quantity: '47.2',
            unit: 'kWh',
            unitPrice: '1350',
            amount: '63720',
            amountMinor: '63720',
            taxRate: '0',
            tax: '0',
            taxMinor: '0',
            total: '63720',
          },
        ],
      },
    });
    expect(summary.kind).toBe('final');
    expect(summary.totalMinor).toBe('63720');
    expect(summary.lines.map((l) => l.dimension)).toEqual(['ENERGY']);
  });
});
