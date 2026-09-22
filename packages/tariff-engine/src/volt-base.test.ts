import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CostPolicy, Tariff } from './index.ts';

interface VoltBaseFixture {
  tariff: Tariff;
  policy: CostPolicy;
  defaults: {
    idle_fee_price_per_minute_cop: number;
    idle_fee_grace_period_s: number;
    idle_fee_max_idle_s: number;
    idle_start: string;
  };
}

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/volt-colombia-tarifa-base.json', import.meta.url), 'utf8'),
) as VoltBaseFixture;

describe('tarifa base de Volt (ADR 0012)', () => {
  it('cobra la ocupación a 1.500 COP por minuto tras 15 minutos de gracia', () => {
    const idle = fixture.tariff.elements.find((e) =>
      e.price_components.some((c) => c.type === 'PARKING_TIME'),
    );
    expect(idle?.price_components[0]).toMatchObject({
      type: 'PARKING_TIME',
      price: '1500',
      step_size: 60,
    });
    expect(idle?.x_volt).toMatchObject({ grace_period_s: 900, idle_start: 'EARLIEST' });
    expect(fixture.defaults.idle_fee_grace_period_s).toBe(900);
    expect(fixture.defaults.idle_fee_price_per_minute_cop).toBe(1500);
  });

  it('tiene energía por franjas horarias con un elemento de respaldo y pesos sin decimales', () => {
    const energy = fixture.tariff.elements.filter((e) =>
      e.price_components.some((c) => c.type === 'ENERGY'),
    );
    expect(energy.length).toBeGreaterThanOrEqual(2);
    expect(energy.some((e) => !e.restrictions)).toBe(true);
    expect(fixture.tariff.currency).toBe('COP');
    expect(fixture.policy.currency_exponent).toBe(0);
    expect(fixture.policy.timezone).toBe('America/Bogota');
  });
});
