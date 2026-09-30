import { describe, expect, it } from 'vitest';
import { isPowerShared, sharedPowerW } from './power.ts';

describe('potencia por gabinete (ADR 0026)', () => {
  it('180 kW con dos conectores de 180 kW: compartida; 2 × 90 kW fijos: no', () => {
    expect(isPowerShared(180_000, [180_000, 180_000])).toBe(true);
    expect(isPowerShared(180_000, [90_000, 90_000])).toBe(false);
    expect(isPowerShared(180_000, [null, null])).toBe(true);
    expect(isPowerShared(null, [180_000, 180_000])).toBe(false);
    expect(isPowerShared(180_000, [180_000])).toBe(false);
  });

  it('reparte la potencia entre los conectores activos', () => {
    expect(sharedPowerW(180_000, 1, 180_000)).toBe(180_000);
    expect(sharedPowerW(180_000, 2, 180_000)).toBe(90_000);
    expect(sharedPowerW(180_000, 2, 50_000)).toBe(50_000);
    expect(sharedPowerW(null, 2, 50_000)).toBe(50_000);
  });
});
