import { describe, expect, it } from 'vitest';
import { nitCheckDigit, normalizeDriverDocument } from './document.ts';

describe('documento de identidad (ADR 0027)', () => {
  it('normaliza cédulas, extranjería, pasaporte y PPT', () => {
    expect(normalizeDriverDocument('CC', ' 1.020.304.050 ')).toBe('1020304050');
    expect(normalizeDriverDocument('CE', '123456')).toBe('123456');
    expect(normalizeDriverDocument('PAS', 'ab 123456')).toBe('AB123456');
    expect(normalizeDriverDocument('PPT', '1234567')).toBe('1234567');
    expect(() => normalizeDriverDocument('CC', '12')).toThrow(/dígitos/);
    expect(() => normalizeDriverDocument('PAS', '1')).toThrow(/letras o dígitos/);
  });

  it('NIT: calcula y comprueba el dígito de verificación de la DIAN', () => {
    expect(nitCheckDigit('800197268')).toBe(4);
    expect(normalizeDriverDocument('NIT', '800.197.268-4')).toBe('800197268-4');
    expect(normalizeDriverDocument('NIT', '800197268')).toBe('800197268-4');
    expect(() => normalizeDriverDocument('NIT', '800197268-1')).toThrow(/verificación/);
  });
});
