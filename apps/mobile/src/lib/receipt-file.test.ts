import { describe, expect, it } from 'vitest';
import { receiptFilename } from './receipt-file.types.ts';

describe('recibo en PDF', () => {
  it('el nombre del archivo solo lleva letras, dígitos y guiones', () => {
    expect(receiptFilename('VO-2026-000123')).toBe('recibo-VO-2026-000123.pdf');
    expect(receiptFilename('S 1/2')).toBe('recibo-S-1-2.pdf');
  });
});
