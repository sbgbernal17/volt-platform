import { describe, expect, it } from 'vitest';
import { formatPhone, groupPhoneInput, normalizePhoneInput } from './phone.ts';

describe('celular en la app', () => {
  it('valida y normaliza como la API', () => {
    expect(normalizePhoneInput('300 123 4567')).toBe('+573001234567');
    expect(normalizePhoneInput('57 300 123 4567')).toBe('+573001234567');
    expect(normalizePhoneInput('+57 300 123 4567')).toBe('+573001234567');
    expect(normalizePhoneInput('+1 415 555 2671')).toBe('+14155552671');
    expect(normalizePhoneInput('604 123 4567')).toBeNull();
    expect(normalizePhoneInput('+57 604 123 4567')).toBeNull();
    expect(normalizePhoneInput('12')).toBeNull();
    expect(normalizePhoneInput('')).toBeNull();
  });

  it('formatea y agrupa', () => {
    expect(formatPhone('+573001234567')).toBe('+57 300 123 4567');
    expect(formatPhone(null)).toBe('');
    expect(groupPhoneInput('3001234567')).toBe('300 123 4567');
    expect(groupPhoneInput('30012')).toBe('300 12');
    expect(groupPhoneInput('+57 300 1234567')).toBe('+57 300 1234567');
  });
});
