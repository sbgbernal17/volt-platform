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
    energy_price_day_cop_per_kwh: number;
    energy_price_night_cop_per_kwh: number;
    idle_fee_price_per_minute_cop: number;
    idle_fee_price_per_hour_cop: number;
    idle_fee_grace_period_s: number;
    idle_start: string;
    vat_percent: number;
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

const run = (events: SessionEvent[], extra: Record<string, unknown> = {}) =>
  compute({ tariff: fixture.tariff, policy: fixture.policy, events, mode: 'FINAL', ...extra });

describe('tarifa base de Volt (ADR 0012, 0017 y 0018)', () => {
  it('la constante exportada coincide con el fixture', () => {
    expect(VOLT_BASE_TARIFF).toEqual(fixture.tariff);
    expect(VOLT_BASE_POLICY).toEqual(fixture.policy);
  });

  it('cobra 1.350 de 05:00 a 20:00 y 1.200 de 20:00 a 05:00, sin IVA, y la ocupación a 1.500 por minuto tras 15 minutos de gracia', () => {
    const energy = fixture.tariff.elements.filter((e) =>
      e.price_components.some((c) => c.type === 'ENERGY'),
    );
    expect(
      energy.map((e) => [
        e.price_components[0]?.price,
        e.restrictions?.start_time,
        e.restrictions?.end_time,
      ]),
    ).toEqual([
      ['1350', '05:00', '20:00'],
      ['1200', '20:00', '05:00'],
      ['1350', undefined, undefined],
    ]);
    expect(
      fixture.tariff.elements.every((e) => e.price_components.every((c) => c.vat === undefined)),
    ).toBe(true);
    expect(fixture.defaults.vat_percent).toBe(0);
    const idle = fixture.tariff.elements.find((e) =>
      e.price_components.some((c) => c.type === 'PARKING_TIME'),
    );
    expect(idle?.price_components[0]).toMatchObject({
      type: 'PARKING_TIME',
      price: '90000',
      step_size: 60,
    });
    expect(idle?.x_volt).toEqual({ grace_period_s: 900, idle_start: 'EARLIEST' });
    expect(fixture.defaults.idle_fee_price_per_hour_cop / 60).toBe(
      fixture.defaults.idle_fee_price_per_minute_cop,
    );
    expect(fixture.tariff.currency).toBe('COP');
    expect(fixture.policy.currency_exponent).toBe(0);
    expect(fixture.policy.timezone).toBe('America/Bogota');
  });

  it('carga termina (SuspendedEV), gracia hasta el minuto 15 y ocupación cobrada por minuto', () => {
    // Martes 10:00 a 10:40 cargando 20 kWh a 1.350 COP/kWh; el vehículo se llena a las 10:40 y se
    // desconecta a las 11:07:30: 27,5 min de ocupación, 15 de gracia, 12,5 min → 13 minutos cobrados.
    const result = run(
      [
        ev.start(bogota('2026-10-06T10:00:00'), 50_000),
        ev.meter(bogota('2026-10-06T10:20:00'), 60_000, 30_000),
        ev.status(bogota('2026-10-06T10:40:00'), 'SuspendedEV'),
        ev.meter(bogota('2026-10-06T10:40:00'), 70_000, 0),
        ev.stop(bogota('2026-10-06T11:05:00'), 70_000, 'Remote'),
        ev.status(bogota('2026-10-06T11:05:02'), 'Finishing'),
        ev.status(bogota('2026-10-06T11:07:30'), 'Available'),
      ],
      { tax_included: true },
    );
    expect(
      result.lines.map((l) => [
        l.dimension,
        l.element_ref,
        l.quantity,
        l.unit,
        l.unit_price,
        l.amount_minor,
        l.tax_minor,
      ]),
    ).toEqual([
      ['ENERGY', 'e0', '20.000', 'kWh', '1350', 27_000n, 0n],
      ['PARKING_TIME', 'e3', '13', 'min', '1500', 19_500n, 0n],
    ]);
    expect(result.total_minor).toBe(46_500n);
    expect(result.tax_minor).toBe(0n);
    expect(result.summary).toMatchObject({
      energy_wh: 20_000,
      charging_time_s: 2400,
      idle_time_s: 1650,
      billable_idle_s: 750,
    });
    expect(result.flags).toEqual([]);
  });

  it('resuelve las franjas de día y de noche y reparte la energía en los bordes de las 20:00 y las 05:00', () => {
    const day = run([
      ev.start(bogota('2026-10-06T18:00:00'), 0),
      ev.stop(bogota('2026-10-06T19:00:00'), 10_000),
    ]);
    expect(day.total_minor).toBe(13_500n);
    const night = run([
      ev.start(bogota('2026-10-06T23:00:00'), 0),
      ev.stop(bogota('2026-10-07T00:00:00'), 10_000),
    ]);
    expect(night.total_minor).toBe(12_000n);
    expect(night.lines.map((l) => l.element_ref)).toEqual(['e1']);
    const evening = run([
      ev.start(bogota('2026-10-06T19:30:00'), 0),
      ev.stop(bogota('2026-10-06T20:30:00'), 10_000),
    ]);
    expect(evening.lines.map((l) => [l.element_ref, l.quantity_raw])).toEqual([
      ['e0', 5000n],
      ['e1', 5000n],
    ]);
    expect(evening.total_minor).toBe(12_750n);
    const dawn = run([
      ev.start(bogota('2026-10-07T04:30:00'), 0),
      ev.stop(bogota('2026-10-07T05:30:00'), 10_000),
    ]);
    expect(dawn.lines.map((l) => [l.element_ref, l.quantity_raw])).toEqual([
      ['e1', 5000n],
      ['e0', 5000n],
    ]);
    expect(dawn.total_minor).toBe(12_750n);
  });

  it('la ocupación no tiene tope de tiempo: se cobra mientras el vehículo siga conectado', () => {
    const result = run([
      ev.start(bogota('2026-10-06T08:00:00'), 0),
      ev.stop(bogota('2026-10-06T09:00:00'), 10_000, 'Remote'),
      ev.status(bogota('2026-10-06T09:00:02'), 'Finishing'),
      ev.status(bogota('2026-10-06T17:15:00'), 'Available'),
    ]);
    // 8 h 15 min conectado tras la parada: 495 min menos 15 de gracia = 480 min × 1.500.
    expect(result.summary.billable_idle_s).toBe(28_800);
    expect(result.lines.find((l) => l.dimension === 'PARKING_TIME')?.amount_minor).toBe(720_000n);
    expect(result.flags).not.toContain('MAX_IDLE_REACHED');
  });

  it('el límite de exposición avisa al 80 % y agota con la proyección de dos intervalos', () => {
    // 200.000 COP de límite: aviso a 160.000; a 1.350/kWh y 150 kW (2,5 kWh por minuto) son 3.375 COP por minuto.
    const startMs = Date.parse(bogota('2026-10-06T10:00:00'));
    const events: SessionEvent[] = [ev.start(bogota('2026-10-06T10:00:00'), 0)];
    let wh = 0;
    const at = (i: number) => new Date(startMs + i * 60_000).toISOString();
    for (let i = 1; i <= 65; i += 1) {
      wh += 2500;
      events.push(ev.meter(at(i), wh, 150_000));
    }
    const running = (minute: number) =>
      compute({
        tariff: fixture.tariff,
        policy: fixture.policy,
        events,
        mode: 'RUNNING',
        now: at(minute),
        exposure_limit_minor: 200_000n,
      });
    expect(running(45).alerts).toEqual([]);
    expect(running(48).alerts).toEqual(['PREAUTH_WARN']);
    // Minuto 57: 192.375 en firme y 6.750 proyectados (dos minutos a 150 kW) = 199.125 < 200.000.
    expect(running(57).alerts).toEqual(['PREAUTH_WARN']);
    expect(running(58).alerts).toEqual(['PREAUTH_WARN', 'PREAUTH_EXHAUSTED']);
    expect(running(58).total_minor).toBe(195_750n);
  });
});
