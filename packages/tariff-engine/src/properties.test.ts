/**
 * Pruebas de propiedad de TAR §7.2 con un generador pseudoaleatorio con semilla fija
 * (mulberry32) para que cada ejecución sea reproducible y no dependa de dependencias nuevas.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CostPolicy, compute, type SessionEvent, type Tariff } from './index.ts';

const tariff = JSON.parse(
  readFileSync(new URL('../fixtures/tar-6-1-tarifa-ejemplo.json', import.meta.url), 'utf8'),
) as Tariff;
const { max_price: _ignored, ...uncappedTariff } = tariff;

const policy: CostPolicy = {
  rounding: 'HALF_UP',
  tax_rounding: 'PER_LINE',
  currency_exponent: 2,
  timezone: 'America/Bogota',
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Scenario {
  events: SessionEvent[];
  meterStart: number;
  meterStop: number;
  startMs: number;
  stopMs: number;
}

/** Sesión aleatoria dentro de octubre de 2026: inicio, lecturas crecientes con huecos, parada y fin de ocupación. */
function scenario(random: () => number): Scenario {
  const base = Date.UTC(2026, 9, 1, 5, 0, 0);
  const startMs = base + Math.floor(random() * 30 * 86400) * 1000;
  const meterStart = Math.floor(random() * 500_000);
  const intervalS = 60 + Math.floor(random() * 900);
  const samples = 1 + Math.floor(random() * 30);
  const events: SessionEvent[] = [
    { kind: 'TX_START', ts_cp: iso(startMs), ts_srv: iso(startMs), meter_start_wh: meterStart },
  ];
  let register = meterStart;
  let ts = startMs;
  for (let i = 0; i < samples; i += 1) {
    ts += intervalS * 1000;
    register += Math.floor(random() * 4000);
    if (random() < 0.8) {
      events.push({ kind: 'METER', ts_cp: iso(ts), ts_srv: iso(ts), register_wh: register });
    }
  }
  const stopMs = ts + Math.floor(random() * intervalS) * 1000;
  register += Math.floor(random() * 2000);
  events.push({
    kind: 'TX_STOP',
    ts_cp: iso(stopMs),
    ts_srv: iso(stopMs),
    meter_stop_wh: register,
  });
  const idleEnd = stopMs + Math.floor(random() * 5400) * 1000;
  events.push({ kind: 'STATUS', ts_cp: iso(idleEnd), ts_srv: iso(idleEnd), status: 'Available' });
  return { events, meterStart, meterStop: register, startMs, stopMs };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

const RUNS = 150;

describe('propiedades del motor (TAR §7.2)', () => {
  it('P1: la energía por franja suma exactamente meterStop - meterStart', () => {
    const random = mulberry32(1);
    for (let run = 0; run < RUNS; run += 1) {
      const s = scenario(random);
      const result = compute({ tariff, policy, events: s.events, mode: 'FINAL' });
      const energy = result.lines.filter((l) => l.dimension === 'ENERGY');
      const total = energy.reduce((acc, l) => acc + l.quantity_raw, 0n);
      expect(total).toBe(BigInt(s.meterStop - s.meterStart));
      expect(result.summary.energy_wh).toBe(s.meterStop - s.meterStart);
    }
  });

  it('P2: el costo RUNNING es monótono no decreciente en el tiempo sin tope', () => {
    const random = mulberry32(2);
    for (let run = 0; run < 40; run += 1) {
      const s = scenario(random);
      let previous = -1n;
      for (let t = s.startMs; t <= s.stopMs + 7200_000; t += 300_000) {
        const result = compute({
          tariff: uncappedTariff,
          policy,
          events: s.events,
          mode: 'RUNNING',
          now: iso(t),
          adjustments: [{ type: 'PERCENT', dimension: 'ENERGY', value: '-15' }],
        });
        expect(result.total_minor).toBeGreaterThanOrEqual(previous);
        previous = result.total_minor;
      }
    }
  });

  it('P3: invariante al orden y a los duplicados de eventos', () => {
    const random = mulberry32(3);
    for (let run = 0; run < RUNS; run += 1) {
      const s = scenario(random);
      const reference = compute({ tariff, policy, events: s.events, mode: 'FINAL' });
      const noisy = shuffle([...s.events, ...s.events.slice(0, 3)], random);
      const result = compute({ tariff, policy, events: noisy, mode: 'FINAL' });
      expect(result.output_hash).toBe(reference.output_hash);
      expect(result.input_hash).toBe(reference.input_hash);
    }
  });

  it('P4: insertar una lectura interpolada en un borde de franja no cambia el resultado', () => {
    const random = mulberry32(4);
    let exercised = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const s = scenario(random);
      const reference = compute({ tariff, policy, events: s.events, mode: 'FINAL' });
      // Buscar un borde de franja (inicio de una línea ENERGY) que caiga estrictamente dentro de un tramo.
      const samples = s.events
        .filter(
          (e): e is Extract<SessionEvent, { kind: 'METER' | 'TX_START' | 'TX_STOP' }> =>
            e.kind !== 'STATUS' && e.kind !== 'IDLE_END',
        )
        .map((e) => ({
          ts: Date.parse(e.ts_cp),
          wh:
            e.kind === 'TX_START'
              ? e.meter_start_wh
              : e.kind === 'METER'
                ? e.register_wh
                : e.meter_stop_wh,
        }))
        .sort((a, b) => a.ts - b.ts);
      let boundaryMs = Number.NaN;
      let index = -1;
      for (const line of reference.lines) {
        if (line.dimension !== 'ENERGY' || line.period_start === undefined) continue;
        const candidate = Date.parse(line.period_start);
        const found = samples.findIndex((sample, i) => {
          const next = samples[i + 1];
          return next !== undefined && sample.ts < candidate && candidate < next.ts;
        });
        if (found >= 0) {
          boundaryMs = candidate;
          index = found;
          break;
        }
      }
      if (index < 0) continue;
      const a = samples[index] as { ts: number; wh: number };
      const b = samples[index + 1] as { ts: number; wh: number };
      const delta = BigInt(b.wh - a.wh);
      const span = BigInt(b.ts - a.ts);
      const num = delta * BigInt(boundaryMs - a.ts);
      const interpolated = a.wh + Number((num + span / 2n) / span);
      const inserted: SessionEvent = {
        kind: 'METER',
        ts_cp: iso(boundaryMs),
        ts_srv: iso(boundaryMs),
        register_wh: interpolated,
      };
      const result = compute({ tariff, policy, events: [...s.events, inserted], mode: 'FINAL' });
      expect(
        result.lines.map((l) => [l.dimension, l.element_ref, l.quantity_raw, l.amount_minor]),
      ).toEqual(
        reference.lines.map((l) => [l.dimension, l.element_ref, l.quantity_raw, l.amount_minor]),
      );
      exercised += 1;
    }
    expect(exercised).toBeGreaterThan(10);
  });

  it('P5: total <= max_price y total >= min_price cuando están definidos', () => {
    const random = mulberry32(5);
    const bounded: Tariff = { ...tariff, min_price: { excl_vat: '1.00', incl_vat: '1.19' } };
    for (let run = 0; run < RUNS; run += 1) {
      const s = scenario(random);
      const result = compute({ tariff: bounded, policy, events: s.events, mode: 'FINAL' });
      expect(result.total_minor).toBeLessThanOrEqual(7140n);
      expect(result.total_minor).toBeGreaterThanOrEqual(119n);
      expect(result.subtotal_minor + result.tax_minor).toBe(result.total_minor);
    }
  });

  it('P6: con 0 Wh solo se cobra la sesión (y la ocupación si aplica); con gracia >= idle no hay ocupación', () => {
    const random = mulberry32(6);
    for (let run = 0; run < 50; run += 1) {
      const s = scenario(random);
      const zero = s.events.map((e) =>
        e.kind === 'METER'
          ? { ...e, register_wh: s.meterStart }
          : e.kind === 'TX_STOP'
            ? { ...e, meter_stop_wh: s.meterStart }
            : e,
      );
      const result = compute({ tariff, policy, events: zero, mode: 'FINAL' });
      expect(
        result.lines.every((l) => l.dimension === 'FLAT' || l.dimension === 'PARKING_TIME'),
      ).toBe(true);
      expect(result.lines.filter((l) => l.dimension === 'FLAT')).toHaveLength(1);
      const shortIdle = zero.map((e) =>
        e.kind === 'STATUS'
          ? { ...e, ts_cp: iso(s.stopMs + 500_000), ts_srv: iso(s.stopMs + 500_000) }
          : e,
      );
      const graced = compute({ tariff, policy, events: shortIdle, mode: 'FINAL' });
      expect(graced.lines.some((l) => l.dimension === 'PARKING_TIME')).toBe(false);
      expect(graced.summary.billable_idle_s).toBe(0);
    }
  });
});
