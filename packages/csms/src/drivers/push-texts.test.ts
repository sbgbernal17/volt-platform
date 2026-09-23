import { describe, expect, it } from 'vitest';
import { buildPushText, formatKwh, formatMoney } from './push-texts.ts';

describe('textos de las notificaciones push', () => {
  it('formatea importes y energía al estilo colombiano del manual de marca', () => {
    expect(formatMoney(48_240n)).toBe('$ 48.240');
    expect(formatMoney(1_350n)).toBe('$ 1.350');
    expect(formatMoney(0n)).toBe('$ 0');
    expect(formatMoney(1_234_567n)).toBe('$ 1.234.567');
    expect(formatMoney(-500n)).toBe('-$ 500');
    expect(formatMoney(1250n, 'USD')).toBe('USD 12,50');
    expect(formatKwh(22_400)).toBe('22,4 kWh');
    expect(formatKwh(22_000)).toBe('22 kWh');
    expect(formatKwh(48_640)).toBe('48,6 kWh');
    expect(formatKwh(1_234_500)).toBe('1.234,5 kWh');
  });

  it('escribe los textos en español e inglés según docs/textos-app-conductor.md', () => {
    expect(
      buildPushText('SESSION_STARTED', 'es', { chargeBoxId: 'VOLT-BOG01', connectorId: 2 }),
    ).toEqual({
      title: 'Carga iniciada',
      body: 'Su vehículo empezó a cargar en el cargador VOLT-BOG01, conector 2. Siga el progreso en la app.',
    });
    expect(
      buildPushText('IDLE_STARTED', 'es', {
        energyWh: 22_400,
        gracePeriodMin: 15,
        idlePricePerMinuteMinor: 1500n,
        currency: 'COP',
      }).body,
    ).toBe(
      '22,4 kWh cargados. Tiene 15 minutos de cortesía para desconectar el vehículo. Después se cobra ocupación de $ 1.500 por minuto.',
    );
    expect(
      buildPushText('EXPOSURE_WARNING', 'es', {
        totalMinor: 160_000n,
        limitMinor: 200_000n,
        currency: 'COP',
      }).body,
    ).toBe(
      'Esta sesión va en $ 160.000 de un límite de $ 200.000. Al llegar al límite la carga se detendrá sola; puede iniciar otra sesión.',
    );
    expect(
      buildPushText('SESSION_SETTLED', 'es', {
        energyWh: 22_400,
        energyMinor: 30_240n,
        idleMinutes: 12,
        idleMinor: 18_000n,
        totalMinor: 48_240n,
        currency: 'COP',
      }),
    ).toEqual({
      title: 'Sesión terminada',
      body: 'Energía: 22,4 kWh, $ 30.240. Ocupación: 12 minutos, $ 18.000. Total: $ 48.240.',
    });
    expect(
      buildPushText('SESSION_SETTLED', 'en', {
        energyWh: 10_000,
        energyMinor: 13_500n,
        idleMinutes: 0,
        idleMinor: 0n,
        totalMinor: 13_500n,
        currency: 'COP',
      }).body,
    ).toBe('Energy: 10 kWh, $ 13.500. Total: $ 13.500.');
    expect(
      buildPushText('PAYMENT_CAPTURED', 'es', {
        amountMinor: 48_240n,
        currency: 'COP',
        method: { kind: 'CARD', last4: '4242' },
        receiptNumber: '1234',
      }).body,
    ).toBe(
      'Cobro aprobado: $ 48.240 a la tarjeta terminada en 4242. Recibo N.º 1234 disponible en Historial.',
    );
    expect(
      buildPushText('PAYMENT_CAPTURED', 'en', {
        amountMinor: 48_240n,
        currency: 'COP',
        method: { kind: 'WALLET', last4: null },
        receiptNumber: null,
      }).body,
    ).toBe('Payment approved: $ 48.240 to your Nequi account.');
    expect(
      buildPushText('PAYMENT_FAILED', 'en', { amountMinor: 48_240n, currency: 'COP' }),
    ).toEqual({
      title: 'Payment declined',
      body: 'We could not charge $ 48.240 to your payment method. Update it or pay the link to charge again.',
    });
    expect(buildPushText('SESSION_EXPIRED', 'es', {}).body).toBe(
      'No detectamos el vehículo. Conecte el cable y vuelva a iniciar.',
    );
    expect(
      buildPushText('EXPOSURE_EXHAUSTED', 'en', { limitMinor: 200_000n, currency: 'COP' }).body,
    ).toBe("Charging stopped at this session's $ 200.000 limit. You can start a new session.");
  });
});
