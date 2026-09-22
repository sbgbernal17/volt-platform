/**
 * Casos T1 a T12 de TAR §6.3 (T11 fail-closed y T13 normalización de kWh se prueban en @volt/csms,
 * donde viven la resolución de tarifas y la conversión de MeterValues).
 */
import { readFileSync } from 'node:fs';
import { formatScaled } from '@volt/domain';
import { describe, expect, it } from 'vitest';
import {
  type ComputeInput,
  type CostPolicy,
  compute,
  type SessionEvent,
  type Tariff,
  TariffEngineError,
} from './index.ts';

const tariff = JSON.parse(
  readFileSync(new URL('../fixtures/tar-6-1-tarifa-ejemplo.json', import.meta.url), 'utf8'),
) as Tariff;

const policy: CostPolicy = {
  rounding: 'HALF_UP',
  tax_rounding: 'PER_LINE',
  currency_exponent: 2,
  timezone: 'America/Bogota',
};

/** Hora local de Bogotá (sin horario de verano) como ISO con desfase. */
const bogota = (local: string): string => `${local}-05:00`;
const money = (value: bigint): string => formatScaled(value, 2);

const txStart = (ts: string, wh: number): SessionEvent => ({
  kind: 'TX_START',
  ts_cp: ts,
  ts_srv: ts,
  meter_start_wh: wh,
});
const meter = (ts: string, wh: number, powerW?: number): SessionEvent => ({
  kind: 'METER',
  ts_cp: ts,
  ts_srv: ts,
  register_wh: wh,
  ...(powerW !== undefined ? { power_w: powerW } : {}),
});
const status = (ts: string, value: string): SessionEvent => ({
  kind: 'STATUS',
  ts_cp: ts,
  ts_srv: ts,
  status: value,
});
const txStop = (ts: string, wh: number, reason = 'Remote'): SessionEvent => ({
  kind: 'TX_STOP',
  ts_cp: ts,
  ts_srv: ts,
  meter_stop_wh: wh,
  reason,
});

const run = (events: SessionEvent[], overrides: Partial<ComputeInput> = {}) =>
  compute({ tariff, policy, events, mode: 'FINAL', ...overrides });

describe('T1 borde de franja exacto', () => {
  it('una lectura a las 18:00:00 pertenece a la franja que empieza a esa hora y no crea subtramos vacíos', () => {
    // Martes 2026-10-06.
    const result = run([
      txStart(bogota('2026-10-06T17:50:00'), 100000),
      meter(bogota('2026-10-06T18:00:00'), 101000),
      txStop(bogota('2026-10-06T18:10:00'), 102000),
      status(bogota('2026-10-06T18:10:01'), 'Available'),
    ]);
    const energy = result.lines.filter((l) => l.dimension === 'ENERGY');
    expect(energy.map((l) => [l.element_ref, l.quantity, money(l.amount_minor)])).toEqual([
      ['e3', '1.000', '0.35'],
      ['e2', '1.000', '0.45'],
    ]);
    expect(result.flags).not.toContain('INTERPOLATED');
  });
});

describe('T2 franja que envuelve la medianoche y cambio de día', () => {
  it('domingo 23:30 a lunes 00:30 va íntegra al valle 22-07', () => {
    // 2026-10-04 es domingo.
    const result = run([
      txStart(bogota('2026-10-04T23:30:00'), 0),
      meter(bogota('2026-10-05T00:00:00'), 1500),
      txStop(bogota('2026-10-05T00:30:00'), 3000),
      status(bogota('2026-10-05T00:30:05'), 'Available'),
    ]);
    const energy = result.lines.filter((l) => l.dimension === 'ENERGY');
    expect(energy).toHaveLength(1);
    expect(energy[0]).toMatchObject({ element_ref: 'e1', quantity: '3.000', unit_price: '0.20' });
    expect(money(energy[0]?.amount_minor ?? 0n)).toBe('0.60');
  });

  it('el día de la semana se evalúa al inicio de cada subtramo (viernes 21:30 a sábado 22:30)', () => {
    // 2026-10-09 es viernes: 21:30-22:00 punta L-V (0,45); 22:00-07:00 valle; sábado 07:00-22:00 resto (0,30); 22:00-22:30 valle.
    const result = run([
      txStart(bogota('2026-10-09T21:30:00'), 0),
      txStop(bogota('2026-10-10T22:30:00'), 25000),
    ]);
    const energy = result.lines.filter((l) => l.dimension === 'ENERGY');
    expect(energy.map((l) => [l.element_ref, l.quantity_raw])).toEqual([
      ['e2', 500n],
      ['e1', 9500n],
      ['e4', 15000n],
    ]);
    expect(energy.reduce((acc, l) => acc + l.quantity_raw, 0n)).toBe(25000n);
    expect(result.flags).toContain('INTERPOLATED');
  });
});

