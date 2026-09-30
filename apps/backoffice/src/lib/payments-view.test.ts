import { describe, expect, it } from 'vitest';
import { bogotaToday, periodRange } from './payments-view.ts';

describe('períodos del resumen de pagos (días de Colombia)', () => {
  const now = new Date('2026-10-01T03:30:00.000Z'); // 30-09-2026 22:30 en Bogotá

  it('hoy es el día de Colombia, no el de UTC', () => {
    expect(bogotaToday(now)).toBe('2026-09-30');
  });

  it('calcula los rangos inclusivos', () => {
    expect(periodRange('today', now)).toEqual({ from: '2026-09-30', to: '2026-09-30' });
    expect(periodRange('7d', now)).toEqual({ from: '2026-09-24', to: '2026-09-30' });
    expect(periodRange('month', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange('30d', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
});
