import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type CostPolicy,
  compute,
  type SessionEvent,
  type Tariff,
  VOLT_BASE_POLICY,
  VOLT_BASE_TARIFF,
} from './index.ts';

interface VoltBaseFixture {
  tariff: Tariff;
  policy: CostPolicy;
  defaults: {
    idle_fee_price_per_minute_cop: number;
    idle_fee_price_per_hour_cop: number;
    idle_fee_grace_period_s: number;
    idle_fee_max_idle_s: number;
    idle_start: string;
  };
}

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/volt-colombia-tarifa-base.json', import.meta.url), 'utf8'),
) as VoltBaseFixture;

const bogota = (local: string): string => `${local}-05:00`;
const ev = {
  start: (ts: string, wh: number): SessionEvent => ({
    kind: 'TX_START',
    ts_cp: ts,
    ts_srv: ts,
    meter_start_wh: wh,
  }),
  meter: (ts: string, wh: number, powerW: number): SessionEvent => ({
    kind: 'METER',
    ts_cp: ts,
    ts_srv: ts,
    register_wh: wh,
    power_w: powerW,
  }),
  status: (ts: string, status: string): SessionEvent => ({
    kind: 'STATUS',
    ts_cp: ts,
    ts_srv: ts,
    status,
  }),
  stop: (ts: string, wh: number, reason = 'Remote'): SessionEvent => ({
    kind: 'TX_STOP',
    ts_cp: ts,
    ts_srv: ts,
    meter_stop_wh: wh,
    reason,
  }),
};

describe('tarifa base de Volt (ADR 0012, ADR 0017)', () => {
  it('la constante exportada coincide con el fixture', () => {
    expect(VOLT_BASE_TARIFF).toEqual(fixture.tariff);
    expect(VOLT_BASE_POLICY).toEqual(fixture.policy);
  });

  it('cobra la ocupación a 1.500 COP por minuto (90.000 por hora) tras 15 minutos de gracia', () => {
    const idle = fixture.tariff.elements.find((e) =>
      e.price_components.some((c) => c.type === 'PARKING_TIME'),
    );
    expect(idle?.price_components[0]).toMatchObject({
      type: 'PARKING_TIME',
      price: '90000',
      step_size: 60,
    });
    expect(idle?.x_volt).toMatchObject({ grace_period_s: 900, idle_start: 'EARLIEST' });
    expect(fixture.defaults.idle_fee_grace_period_s).toBe(900);
    expect(fixture.defaults.idle_fee_price_per_hour_cop / 60).toBe(
      fixture.defaults.idle_fee_price_per_minute_cop,
    );
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

  it('carga termina (SuspendedEV), gracia hasta el minuto 15 y ocupación cobrada por minuto', () => {
    // Martes 10:00 a 10:40 cargando 20 kWh a 1.900 COP/kWh; el vehículo se llena a las 10:40 y se
    // desconecta a las 11:07:30: 27,5 min de ocupación, 15 de gracia, 12,5 min → 13 minutos cobrados.
    const events = [
      ev.start(bogota('2026-10-06T10:00:00'), 50_000),
      ev.meter(bogota('2026-10-06T10:20:00'), 60_000, 30_000),
      ev.status(bogota('2026-10-06T10:40:00'), 'SuspendedEV'),
      ev.meter(bogota('2026-10-06T10:40:00'), 70_000, 0),
      ev.stop(bogota('2026-10-06T11:05:00'), 70_000, 'Remote'),
      ev.status(bogota('2026-10-06T11:05:02'), 'Finishing'),
      ev.status(bogota('2026-10-06T11:07:30'), 'Available'),
    ];
    const result = compute({
      tariff: fixture.tariff,
      policy: fixture.policy,
      events,
      mode: 'FINAL',
      tax_included: true,
    });
    expect(
      result.lines.map((l) => [l.dimension, l.element_ref, l.quantity, l.unit, l.unit_price]),
    ).toEqual([
      ['ENERGY', 'e2', '20.000', 'kWh', '1900'],
      ['PARKING_TIME', 'e3', '13', 'min', '1500'],
    ]);
    // Precios con IVA incluido (ADR 0017): el bruto es lo que ve el conductor; el impuesto se desglosa.
    const energy = result.lines[0];
    const parking = result.lines[1];
    expect((energy?.amount_minor ?? 0n) + (energy?.tax_minor ?? 0n)).toBe(38_000n);
    expect(energy?.tax_minor).toBe(6_067n);
    expect((parking?.amount_minor ?? 0n) + (parking?.tax_minor ?? 0n)).toBe(19_500n);
    expect(result.total_minor).toBe(57_500n);
    expect(result.summary).toMatchObject({
      energy_wh: 20_000,
      charging_time_s: 2400,
      idle_time_s: 1650,
      billable_idle_s: 750,
    });
    expect(result.flags).toEqual([]);
  });

  it('en la franja de la tarde cobra 2.200 y de madrugada 1.600 con IVA incluido', () => {
    const evening = compute({
      tariff: fixture.tariff,
      policy: fixture.policy,
      events: [
        ev.start(bogota('2026-10-06T18:00:00'), 0),
        ev.stop(bogota('2026-10-06T19:00:00'), 10_000),
      ],
      mode: 'FINAL',
      tax_included: true,
    });
    expect(evening.total_minor).toBe(22_000n);
    const night = compute({
      tariff: fixture.tariff,
      policy: fixture.policy,
      events: [
        ev.start(bogota('2026-10-06T23:00:00'), 0),
        ev.stop(bogota('2026-10-07T00:00:00'), 10_000),
      ],
      mode: 'FINAL',
      tax_included: true,
    });
    expect(night.total_minor).toBe(16_000n);
    expect(night.lines.map((l) => l.element_ref)).toEqual(['e0']);
  });

  it('el límite de exposición avisa al 80 % y agota con la proyección de dos intervalos', () => {
    // 200.000 COP de límite: aviso a 160.000; a 1.900/kWh con IVA incluido son ~84 kWh.
    const startMs = Date.parse(bogota('2026-10-06T10:00:00'));
    const events: SessionEvent[] = [ev.start(bogota('2026-10-06T10:00:00'), 0)];
    let wh = 0;
    const at = (i: number) => new Date(startMs + i * 60_000).toISOString();
    for (let i = 1; i <= 45; i += 1) {
      wh += 2500; // 150 kW
      events.push(ev.meter(at(i), wh, 150_000));
    }
    const running = (minute: number) =>
      compute({
        tariff: fixture.tariff,
        policy: fixture.policy,
        events,
        mode: 'RUNNING',
        now: at(minute),
        tax_included: true,
        exposure_limit_minor: 200_000n,
      });
    expect(running(30).alerts).toEqual([]);
    expect(running(34).alerts).toEqual(['PREAUTH_WARN']);
    // Minuto 40: 190.000 en firme y 9.500 proyectados (dos intervalos a 150 kW) = 199.500 < 200.000.
    expect(running(40).alerts).toEqual(['PREAUTH_WARN']);
    expect(running(40).total_minor).toBe(190_000n);
    expect(running(41).alerts).toEqual(['PREAUTH_WARN', 'PREAUTH_EXHAUSTED']);
  });
});
