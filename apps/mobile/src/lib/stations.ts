/**
 * Lógica pura de estaciones para el mapa y las listas (sin React): disponibilidad, cercanía,
 * conectores agrupados, filtros y etiquetas. Probada en stations.test.ts.
 */
import type { Location, LocationEvse } from '../api/types.ts';
import { distanceKm, formatStandard } from './format.ts';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface Availability {
  available: number;
  total: number;
  /** Potencia máxima que puede recibir un vehículo (kW): la del gabinete si se conoce. */
  maxPowerKw: number | null;
  /** Algún cargador reparte su potencia entre conectores (ADR 0026). */
  shared: boolean;
  /** Ningún conector reporta estado en vivo. */
  noData: boolean;
  /** Todos los conectores conocidos están fuera de servicio. */
  allOut: boolean;
}

const OUT = new Set(['Unavailable', 'Faulted']);
const LIVE = new Set([
  'Available',
  'Preparing',
  'Charging',
  'SuspendedEV',
  'SuspendedEVSE',
  'Finishing',
  'Reserved',
  'Occupied',
  'Unavailable',
  'Faulted',
]);

export function availability(evses: readonly LocationEvse[]): Availability {
  const powers = evses
    .map((e) => e.chargerMaxPowerKw ?? e.maxPowerKw)
    .filter((p): p is number => p !== null);
  const known = evses.filter((e) => LIVE.has(e.status));
  return {
    available: evses.filter((e) => e.status === 'Available').length,
    total: evses.length,
    maxPowerKw: powers.length ? Math.max(...powers) : null,
    shared: evses.some((e) => e.powerShared === true),
    noData: evses.length > 0 && known.length === 0,
    allOut: known.length > 0 && known.every((e) => OUT.has(e.status)),
  };
}

/** Grupos de conectores por tipo: `CCS2 · 4`, `Tipo 2 · 2`. */
export function connectorGroups(
  evses: readonly LocationEvse[],
  locale: 'es' | 'en' = 'es',
): { standard: string; label: string; count: number }[] {
  const groups = new Map<string, number>();
  for (const evse of evses) groups.set(evse.standard, (groups.get(evse.standard) ?? 0) + 1);
  return [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([standard, count]) => ({ standard, label: formatStandard(standard, locale), count }));
}

export interface StationFilters {
  availableNow: boolean;
  /** Estándares OCPI seleccionados; vacío = todos. */
  standards: string[];
  /** Potencia mínima en kW; 0 = cualquiera. */
  minPowerKw: number;
  /** Texto libre sobre nombre, dirección y ciudad. */
  query: string;
}

export const NO_FILTERS: StationFilters = {
  availableNow: false,
  standards: [],
  minPowerKw: 0,
  query: '',
};

export function activeFilterCount(filters: StationFilters): number {
  return (
    (filters.availableNow ? 1 : 0) +
    (filters.standards.length ? 1 : 0) +
    (filters.minPowerKw > 0 ? 1 : 0)
  );
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Estaciones que cumplen los filtros; un conector basta para que la estación cuente. */
export function filterStations(
  locations: readonly Location[],
  filters: StationFilters,
): Location[] {
  const query = normalize(filters.query.trim());
  return locations.filter((location) => {
    if (query) {
      const haystack = normalize(
        [location.name, location.address ?? '', location.city ?? ''].join(' '),
      );
      if (!haystack.includes(query)) return false;
    }
    const matching = location.evses.filter(
      (evse) =>
        (!filters.availableNow || evse.status === 'Available') &&
        (filters.standards.length === 0 || filters.standards.includes(evse.standard)) &&
        (filters.minPowerKw <= 0 ||
          (evse.chargerMaxPowerKw ?? evse.maxPowerKw ?? 0) >= filters.minPowerKw),
    );
    return matching.length > 0;
  });
}

export interface StationWithDistance {
  location: Location;
  distanceKm: number | null;
}

/** Ordena por distancia al usuario (las sin distancia al final) y por nombre. */
export function sortByDistance(
  locations: readonly Location[],
  from: Coordinates | null,
): StationWithDistance[] {
  return locations
    .map((location) => ({
      location,
      distanceKm: from ? distanceKm(from, location) : null,
    }))
    .sort((a, b) => {
      if (a.distanceKm === null && b.distanceKm === null)
        return a.location.name.localeCompare(b.location.name);
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });
}

/** Tiempo estimado en carro a velocidad urbana media (25 km/h), en minutos. */
export function driveMinutes(km: number): number {
  return Math.max(1, Math.round((km / 25) * 60));
}

/** Dentro de 150 m se considera que el conductor está en la estación (geocerca del handoff). */
export const ON_SITE_KM = 0.15;

export function isOnSite(distance: number | null): boolean {
  return distance !== null && distance <= ON_SITE_KM;
}

/** Número corto del cargador dentro de la estación (`01`, `02`…) según el orden de la lista. */
export function chargerNumber(index: number): string {
  return String(index + 1).padStart(2, '0');
}

/** URL para abrir la navegación hacia la estación en la app de mapas del sistema. */
export function directionsUrl(
  location: Coordinates,
  platform: 'ios' | 'android' | 'web' | string,
): string {
  const destination = `${location.latitude},${location.longitude}`;
  if (platform === 'ios') return `maps://?daddr=${destination}&dirflg=d`;
  if (platform === 'android') return `google.navigation:q=${destination}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

/** Ancho de página en el que el mapa pasa a mostrar la lista completa (tabletas y escritorio). */
export const OPENING_ALWAYS = 'twentyfourseven';

export function isOpen24h(openingHours: unknown): boolean {
  return Boolean(
    openingHours &&
      typeof openingHours === 'object' &&
      (openingHours as Record<string, unknown>)[OPENING_ALWAYS],
  );
}
