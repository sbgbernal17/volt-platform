import { describe, expect, it } from 'vitest';
import {
  bootNotificationStatusFor,
  canStartBillableTransaction,
  canTransitionLifecycle,
  isCommissioning,
  LIFECYCLE_STATES,
} from './charge-point-lifecycle.ts';

describe('ciclo de vida del cargador', () => {
  it('responde Pending hasta que la configuración está aplicada', () => {
    expect(bootNotificationStatusFor('PROVISIONED')).toBe('Pending');
    expect(bootNotificationStatusFor('CONNECTED_PENDING')).toBe('Pending');
    expect(bootNotificationStatusFor('CONFIGURED')).toBe('Accepted');
    expect(bootNotificationStatusFor('OPERATIONAL')).toBe('Accepted');
    expect(bootNotificationStatusFor('REJECTED')).toBe('Rejected');
    expect(bootNotificationStatusFor('DECOMMISSIONED')).toBe('Rejected');
  });

  it('solo cobra en OPERATIONAL o MAINTENANCE', () => {
    for (const state of LIFECYCLE_STATES) {
      expect(canStartBillableTransaction(state)).toBe(
        state === 'OPERATIONAL' || state === 'MAINTENANCE',
      );
    }
  });

  it('identifica los estados de comisionamiento', () => {
    expect(isCommissioning('CONFIGURED')).toBe(true);
    expect(isCommissioning('OPERATIONAL')).toBe(false);
  });

  it('sigue el camino de puesta en marcha', () => {
    expect(canTransitionLifecycle('INVENTORIED', 'PROVISIONED')).toBe(true);
    expect(canTransitionLifecycle('PROVISIONED', 'CONNECTED_PENDING')).toBe(true);
    expect(canTransitionLifecycle('CONNECTED_PENDING', 'CONFIGURED')).toBe(true);
    expect(canTransitionLifecycle('CONFIGURED', 'TESTED')).toBe(true);
    expect(canTransitionLifecycle('TESTED', 'OPERATIONAL')).toBe(true);
    expect(canTransitionLifecycle('OPERATIONAL', 'MAINTENANCE')).toBe(true);
    expect(canTransitionLifecycle('INVENTORIED', 'OPERATIONAL')).toBe(false);
    expect(canTransitionLifecycle('DECOMMISSIONED', 'OPERATIONAL')).toBe(false);
  });
});
