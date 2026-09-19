import { describe, expect, it } from 'vitest';
import {
  CHARGE_POINT_STATUSES,
  deriveDisplayStatus,
  isChargePointStatus,
  isExpectedTransition,
  isOccupied,
} from './connector-status.ts';

describe('transiciones de estado del conector (OCPP 1.6)', () => {
  it('acepta las transiciones previstas por la especificación', () => {
    expect(isExpectedTransition('Available', 'Preparing')).toBe(true);
    expect(isExpectedTransition('Preparing', 'Charging')).toBe(true);
    expect(isExpectedTransition('Charging', 'SuspendedEV')).toBe(true);
    expect(isExpectedTransition('SuspendedEV', 'Charging')).toBe(true);
    expect(isExpectedTransition('Charging', 'Finishing')).toBe(true);
    expect(isExpectedTransition('Finishing', 'Available')).toBe(true);
    expect(isExpectedTransition('Faulted', 'Reserved')).toBe(true);
    expect(isExpectedTransition('Unavailable', 'SuspendedEVSE')).toBe(true);
  });

  it('marca como no previstas las que la especificación no contempla', () => {
    expect(isExpectedTransition('Charging', 'Reserved')).toBe(false);
    expect(isExpectedTransition('Finishing', 'Charging')).toBe(false);
    expect(isExpectedTransition('Reserved', 'Charging')).toBe(false);
  });

  it('trata un estado repetido como refresco válido', () => {
    for (const status of CHARGE_POINT_STATUSES) {
      expect(isExpectedTransition(status, status)).toBe(true);
    }
  });

  it('reconoce los nueve estados y rechaza Offline como estado OCPP', () => {
    expect(isChargePointStatus('Charging')).toBe(true);
    expect(isChargePointStatus('Offline')).toBe(false);
    expect(isChargePointStatus(42)).toBe(false);
  });

  it('identifica los estados ocupados', () => {
    expect(isOccupied('Charging')).toBe(true);
    expect(isOccupied('Finishing')).toBe(true);
    expect(isOccupied('Available')).toBe(false);
    expect(isOccupied('Reserved')).toBe(false);
  });
});

describe('estado derivado Offline', () => {
  const now = new Date('2026-09-19T12:00:00Z');

  it('conserva el estado OCPP cuando el cargador está conectado y activo', () => {
    expect(
      deriveDisplayStatus({
        ocppStatus: 'Charging',
        connected: true,
        lastSeenAt: new Date('2026-09-19T11:59:30Z'),
        offlineAfterSeconds: 600,
        now,
      }),
    ).toBe('Charging');
  });

  it('devuelve Offline si no hay socket abierto, sin perder el último estado crudo', () => {
    expect(
      deriveDisplayStatus({
        ocppStatus: 'Charging',
        connected: false,
        lastSeenAt: new Date('2026-09-19T11:59:30Z'),
        offlineAfterSeconds: 600,
        now,
      }),
    ).toBe('Offline');
  });

  it('devuelve Offline si el cargador lleva demasiado tiempo sin enviar ningún mensaje', () => {
    expect(
      deriveDisplayStatus({
        ocppStatus: 'Available',
        connected: true,
        lastSeenAt: new Date('2026-09-19T11:40:00Z'),
        offlineAfterSeconds: 600,
        now,
      }),
    ).toBe('Offline');
  });
});
