import { readFileSync } from 'node:fs';
import { formatScaled } from '@volt/domain';
import { describe, expect, it } from 'vitest';
import {
  type CostLine,
  type CostPolicy,
  compute,
  type SessionEvent,
  type Tariff,
} from './index.ts';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

interface ExampleSession {
  timezone: string;
  adjustments: { type: 'PERCENT' | 'AMOUNT'; dimension?: 'ENERGY'; value: string }[];
  policy: Omit<CostPolicy, 'timezone'>;
  events: SessionEvent[];
  expected: {
    energy_wh: number;
    lines: { dimension: string; amount: string; tax: string }[];
    subtotal: string;
    tax: string;
    tax_per_group_alternative: string;
    total: string;
    running_cost_at_18_35: string;
  };
}

const tariff = fixture('tar-6-1-tarifa-ejemplo.json') as Tariff;
const session = fixture('tar-6-2-sesion-ejemplo.json') as ExampleSession;
const policy: CostPolicy = { ...session.policy, timezone: session.timezone };
const money = (value: bigint): string => formatScaled(value, 2);
const view = (line: CostLine) => ({
  dimension: line.dimension,
  amount: money(line.amount_minor),
  tax: money(line.tax_minor),
});

describe('fixtures del capítulo TAR §6', () => {
  it('la tarifa de ejemplo tiene la estructura OCPI esperada', () => {
    expect(tariff.elements).toHaveLength(6);
    expect(tariff.elements.map((e) => e.price_components[0]?.type)).toEqual([
      'FLAT',
      'ENERGY',
      'ENERGY',
      'ENERGY',
      'ENERGY',
      'PARKING_TIME',
    ]);
    expect(tariff.max_price?.incl_vat).toBe('71.40');
  });

  it('la sesión de ejemplo suma exactamente 11.700 Wh', () => {
    const start = session.events.find((e) => e.kind === 'TX_START');
    const stop = session.events.find((e) => e.kind === 'TX_STOP');
    const meterStart = start?.kind === 'TX_START' ? start.meter_start_wh : 0;
    const meterStop = stop?.kind === 'TX_STOP' ? stop.meter_stop_wh : 0;
    expect(meterStop - meterStart).toBe(session.expected.energy_wh);
  });

  it('reproduce el ejemplo TAR §6.2 al centavo (FINAL, IVA por línea)', () => {
    const result = compute({
      tariff,
      policy,
      events: session.events,
      mode: 'FINAL',
      adjustments: session.adjustments,
      exposure_limit_minor: 1500n,
    });
    expect(result.lines.map(view)).toEqual(
      session.expected.lines.map((l) => ({ dimension: l.dimension, amount: l.amount, tax: l.tax })),
    );
    expect(result.lines.map((l) => l.element_ref)).toEqual([
      'e0',
      'e3',
      'e2',
      'PERCENT:ENERGY:-15',
      'e5',
    ]);
    expect(result.lines[1]?.quantity).toBe('3.000');
    expect(result.lines[2]?.quantity).toBe('8.700');
    expect(result.lines[3]?.quantity).toBe('4.97');
    expect(result.lines[3]?.unit_price).toBe('-0.15');
    expect(result.lines[4]?.quantity).toBe('23');
    expect(result.lines[4]?.unit_price).toBe('0.1');
    expect(result.lines[4]?.period_start).toBe('2026-10-07T00:30:00.000Z');
    expect(result.lines[4]?.period_end).toBe('2026-10-07T00:52:30.000Z');
    expect(money(result.subtotal_minor)).toBe(session.expected.subtotal);
    expect(money(result.tax_minor)).toBe(session.expected.tax);
    expect(money(result.total_minor)).toBe(session.expected.total);
    expect(money(result.discount_minor)).toBe('0.75');
    expect(result.capped).toBe(false);
    expect(result.flags).toEqual(['INTERPOLATED']);
    expect(result.alerts).toEqual([]);
    expect(result.summary).toMatchObject({
      currency: 'USD',
      energy_wh: 11700,
      charging_time_s: 6300,
      idle_time_s: 1950,
      billable_idle_s: 1350,
      started_at: '2026-10-06T22:35:00.000Z',
      ended_at: '2026-10-07T00:20:00.000Z',
      idle_ended_at: '2026-10-07T00:52:30.000Z',
    });
    expect(result.engine_version).toBe('1.0.0');
    expect(result.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.output_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('con IVA por grupo de tasa la diferencia es de una unidad mínima (1,33)', () => {
    const result = compute({
      tariff,
      policy: { ...policy, tax_rounding: 'PER_TAX_GROUP' },
      events: session.events,
      mode: 'FINAL',
      adjustments: session.adjustments,
    });
    expect(money(result.tax_minor)).toBe(session.expected.tax_per_group_alternative);
    expect(money(result.subtotal_minor)).toBe(session.expected.subtotal);
    expect(money(result.total_minor)).toBe('8.35');
    expect(result.lines.reduce((acc, l) => acc + l.tax_minor, 0n)).toBe(result.tax_minor);
  });

  it('el costo acumulado a las 18:35 es 3,58 (RUNNING a fecha)', () => {
    const result = compute({
      tariff,
      policy,
      events: session.events,
      mode: 'RUNNING',
      now: '2026-10-06T18:35:00-05:00',
      adjustments: session.adjustments,
      exposure_limit_minor: 1500n,
    });
    expect(money(result.total_minor)).toBe(session.expected.running_cost_at_18_35);
    expect(result.lines.map(view)).toEqual([
      { dimension: 'FLAT', amount: '0.50', tax: '0.10' },
      { dimension: 'ENERGY', amount: '1.05', tax: '0.20' },
      { dimension: 'ENERGY', amount: '1.89', tax: '0.36' },
      { dimension: 'ADJUSTMENT', amount: '-0.44', tax: '-0.08' },
    ]);
    expect(result.alerts).toEqual([]);
    expect(result.summary.energy_wh).toBe(7200);
  });
});
