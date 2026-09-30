import { describe, expect, it } from 'vitest';
import {
  connectorStandard,
  connectorSummary,
  duration,
  energyKwh,
  isPowerShared,
  money,
  powerSummary,
  powerTypeLabel,
  relativeTime,
} from './format.ts';

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
  it('conectores con nombre comercial, corriente y potencia', () => {
    expect(connectorStandard('IEC_62196_T2_COMBO')).toBe('CCS2');
    expect(connectorStandard('IEC_62196_T2', 'en')).toBe('Type 2');
    expect(connectorStandard('OTRO_X')).toBe('OTRO X');
    expect(powerTypeLabel('AC_3_PHASE')).toBe('AC trifásica');
    expect(powerTypeLabel('DC', 'en')).toBe('DC');
    expect(
      connectorSummary([
        { standard: 'IEC_62196_T2_COMBO', max_power_w: 180_000 },
        { standard: 'IEC_62196_T2_COMBO', max_power_w: 180_000 },
      ]),
    ).toBe('2 × CCS2 · 180 kW');
    expect(
      connectorSummary(
        [
          { standard: 'IEC_62196_T1_COMBO', max_power_w: 90_000 },
          { standard: 'GBT_DC', max_power_w: null },
        ],
        'en',
      ),
    ).toBe('CCS1 + GB/T · 90 kW');
    expect(connectorSummary([])).toBe('—');
    // Gabinete de 180 kW compartido (ADR 0026): la lista lo dice en palabras.
    expect(
      connectorSummary([
        {
          standard: 'IEC_62196_T2_COMBO',
          max_power_w: 180_000,
          charger_max_power_w: 180_000,
          power_shared: true,
        },
        {
          standard: 'IEC_62196_T2_COMBO',
          max_power_w: 180_000,
          charger_max_power_w: 180_000,
          power_shared: true,
        },
      ]),
    ).toBe('2 × CCS2 · hasta 180 kW · compartida entre conectores');
    expect(
      powerSummary(
        180_000,
        [
          { standard: 'GBT_DC', max_power_w: 90_000 },
          { standard: 'GBT_DC', max_power_w: 90_000 },
        ],
        'en',
      ),
    ).toBe('180 kW');
    expect(isPowerShared(180_000, [180_000, 180_000])).toBe(true);
    expect(isPowerShared(180_000, [90_000, 90_000])).toBe(false);
  });
});