describe('T3 interpolación sin lectura en el borde', () => {
  it('interpola 123000 Wh a las 18:00 y conserva la suma exacta', () => {
    const result = run([
      txStart(bogota('2026-10-06T17:35:00'), 120000),
      meter(bogota('2026-10-06T17:55:00'), 122400),
      meter(bogota('2026-10-06T18:05:00'), 123600),
      txStop(bogota('2026-10-06T18:05:00'), 123600),
    ]);
    const energy = result.lines.filter((l) => l.dimension === 'ENERGY');
    expect(energy.map((l) => [l.element_ref, l.quantity_raw])).toEqual([
      ['e3', 3000n],
      ['e2', 600n],
    ]);
    expect(result.flags).toContain('INTERPOLATED');
  });
});

describe('T4 ocupación con gracia', () => {
  const idleOf = (idle: string, seconds: number) => {
    const stopMs = Date.parse(bogota('2026-10-06T19:20:00'));
    const events = [
      txStart(bogota('2026-10-06T18:20:00'), 0),
      txStop(bogota('2026-10-06T19:20:00'), 6000),
      status(new Date(stopMs + seconds * 1000).toISOString(), 'Available'),
    ];
    const result = run(events);
    const parking = result.lines.find((l) => l.dimension === 'PARKING_TIME');
    return { label: idle, parking, result };
  };

  it.each([
    ['9:59', 599, undefined, 0],
    ['10:00', 600, undefined, 0],
    ['10:01', 601, '0.10', 1],
    ['32:30', 1950, '2.30', 1350],
  ])('idle %s', (label, seconds, amount, billable) => {
    const { parking, result } = idleOf(label, seconds);
    if (amount === undefined) {
      expect(parking).toBeUndefined();
    } else {
      expect(money(parking?.amount_minor ?? 0n)).toBe(amount);
    }
    expect(result.summary.idle_time_s).toBe(seconds);
    expect(result.summary.billable_idle_s).toBe(billable);
  });

  it('no cobra ocupación fuera de la franja L-V 07-22 del elemento PARKING_TIME', () => {
    // Sábado 2026-10-10.
    const result = run([
      txStart(bogota('2026-10-10T10:00:00'), 0),
      txStop(bogota('2026-10-10T11:00:00'), 6000),
      status(bogota('2026-10-10T12:00:00'), 'Available'),
    ]);
    expect(result.lines.find((l) => l.dimension === 'PARKING_TIME')).toBeUndefined();
    expect(result.summary.billable_idle_s).toBe(3000);
  });

  it('EVDisconnected no genera ocupación; PowerLoss la exime y marca revisión', () => {
    const base = [txStart(bogota('2026-10-06T18:20:00'), 0)];
    const disconnected = run([
      ...base,
      txStop(bogota('2026-10-06T19:20:00'), 6000, 'EVDisconnected'),
      status(bogota('2026-10-06T19:52:30'), 'Available'),
    ]);
    expect(disconnected.summary.idle_time_s).toBe(0);
    const powerLoss = run([
      ...base,
      txStop(bogota('2026-10-06T19:20:00'), 6000, 'PowerLoss'),
      status(bogota('2026-10-06T19:52:30'), 'Available'),
    ]);
    expect(powerLoss.summary.idle_time_s).toBe(0);
    expect(powerLoss.flags).toEqual(expect.arrayContaining(['IDLE_WAIVED', 'REVIEW']));
  });

  it('respeta max_idle_s y en FINAL sin fin de ocupación cierra en el último estado conocido', () => {
    const capped = run(
      [
        txStart(bogota('2026-10-06T08:00:00'), 0),
        txStop(bogota('2026-10-06T09:00:00'), 6000),
        status(bogota('2026-10-06T09:00:03'), 'Finishing'),
        { kind: 'IDLE_END', ts: bogota('2026-10-06T16:00:00') },
      ],
      { mode: 'FINAL' },
    );
    expect(capped.flags).toContain('MAX_IDLE_REACHED');
    expect(capped.summary.billable_idle_s).toBe(14400);
    const open = run([
      txStart(bogota('2026-10-06T08:00:00'), 0),
      txStop(bogota('2026-10-06T09:00:00'), 6000),
      status(bogota('2026-10-06T09:00:03'), 'Finishing'),
    ]);
    expect(open.flags).toContain('IDLE_OPEN');
    expect(open.summary.idle_time_s).toBe(3);
  });
});

