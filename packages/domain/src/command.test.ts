import { describe, expect, it } from 'vitest';
import { COMMAND_STATES, canTransitionCommand, isFinalCommandState } from './command.ts';

describe('ciclo de vida de un comando remoto', () => {
  it('sigue PENDING -> SENT -> resultado', () => {
    expect(canTransitionCommand('PENDING', 'SENT')).toBe(true);
    expect(canTransitionCommand('SENT', 'ACCEPTED')).toBe(true);
    expect(canTransitionCommand('SENT', 'TIMEOUT')).toBe(true);
    expect(canTransitionCommand('SENT', 'ERROR')).toBe(true);
  });

  it('no aplica un resultado después del timeout', () => {
    expect(canTransitionCommand('TIMEOUT', 'ACCEPTED')).toBe(false);
  });

  it('solo se puede cancelar antes de enviar', () => {
    expect(canTransitionCommand('PENDING', 'CANCELLED')).toBe(true);
    expect(canTransitionCommand('SENT', 'CANCELLED')).toBe(false);
  });

  it('marca como finales todos los estados salvo PENDING y SENT', () => {
    for (const state of COMMAND_STATES) {
      expect(isFinalCommandState(state)).toBe(state !== 'PENDING' && state !== 'SENT');
    }
  });
});
