/**
 * Tarifa base de Volt (ADR 0012, ADR 0017, ADR 0018), idéntica al fixture `volt-colombia-tarifa-base.json`.
 * Precios definidos por el dueño el 22 de septiembre de 2026: 1.350 COP por kWh de 05:00 a 20:00 y
 * 1.200 COP por kWh de 20:00 a 05:00; servicio excluido de IVA (sin componente de impuesto); 15 minutos
 * de gracia y luego 1.500 COP por minuto de ocupación (90.000 por hora, semántica OCPI) mientras el
 * vehículo siga conectado, sin tope de tiempo. Todo se cambia publicando una versión nueva.
 */
import type { CostPolicy, Tariff } from './types.ts';

export const VOLT_BASE_TARIFF: Tariff = {
  country_code: 'CO',
  party_id: 'VLT',
  id: 'VOLT-BASE',
  version: 1,
  currency: 'COP',
  type: 'REGULAR',
  tariff_alt_text: [
    {
      language: 'es',
      text: 'Energía: 1.350 COP por kWh de 05:00 a 20:00 y 1.200 COP por kWh de 20:00 a 05:00. Tras terminar la carga: 15 minutos de gracia y luego 1.500 COP por minuto de ocupación mientras el vehículo siga conectado. Servicio excluido de IVA.',
    },
    {
      language: 'en',
      text: 'Energy: COP 1,350 per kWh from 05:00 to 20:00 and COP 1,200 per kWh from 20:00 to 05:00. After charging ends: 15 minutes grace, then COP 1,500 per minute of occupancy while the vehicle stays plugged in. VAT-exempt service.',
    },
  ],
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
  start_date_time: '2026-10-01T05:00:00Z',
  last_updated: '2026-09-22T00:00:00Z',
};

export const VOLT_BASE_POLICY: CostPolicy = {
  rounding: 'HALF_UP',
  tax_rounding: 'PER_LINE',
  currency_exponent: 0,
  timezone: 'America/Bogota',
};
