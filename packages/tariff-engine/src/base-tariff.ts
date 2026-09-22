/**
 * Tarifa base de Volt (ADR 0012, ADR 0017), idéntica al fixture `volt-colombia-tarifa-base.json`.
 * Los precios por kWh son valores de ejemplo que el dueño reemplaza en el back-office; la gracia de
 * 15 minutos y los 1.500 COP por minuto de ocupación (90.000 por hora) son los acordados.
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
      text: 'Energía por kWh según franja horaria. Tras terminar la carga: 15 minutos de gracia y luego 1.500 COP por minuto de ocupación. Precios con IVA incluido según configuración del tenant.',
    },
    {
      language: 'en',
      text: 'Energy per kWh by time of day. After charging ends: 15 minutes grace, then COP 1,500 per minute of occupancy.',
    },
  ],
  elements: [
    {
      price_components: [{ type: 'ENERGY', price: '1600', vat: '19', step_size: 1 }],
      restrictions: { start_time: '22:00', end_time: '06:00' },
    },
    {
      price_components: [{ type: 'ENERGY', price: '2200', vat: '19', step_size: 1 }],
      restrictions: { start_time: '17:00', end_time: '22:00' },
    },
    { price_components: [{ type: 'ENERGY', price: '1900', vat: '19', step_size: 1 }] },
    {
      price_components: [{ type: 'PARKING_TIME', price: '90000', vat: '19', step_size: 60 }],
      x_volt: { grace_period_s: 900, idle_start: 'EARLIEST', max_idle_s: 14400 },
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
