import { describe, expect, it } from 'vitest';
import {
  billingVisual,
  connectorVisual,
  lifecycleVisual,
  paymentVisual,
  sessionVisual,
  severityVisual,
} from './status.ts';

describe('estados por palabra, ícono y color (ADR 0030)', () => {
  it('conectores: desconectado manda sobre el estado y lo desconocido va punteado', () => {
    expect(connectorVisual('Charging')).toMatchObject({ tone: 'primary', icon: 'bolt' });
    expect(connectorVisual('Charging', false)).toMatchObject({ icon: 'wifi-off', dotted: true });
    expect(connectorVisual('Raro')).toMatchObject({ label: 'Raro', dotted: true });
  });

  it('sesiones y pagos con los nombres reales del dominio', () => {
    expect(sessionVisual('SUSPENDED_EVSE').tone).toBe('warning');
    expect(sessionVisual('PAID')).toMatchObject({ tone: 'ok', label: 'session.state.PAID' });
    expect(paymentVisual('SUCCEEDED').tone).toBe('ok');
    expect(paymentVisual('CANCELLED')).toMatchObject({ tone: 'neutral', outlined: true });
    expect(paymentVisual(null).label).toBe('—');
  });

  it('ciclo de vida, severidad y cobro del conductor', () => {
    expect(lifecycleVisual('OPERATIONAL')).toMatchObject({ tone: 'ok', icon: 'check' });
    expect(severityVisual('CRITICAL').tone).toBe('danger');
    expect(billingVisual('BLOCKED_DEBT')).toMatchObject({
      tone: 'danger',
      label: 'drivers.blockedDebt',
    });
  });
});