describe('T5 límite de exposición', () => {
  // Sábado: energía al precio de respaldo 0,30; muestras de 1200 Wh cada 10 minutos (7,2 kW).
  const events = (samples: number): SessionEvent[] => {
    const startMs = Date.parse(bogota('2026-10-10T10:00:00'));
    const list: SessionEvent[] = [txStart(bogota('2026-10-10T10:00:00'), 0)];
    for (let i = 1; i <= samples; i += 1) {
      list.push(meter(new Date(startMs + i * 600_000).toISOString(), i * 1200));
    }
    return list;
  };
  const alertsAt = (samples: number) =>
    compute({
      tariff,
      policy,
      events: events(samples),
      mode: 'RUNNING',
      exposure_limit_minor: 500n,
    }).alerts;

  it('avisa al 80 % del límite y declara agotado cuando la proyección alcanza el límite', () => {
    expect(alertsAt(7)).toEqual([]);
    expect(alertsAt(8)).toEqual(['PREAUTH_WARN']);
    expect(alertsAt(9)).toEqual(['PREAUTH_WARN', 'PREAUTH_EXHAUSTED']);
  });

  it('en FINAL solo compara el total con el límite', () => {
    const result = compute({
      tariff,
      policy,
      events: [...events(9), txStop(bogota('2026-10-10T11:30:00'), 10800)],
      mode: 'FINAL',
      exposure_limit_minor: 500n,
    });
    expect(money(result.total_minor)).toBe('4.46');
    expect(result.alerts).toEqual(['PREAUTH_WARN']);
  });
});

describe('T6 redondeo', () => {
  it('3,915 y 4,965 según HALF_UP y HALF_EVEN, y el total es la suma de líneas redondeadas', () => {
    // Martes 18:00-19:00 punta 0,45 con 8700 Wh -> 3,915; sábado respaldo 0,30 con 16550 Wh -> 4,965.
    const peak = [
      txStart(bogota('2026-10-06T18:00:00'), 0),
      txStop(bogota('2026-10-06T19:00:00'), 8700),
    ];
    const weekend = [
      txStart(bogota('2026-10-10T10:00:00'), 0),
      txStop(bogota('2026-10-10T11:00:00'), 16550),
    ];
    const energyAmount = (events: SessionEvent[], rounding: CostPolicy['rounding']) => {
      const result = run(events, { policy: { ...policy, rounding } });
      expect(result.subtotal_minor + result.tax_minor).toBe(result.total_minor);
      expect(result.lines.reduce((acc, l) => acc + l.amount_minor, 0n)).toBe(result.subtotal_minor);
      return money(result.lines.find((l) => l.dimension === 'ENERGY')?.amount_minor ?? 0n);
    };
    expect(energyAmount(peak, 'HALF_UP')).toBe('3.92');
    expect(energyAmount(peak, 'HALF_EVEN')).toBe('3.92');
    expect(energyAmount(weekend, 'HALF_UP')).toBe('4.97');
    expect(energyAmount(weekend, 'HALF_EVEN')).toBe('4.96');
  });
});

describe('T7 medidor que retrocede y determinismo', () => {
  it('un delta negativo vale 0, se marca METER_ANOMALY y el total se reconcilia con meterStop', () => {
    const result = run([
      txStart(bogota('2026-10-10T10:00:00'), 125000),
      meter(bogota('2026-10-10T10:10:00'), 124000),
      meter(bogota('2026-10-10T10:20:00'), 126000),
      txStop(bogota('2026-10-10T10:30:00'), 126000),
    ]);
    expect(result.flags).toEqual(expect.arrayContaining(['METER_ANOMALY', 'RECONCILED_TO_STOP']));
    expect(result.summary.energy_wh).toBe(1000);
  });

  it('las banderas externas (OFFLINE) se propagan y el recálculo es idéntico', () => {
    const events = [
      txStart(bogota('2026-10-10T10:00:00'), 0),
      { ...meter(bogota('2026-10-10T10:10:00'), 1000), ts_srv: bogota('2026-10-10T13:10:00') },
      { ...txStop(bogota('2026-10-10T10:20:00'), 2000), ts_srv: bogota('2026-10-10T13:20:00') },
    ] as SessionEvent[];
    const first = run(events, { flags: ['OFFLINE'] });
    const second = run([...events].reverse(), { flags: ['OFFLINE'] });
    expect(first.flags).toContain('OFFLINE');
    expect(second.input_hash).toBe(first.input_hash);
    expect(second.output_hash).toBe(first.output_hash);
    expect(second.lines).toEqual(first.lines);
  });
});

