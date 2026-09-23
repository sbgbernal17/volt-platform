import { describe, expect, it } from 'vitest';
import { duration, energyKwh, money, relativeTime } from './format.ts';

describe('formato', () => {
  it('importes en COP sin decimales y en USD con dos', () => {
    expect(money('46500', 'COP', 'es').replace(/ /g, ' ')).toBe('$ 46.500');
    expect(money(1234, 'USD', 'en')).toBe('$12.34');
    expect(money(null)).toBe('—');
  });
  it('energía, duración y tiempo relativo', () => {
    expect(energyKwh(23500, 'en')).toBe('23.5 kWh');
    expect(duration(3725)).toBe('1 h 02 min');
    expect(duration(65)).toBe('1 min 05 s');
    expect(
      relativeTime(new Date('2026-09-22T10:00:00Z'), 'en', new Date('2026-09-22T10:00:30Z')),
    ).toBe('30 seconds ago');
  });
});
