import { describe, expect, it } from 'vitest';
import {
  getActionMeta,
  isCentralSystemInitiated,
  isChargePointInitiated,
  OCPP16_ACTIONS,
  precompileAll,
  validateRequest,
  validateResponse,
} from './index.ts';

describe('catálogo de acciones', () => {
  it('contiene las 39 acciones de OCPP 1.6J con Security Whitepaper', () => {
    expect(OCPP16_ACTIONS).toHaveLength(39);
    expect(getActionMeta('BootNotification')?.profile).toBe('Core');
    expect(getActionMeta('SetChargingProfile')?.profile).toBe('SmartCharging');
    expect(getActionMeta('SecurityEventNotification')?.profile).toBe('Security');
  });

  it('distingue el iniciador', () => {
    expect(isChargePointInitiated('StartTransaction')).toBe(true);
    expect(isCentralSystemInitiated('StartTransaction')).toBe(false);
    expect(isCentralSystemInitiated('RemoteStartTransaction')).toBe(true);
    expect(isChargePointInitiated('DataTransfer')).toBe(true);
    expect(isCentralSystemInitiated('DataTransfer')).toBe(true);
    expect(isChargePointInitiated('Inventada')).toBe(false);
  });
});

describe('validación contra los esquemas oficiales', () => {
  it('compila los 78 esquemas', () => {
    expect(precompileAll()).toBe(78);
  });

  it('acepta un BootNotification válido y su respuesta', () => {
    expect(
      validateRequest('BootNotification', {
        chargePointVendor: 'Acme',
        chargePointModel: 'DC180',
        chargePointSerialNumber: '623400291',
        firmwareVersion: '1.2.3',
      }),
    ).toEqual({ ok: true });
    expect(
      validateResponse('BootNotification', {
        status: 'Pending',
        currentTime: '2026-09-19T12:00:00Z',
        interval: 60,
      }),
    ).toEqual({ ok: true });
  });

  it('rechaza campos obligatorios ausentes y propiedades desconocidas', () => {
    const missing = validateRequest('BootNotification', { chargePointVendor: 'Acme' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.join(' ')).toContain('chargePointModel');

    const extra = validateRequest('Heartbeat', { foo: 1 });
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.errors.join(' ')).toContain('foo');
  });

  it('rechaza enumeraciones inválidas en StatusNotification', () => {
    const result = validateRequest('StatusNotification', {
      connectorId: 1,
      errorCode: 'NoError',
      status: 'Offline',
    });
    expect(result.ok).toBe(false);
  });

  it('acepta MeterValues con measurands DC', () => {
    expect(
      validateRequest('MeterValues', {
        connectorId: 1,
        transactionId: 42,
        meterValue: [
          {
            timestamp: '2026-09-19T12:00:00Z',
            sampledValue: [
              { value: '123456', measurand: 'Energy.Active.Import.Register', unit: 'Wh' },
              { value: '150000', measurand: 'Power.Active.Import', unit: 'W' },
              { value: '57', measurand: 'SoC', unit: 'Percent' },
            ],
          },
        ],
      }),
    ).toEqual({ ok: true });
  });

  it('valida mensajes del Security Whitepaper (draft-06)', () => {
    expect(
      validateRequest('SecurityEventNotification', {
        type: 'SettingSystemTime',
        timestamp: '2026-09-19T12:00:00Z',
      }),
    ).toEqual({ ok: true });
    expect(validateResponse('SecurityEventNotification', {})).toEqual({ ok: true });
    expect(validateRequest('SecurityEventNotification', { type: 'X' }).ok).toBe(false);
  });

  it('devuelve error para acciones desconocidas', () => {
    const result = validateRequest('Inventada', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('desconocida');
  });
});
