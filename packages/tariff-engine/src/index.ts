/**
 * Motor de tarifas de Volt: modelo OCPI 2.2.1 con extensiones `x_volt`, cálculo determinista de
 * costos (TAR §7) y utilidades de tiempo local. El paquete es puro: no accede a base de datos.
 */
export { VOLT_BASE_POLICY, VOLT_BASE_TARIFF } from './base-tariff.ts';
export {
  activeComponent,
  canonicalizeEvents,
  canonicalJson,
  compute,
  DEFAULT_WARN_PCT,
  dimensionOrder,
  ENGINE_VERSION,
  sha256Hex,
  TariffEngineError,
} from './engine.ts';
export type { LocalParts } from './time.ts';
export { localParts, localTimeOnDate, localToUtcMs, nextDateKey, parseHhmm } from './time.ts';
export type * from './types.ts';
