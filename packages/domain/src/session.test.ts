import { describe, expect, it } from 'vitest';
import {
  assertSessionTransition,
  canTransitionSession,
  InvalidSessionTransitionError,
  isSessionActive,
  isTerminalSessionState,
  SESSION_STATES,
  type SessionState,
  toAppSessionState,
} from './session.ts';

describe('máquina de estados de la sesión', () => {
  it('recorre el camino feliz completo', () => {
    const path: SessionState[] = [
      'REQUESTED',
      'AUTHORIZED',
      'STARTING',
      'CHARGING',
      'SUSPENDED_EV',
      'CHARGING',
      'STOPPING',
      'ENDED',
      'SETTLED',
      'PAID',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i] as SessionState;
      const to = path[i + 1] as SessionState;
      expect(canTransitionSession(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it('rechaza saltos no permitidos', () => {
    expect(canTransitionSession('REQUESTED', 'CHARGING')).toBe(false);
    expect(canTransitionSession('PAID', 'CHARGING')).toBe(false);
    expect(canTransitionSession('ENDED', 'CHARGING')).toBe(false);
    expect(() => assertSessionTransition('REQUESTED', 'PAID')).toThrow(
      InvalidSessionTransitionError,
    );
  });

  it('permite reabrir una sesión expirada con un StartTransaction tardío', () => {
    expect(canTransitionSession('EXPIRED', 'CHARGING')).toBe(true);
  });

  it('permite reintentar el cobro sin cambiar de estado', () => {
    expect(canTransitionSession('SETTLED', 'SETTLED')).toBe(true);
  });

  it('permite el cierre directo con StopTransaction sin pasar por STOPPING', () => {
    expect(canTransitionSession('CHARGING', 'ENDED')).toBe(true);
    expect(canTransitionSession('SUSPENDED_EVSE', 'ENDED')).toBe(true);
  });

  it('proyecta los trece estados a los ocho que ve la app', () => {
    const expected: Record<SessionState, string> = {
      REQUESTED: 'REQUESTED',
      AUTHORIZED: 'REQUESTED',
      STARTING: 'STARTING',
      CHARGING: 'ACTIVE',
      SUSPENDED_EV: 'ACTIVE',
      SUSPENDED_EVSE: 'ACTIVE',
      STOPPING: 'STOPPING',
      ENDED: 'ENDED',
      SETTLED: 'SETTLED',
      PAID: 'SETTLED',
      FAILED: 'FAILED',
      EXPIRED: 'FAILED',
      CANCELLED: 'CANCELLED',
    };
    for (const state of SESSION_STATES) {
      expect(toAppSessionState(state)).toBe(expected[state]);
    }
  });

  it('distingue estados terminales y activos', () => {
    expect(isTerminalSessionState('PAID')).toBe(true);
    expect(isTerminalSessionState('EXPIRED')).toBe(false);
    expect(isSessionActive('SUSPENDED_EV')).toBe(true);
    expect(isSessionActive('STOPPING')).toBe(false);
  });
});
