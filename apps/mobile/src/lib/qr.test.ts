import { describe, expect, it } from 'vitest';
import { evseQrUrl, parseEvseQr } from './qr.ts';

describe('QR del conector', () => {
  it('acepta la URL universal, el esquema propio, la consulta y el identificador a secas', () => {
    expect(parseEvseQr('https://app.supercargadores.co/evse/VOLT-BOG01-CP01-1')).toBe(
      'VOLT-BOG01-CP01-1',
    );
    expect(parseEvseQr('https://app.supercargadores.co/evse/VOLT-BOG01-CP01-1?utm=x')).toBe(
      'VOLT-BOG01-CP01-1',
    );
    expect(parseEvseQr('volt://evse/VOLT-BOG01-CP01-2')).toBe('VOLT-BOG01-CP01-2');
    expect(parseEvseQr('https://app.supercargadores.co/?evse=VOLT-BOG01-CP01-1')).toBe(
      'VOLT-BOG01-CP01-1',
    );
    expect(parseEvseQr('  VOLT-BOG01-CP01-1 ')).toBe('VOLT-BOG01-CP01-1');
    expect(parseEvseQr('https://otro.sitio/lo-que-sea')).toBeNull();
    expect(parseEvseQr('')).toBeNull();
    expect(parseEvseQr('https://app.supercargadores.co/evse/')).toBeNull();
    expect(evseQrUrl('VOLT-BOG01-CP01-1')).toBe(
      'https://app.supercargadores.co/evse/VOLT-BOG01-CP01-1',
    );
  });
});
