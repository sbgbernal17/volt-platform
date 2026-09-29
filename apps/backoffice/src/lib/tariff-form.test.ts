import { describe, expect, it } from 'vitest';
import {
  decimalDivide,
  decimalTimes,
  definitionToForm,
  describeTariff,
  emptyForm,
  formToDefinition,
  type TariffDefinition,
  TariffFormError,
} from './tariff-form.ts';

/** Copia de la tarifa base de Volt (packages/tariff-engine/src/base-tariff.ts). */
const BASE: TariffDefinition = {
  country_code: 'CO',
  party_id: 'VLT',
  id: 'VOLT-BASE',
  version: 1,
  currency: 'COP',
  type: 'REGULAR',
  tariff_alt_text: [{ language: 'es', text: 'Energía: 1.350 COP por kWh de 05:00 a 20:00.' }],
  elements: [
    {
      price_components: [{ type: 'ENERGY', price: '1350', step_size: 1 }],
      restrictions: { start_time: '05:00', end_time: '20:00' },
    },
    {
      price_components: [{ type: 'ENERGY', price: '1200', step_size: 1 }],
      restrictions: { start_time: '20:00', end_time: '05:00' },
    },
    { price_components: [{ type: 'ENERGY', price: '1350', step_size: 1 }] },
    {
      price_components: [{ type: 'PARKING_TIME', price: '90000', step_size: 60 }],
      x_volt: { grace_period_s: 900, idle_start: 'EARLIEST' },
    },
  ],
  last_updated: '2026-09-22T00:00:00Z',
};

describe('editor guiado de tarifas', () => {
  it('aritmética decimal sin coma flotante', () => {
    expect(decimalTimes('1500', 60)).toBe('90000');
    expect(decimalTimes('12.5', 60)).toBe('750');
    expect(decimalTimes('0.45', 60)).toBe('27');
    expect(decimalDivide('90000', 60)).toBe('1500');
    expect(decimalDivide('27', 60)).toBe('0.45');
    expect(decimalDivide('100', 60)).toBeNull();
  });

  it('lee la tarifa base al formulario y la reconstruye igual', () => {
    const form = definitionToForm(BASE);
    expect(form).not.toBeNull();
    expect(form?.energyPrice).toBe('1350');
    expect(form?.bands).toEqual([
      { start: '05:00', end: '20:00', price: '1350', days: 'ALL' },
      { start: '20:00', end: '05:00', price: '1200', days: 'ALL' },
    ]);
    expect(form?.idleEnabled).toBe(true);
    expect(form?.idlePricePerMinute).toBe('1500');
    expect(form?.idleGraceMin).toBe('15');
    expect(form?.vat).toBe('');
    expect(form?.description).toBe('Energía: 1.350 COP por kWh de 05:00 a 20:00.');
    const rebuilt = formToDefinition(form as NonNullable<typeof form>, {
      code: 'VOLT-BASE',
      currency: 'COP',
      now: new Date('2026-09-29T00:00:00Z'),
      existing: BASE,
    });
    expect(rebuilt.elements).toEqual(BASE.elements);
    expect(rebuilt).toMatchObject({ country_code: 'CO', party_id: 'VLT', id: 'VOLT-BASE' });
  });

  it('genera cargos opcionales, impuesto, días y topes', () => {
    const form = {
      ...emptyForm(),
      energyPrice: '1400',
      bands: [{ start: '18:00', end: '22:00', price: '1600', days: 'WEEKDAYS' as const }],
      idleEnabled: true,
      idlePricePerMinute: '1000',
      idleGraceMin: '10',
      idleMaxMin: '120',
      idleStart: 'TRANSACTION_END' as const,
      sessionFee: '2000',
      timePricePerMinute: '12.5',
      vat: '19',
      maxPrice: '200000',
    };
    const definition = formToDefinition(form, { code: 'X', currency: 'COP' });
    expect(definition.elements.map((e) => e.price_components[0]?.type)).toEqual([
      'ENERGY',
      'ENERGY',
      'TIME',
      'FLAT',
      'PARKING_TIME',
    ]);
    expect(definition.elements[0]?.restrictions).toEqual({
      start_time: '18:00',
      end_time: '22:00',
      day_of_week: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    });
    expect(definition.elements[2]?.price_components[0]).toEqual({
      type: 'TIME',
      price: '750',
      vat: '19',
      step_size: 60,
    });
    expect(definition.elements[4]?.x_volt).toEqual({
      grace_period_s: 600,
      idle_start: 'TRANSACTION_END',
      max_idle_s: 7200,
    });
    expect(definition.max_price).toEqual({ excl_vat: '200000' });
    expect(definitionToForm(definition)).toEqual(form);
  });

  it('rechaza números mal escritos y manda al JSON las reglas que no cubre', () => {
    expect(() =>
      formToDefinition({ ...emptyForm(), energyPrice: '1.350,5' }, { code: 'X', currency: 'COP' }),
    ).toThrow(TariffFormError);
    const advanced: TariffDefinition = {
      ...BASE,
      elements: [
        {
          price_components: [{ type: 'ENERGY', price: '1000', step_size: 1 }],
          restrictions: { min_kwh: 20 },
        },
        { price_components: [{ type: 'ENERGY', price: '1350', step_size: 1 }] },
      ],
    };
    expect(definitionToForm(advanced)).toBeNull();
    expect(definitionToForm({ nada: true })).toBeNull();
  });

  it('resume una definición en frases', () => {
    const lines = describeTariff(BASE, 'es').map((line) => line.replace(/ /g, ' '));
    expect(lines[0]).toBe(
      'Energía: $ 1.350/kWh de 05:00 a 20:00; $ 1.200/kWh de 20:00 a 05:00; resto del día $ 1.350/kWh',
    );
    expect(lines[1]).toBe(
      'Ocupación: 15 minutos de cortesía, luego $ 1.500 por minuto, desde el fin de la carga o la pausa del vehículo',
    );
    expect(lines[2]).toBe('Sin impuesto (servicio excluido de IVA)');
    expect(describeTariff({ x: 1 }, 'en')).toEqual(['Includes advanced rules (see JSON)']);
  });
});
