import { describe, expect, it } from 'vitest';
import {
  distanceKm,
  formatClock,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatKw,
  formatKwh,
  formatMoney,
  formatPerKwh,
} from './format.ts';

describe('formatos del manual de marca', () => {
  it('importes', () => {
    expect(formatMoney('48240')).toBe('$ 48.240');
    expect(formatMoney('1350')).toBe('$ 1.350');
    expect(formatMoney('0')).toBe('$ 0');
    expect(formatMoney('12.50', 'USD')).toBe('USD 12,5');
    expect(formatMoney(48_240n)).toBe('$ 48.240');
    expect(formatMoney(null)).toBe('—');
    expect(formatPerKwh('1350')).toBe('$ 1.350/kWh');
  });

  it('energía, potencia, duración y distancia', () => {
    expect(formatKwh(22.4)).toBe('22,4 kWh');
    expect(formatKwh(22)).toBe('22 kWh');
    expect(formatKwh(null)).toBe('—');
    expect(formatKw(48)).toBe('48 kW');
    expect(formatKw(7.25)).toBe('7,3 kW');
    expect(formatKw(150.4)).toBe('150 kW');
    expect(formatDuration(720)).toBe('12 min');
    expect(formatDuration(3900)).toBe('1 h 05 min');
    expect(formatDuration(7200)).toBe('2 h');
    expect(formatDistance(0.35)).toBe('350 m');
    expect(formatDistance(1.24)).toBe('1,2 km');
    expect(formatDistance(15.6)).toBe('16 km');
    expect(
      distanceKm({ latitude: 4.65, longitude: -74.05 }, { latitude: 4.65, longitude: -74.05 }),
    ).toBe(0);
    // Bogotá – Medellín en línea recta: unos 246 km.
    const bogotaMedellin = distanceKm(
      { latitude: 4.6097, longitude: -74.0817 },
      { latitude: 6.2442, longitude: -75.5812 },
    );
    expect(bogotaMedellin).toBeGreaterThan(240);
    expect(bogotaMedellin).toBeLessThan(250);
  });

  it('hora y fecha en Bogotá', () => {
    expect(formatClock('2026-10-06T20:20:00Z')).toBe('3:20 p. m.');
    expect(formatClock('2026-10-06T05:05:00Z')).toBe('12:05 a. m.');
    expect(formatClock('2026-10-06T17:00:00Z')).toBe('12:00 p. m.');
    expect(formatDateTime('2026-10-06T20:20:00Z', 'es')).toBe('6 oct 2026, 3:20 p. m.');
    expect(formatDateTime('2026-10-06T20:20:00Z', 'en')).toBe('Oct 6, 2026, 3:20 p. m.');
    expect(formatClock(null)).toBe('—');
  });
});
