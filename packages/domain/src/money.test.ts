import { describe, expect, it } from 'vitest';
import {
  COP,
  type CurrencyConfig,
  divideRounded,
  energyCostMinor,
  formatScaled,
  parseScaled,
  percentOfMinor,
  timeCostMinor,
} from './money.ts';

const USD_LIKE: CurrencyConfig = { code: 'XXX', exponent: 2 };

describe('divideRounded', () => {
  it('redondea medios según el modo', () => {
    expect(divideRounded(5n, 2n, 'HALF_UP')).toBe(3n);
    expect(divideRounded(5n, 2n, 'HALF_EVEN')).toBe(2n);
    expect(divideRounded(7n, 2n, 'HALF_EVEN')).toBe(4n);
    expect(divideRounded(5n, 2n, 'DOWN')).toBe(2n);
    expect(divideRounded(5n, 2n, 'UP')).toBe(3n);
    expect(divideRounded(4n, 2n, 'UP')).toBe(2n);
  });

  it('trata los negativos alejándose de cero en HALF_UP y UP', () => {
    expect(divideRounded(-5n, 2n, 'HALF_UP')).toBe(-3n);
    expect(divideRounded(-5n, 2n, 'HALF_EVEN')).toBe(-2n);
    expect(divideRounded(-5n, 2n, 'DOWN')).toBe(-2n);
    expect(divideRounded(-5n, 2n, 'UP')).toBe(-3n);
    expect(divideRounded(-1425n, 10n, 'HALF_UP')).toBe(-143n);
  });

  it('rechaza dividir por cero', () => {
    expect(() => divideRounded(1n, 0n, 'HALF_UP')).toThrow(RangeError);
  });
});

describe('parseScaled y formatScaled', () => {
  it('convierte ida y vuelta sin perder precisión', () => {
    expect(parseScaled('0.45', 6)).toBe(450000n);
    expect(parseScaled('1850', 6)).toBe(1850000000n);
    expect(parseScaled('-0.7455', 4)).toBe(-7455n);
    expect(formatScaled(450000n, 6)).toBe('0.450000');
    expect(formatScaled(-7455n, 4)).toBe('-0.7455');
    expect(formatScaled(21645n, 0)).toBe('21645');
    expect(formatScaled(5n, 2)).toBe('0.05');
  });

  it('rechaza más decimales de los admitidos y textos inválidos', () => {
    expect(() => parseScaled('0.1234567', 6)).toThrow(RangeError);
    expect(() => parseScaled('1,5', 2)).toThrow(SyntaxError);
  });
});

describe('costos en enteros (ejemplo verificado del capítulo TAR §6.2)', () => {
  it('energía por franja con moneda de dos decimales', () => {
    expect(energyCostMinor(3000n, parseScaled('0.35', 6), USD_LIKE)).toBe(105n);
    expect(energyCostMinor(8700n, parseScaled('0.45', 6), USD_LIKE)).toBe(392n);
    expect(energyCostMinor(8700n, parseScaled('0.45', 6), USD_LIKE, 'HALF_EVEN')).toBe(392n);
  });

  it('descuento del 15 % sobre 4,97 y redondeo de impuestos por línea', () => {
    expect(percentOfMinor(497n, 1500n)).toBe(75n);
    expect(percentOfMinor(50n, 1900n)).toBe(10n);
    expect(percentOfMinor(105n, 1900n)).toBe(20n);
    expect(percentOfMinor(392n, 1900n)).toBe(74n);
    expect(percentOfMinor(-75n, 1900n)).toBe(-14n);
    expect(percentOfMinor(230n, 1900n)).toBe(44n);
    expect(percentOfMinor(702n, 1900n)).toBe(133n);
  });

  it('idle fee: 23 minutos a 6,00 por hora equivalen a 0,10 por minuto', () => {
    expect(timeCostMinor(1380n, parseScaled('0.10', 6), USD_LIKE)).toBe(230n);
  });

  it('caso de prueba T6: 4,965 redondea distinto en HALF_UP y HALF_EVEN', () => {
    expect(divideRounded(4965n, 10n, 'HALF_UP')).toBe(497n);
    expect(divideRounded(4965n, 10n, 'HALF_EVEN')).toBe(496n);
  });

  it('pesos colombianos sin decimales: 11,7 kWh a 1.850 COP/kWh', () => {
    expect(energyCostMinor(11700n, parseScaled('1850', 6), COP)).toBe(21645n);
    expect(energyCostMinor(11700n, parseScaled('1850.5', 6), COP)).toBe(21651n);
  });
});