describe('T8 tope por sesión', () => {
  it('añade una línea CAP negativa con IVA proporcional y el total queda en 71,40', () => {
    const result = run([
      txStart(bogota('2026-10-06T18:00:00'), 0),
      txStop(bogota('2026-10-06T21:00:00'), 200000),
      status(bogota('2026-10-06T21:00:01'), 'Available'),
    ]);
    const cap = result.lines.find((l) => l.dimension === 'CAP');
    expect(cap).toMatchObject({ element_ref: 'max_price', quantity: '36.30' });
    expect(money(cap?.amount_minor ?? 0n)).toBe('-30.50');
    expect(money(cap?.tax_minor ?? 0n)).toBe('-5.80');
    expect(result.capped).toBe(true);
    expect(money(result.subtotal_minor)).toBe('60.00');
    expect(money(result.total_minor)).toBe('71.40');
  });

  it('aplica min_price cuando el total queda por debajo del mínimo', () => {
    const result = run(
      [txStart(bogota('2026-10-06T18:00:00'), 0), txStop(bogota('2026-10-06T18:01:00'), 100)],
      {
        tariff: { ...tariff, min_price: { excl_vat: '1.00', incl_vat: '1.19' } },
      },
    );
    expect(money(result.total_minor)).toBe('1.19');
    expect(result.lines.find((l) => l.dimension === 'CAP')?.element_ref).toBe('min_price');
    expect(result.capped).toBe(false);
  });
});

describe('T9 determinismo e idempotencia', () => {
  it('mismos eventos desordenados y con duplicados producen el mismo output_hash', () => {
    const events = [
      txStart(bogota('2026-10-06T17:35:00'), 120000),
      meter(bogota('2026-10-06T17:55:00'), 122400),
      meter(bogota('2026-10-06T18:05:00'), 123600),
      txStop(bogota('2026-10-06T19:20:00'), 131700),
      status(bogota('2026-10-06T19:20:03'), 'Finishing'),
      status(bogota('2026-10-06T19:52:30'), 'Available'),
    ];
    const shuffled = [
      events[5],
      events[2],
      events[0],
      events[4],
      events[2],
      events[1],
      events[3],
      events[0],
    ].filter((e): e is SessionEvent => e !== undefined);
    const a = run(events);
    const b = run(shuffled);
    expect(b.input_hash).toBe(a.input_hash);
    expect(b.output_hash).toBe(a.output_hash);
    expect(b.total_minor).toBe(a.total_minor);
  });

  it('el input_hash cambia con la tarifa, la política o los eventos', () => {
    const events = [
      txStart(bogota('2026-10-06T17:35:00'), 0),
      txStop(bogota('2026-10-06T18:35:00'), 1000),
    ];
    const base = run(events);
    expect(
      run(events, { policy: { ...policy, tax_rounding: 'PER_TAX_GROUP' } }).input_hash,
    ).not.toBe(base.input_hash);
    expect(
      run([...events, status(bogota('2026-10-06T18:35:01'), 'Available')]).input_hash,
    ).not.toBe(base.input_hash);
    expect(run(events, { tariff: { ...tariff, id: 'OTRA' } }).input_hash).not.toBe(base.input_hash);
  });
});

