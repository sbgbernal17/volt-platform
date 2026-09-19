import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compute, type Tariff } from './index.ts';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

describe('fixtures del capítulo TAR §6', () => {
  it('la tarifa de ejemplo tiene la estructura OCPI esperada', () => {
    const tariff = fixture('tar-6-1-tarifa-ejemplo.json') as Tariff;
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
    const session = fixture('tar-6-2-sesion-ejemplo.json') as {
      events: { kind: string; meter_start_wh?: number; meter_stop_wh?: number }[];
      expected: { energy_wh: number; total: string };
    };
    const start = session.events.find((e) => e.kind === 'TX_START')?.meter_start_wh ?? 0;
    const stop = session.events.find((e) => e.kind === 'TX_STOP')?.meter_stop_wh ?? 0;
    expect(stop - start).toBe(session.expected.energy_wh);
    expect(session.expected.total).toBe('8.36');
  });

  it('el motor aún no está implementado (iteración 4)', () => {
    expect(() =>
      compute({
        tariff: fixture('tar-6-1-tarifa-ejemplo.json') as Tariff,
        policy: {
          rounding: 'HALF_UP',
          tax_rounding: 'PER_LINE',
          currency_exponent: 2,
          timezone: 'America/Bogota',
        },
        events: [],
        mode: 'FINAL',
      }),
    ).toThrow(/pendiente/);
  });
});