describe('T10 horario de verano', () => {
  const dstPolicy: CostPolicy = { ...policy, timezone: 'America/New_York' };

  it('hora repetida (fin del horario de verano): duración UTC correcta y sin doble cobro', () => {
    // 2026-11-01 01:59 EDT -> 01:00 EST. Sesión de 00:30 EDT a 02:30 EST = 3 h UTC.
    const result = compute({
      tariff,
      policy: dstPolicy,
      events: [txStart('2026-11-01T04:30:00Z', 0), txStop('2026-11-01T07:30:00Z', 9000)],
      mode: 'FINAL',
    });
    expect(result.summary.charging_time_s).toBe(10800);
    const energy = result.lines.filter((l) => l.dimension === 'ENERGY');
    expect(energy.reduce((acc, l) => acc + l.quantity_raw, 0n)).toBe(9000n);
    expect(energy.map((l) => l.element_ref)).toEqual(['e1']);
  });

  it('hora omitida (inicio del horario de verano): sin hueco ni doble cobro al cruzar el salto', () => {
    // 2026-03-08 02:00 EST -> 03:00 EDT (domingo). Sesión 01:30 EST (06:30Z) a 04:30 EDT (08:30Z) = 2 h UTC, toda en valle.
    const crossing = compute({
      tariff,
      policy: dstPolicy,
      events: [txStart('2026-03-08T06:30:00Z', 0), txStop('2026-03-08T08:30:00Z', 6000)],
      mode: 'FINAL',
    });
    expect(crossing.summary.charging_time_s).toBe(7200);
    expect(
      crossing.lines
        .filter((l) => l.dimension === 'ENERGY')
        .map((l) => [l.element_ref, l.quantity_raw]),
    ).toEqual([['e1', 6000n]]);
    // Tras el salto: 06:30 EDT (10:30Z) a 07:30 EDT (11:30Z): media hora de valle y media de respaldo de domingo.
    const after = compute({
      tariff,
      policy: dstPolicy,
      events: [txStart('2026-03-08T10:30:00Z', 0), txStop('2026-03-08T11:30:00Z', 6000)],
      mode: 'FINAL',
    });
    expect(
      after.lines
        .filter((l) => l.dimension === 'ENERGY')
        .map((l) => [l.element_ref, l.quantity_raw]),
    ).toEqual([
      ['e1', 3000n],
      ['e4', 3000n],
    ]);
  });
});

describe('T11 tarifa incompleta (fail-closed en el motor)', () => {
  it('rechaza una tarifa sin elemento ENERGY de respaldo cuando hay consumo fuera de las franjas', () => {
    const incomplete: Tariff = { ...tariff, elements: tariff.elements.filter((_, i) => i !== 4) };
    expect(() =>
      run(
        [txStart(bogota('2026-10-10T10:00:00'), 0), txStop(bogota('2026-10-10T11:00:00'), 1000)],
        {
          tariff: incomplete,
        },
      ),
    ).toThrow(TariffEngineError);
  });

  it('rechaza marcas de tiempo inválidas', () => {
    expect(() => run([txStart('ayer', 0)])).toThrow(/Marca de tiempo inválida/);
  });
});

describe('T12 precio con impuesto incluido', () => {
  it('0,119 por kWh con IVA 19 % y 10 kWh: bruto 1,19, impuesto 0,19, neto 1,00', () => {
    const { max_price: _ignored, ...uncapped } = tariff;
    const inclusive: Tariff = {
      ...uncapped,
      elements: [
        { price_components: [{ type: 'ENERGY', price: '0.119', vat: '19', step_size: 1 }] },
      ],
    };
    const result = run(
      [txStart(bogota('2026-10-10T10:00:00'), 0), txStop(bogota('2026-10-10T11:00:00'), 10000)],
      {
        tariff: inclusive,
        tax_included: true,
      },
    );
    const line = result.lines[0];
    expect(money(line?.amount_minor ?? 0n)).toBe('1.00');
    expect(money(line?.tax_minor ?? 0n)).toBe('0.19');
    expect(money(result.total_minor)).toBe('1.19');
    expect(result.subtotal_minor + result.tax_minor).toBe(result.total_minor);
  });
});

describe('ajustes', () => {
  const events = [
    txStart(bogota('2026-10-10T10:00:00'), 0),
    txStop(bogota('2026-10-10T11:00:00'), 10000),
  ];

  it('un ajuste por importe no puede dejar la dimensión en negativo', () => {
    const result = run(events, {
      adjustments: [{ type: 'AMOUNT', dimension: 'ENERGY', value: '-10.00', label: 'Cortesía' }],
    });
    const adjustment = result.lines.find((l) => l.dimension === 'ADJUSTMENT');
    expect(money(adjustment?.amount_minor ?? 0n)).toBe('-3.00');
    expect(result.flags).toContain('ADJUSTMENT_CAPPED');
    expect(money(result.total_minor)).toBe('0.60');
  });

  it('un ajuste sin líneas objetivo se omite con bandera', () => {
    const result = run(events, {
      adjustments: [{ type: 'PERCENT', dimension: 'TIME', value: '-50' }],
    });
    expect(result.lines.some((l) => l.dimension === 'ADJUSTMENT')).toBe(false);
    expect(result.flags).toContain('ADJUSTMENT_SKIPPED');
  });
});

describe('sesión sin eventos', () => {
  it('sin TX_START no hay líneas y se marca NO_TX_START', () => {
    const result = run([]);
    expect(result.lines).toEqual([]);
    expect(result.total_minor).toBe(0n);
    expect(result.flags).toEqual(['NO_TX_START']);
  });
});
