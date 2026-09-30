import { describe, expect, it } from 'vitest';
import type { Location, LocationEvse } from '../api/types.ts';
import {
  activeFilterCount,
  availability,
  chargerNumber,
  connectorGroups,
  directionsUrl,
  driveMinutes,
  filterStations,
  isOnSite,
  isOpen24h,
  NO_FILTERS,
  sortByDistance,
} from './stations.ts';

const evse = (overrides: Partial<LocationEvse>): LocationEvse => ({
  evseId: 'VOLT-X-1',
  chargeBoxId: 'VOLT-X',
  connectorId: 1,
  standard: 'IEC_62196_T2_COMBO',
  powerType: 'DC',
  maxPowerKw: 180,
  chargerMaxPowerKw: null,
  powerShared: false,
  status: 'Available',
  ...overrides,
});

const station = (name: string, lat: number, lon: number, evses: LocationEvse[]): Location => ({
  id: name,
  code: name,
  name,
  address: null,
  city: 'Medellín',
  latitude: lat,
  longitude: lon,
  timezone: 'America/Bogota',
  accessType: 'PUBLIC',
  openingHours: { twentyfourseven: true },
  evses,
});

describe('estaciones', () => {
  it('resume disponibilidad, potencia máxima y falta de datos', () => {
    const summary = availability([
      evse({ status: 'Available', maxPowerKw: 180 }),
      evse({ status: 'Charging', maxPowerKw: 60 }),
      evse({ status: 'Unavailable', maxPowerKw: null }),
    ]);
    expect(summary).toEqual({
      available: 1,
      total: 3,
      maxPowerKw: 180,
      shared: false,
      noData: false,
      allOut: false,
    });
    expect(availability([evse({ status: 'Unknown' })]).noData).toBe(true);
    expect(
      availability([evse({ status: 'Faulted' }), evse({ status: 'Unavailable' })]).allOut,
    ).toBe(true);
  });

  it('agrupa conectores por tipo con etiqueta comercial', () => {
    const groups = connectorGroups([
      evse({ standard: 'IEC_62196_T2_COMBO' }),
      evse({ standard: 'IEC_62196_T2_COMBO' }),
      evse({ standard: 'IEC_62196_T2' }),
    ]);
    expect(groups).toEqual([
      { standard: 'IEC_62196_T2_COMBO', label: 'CCS2', count: 2 },
      { standard: 'IEC_62196_T2', label: 'Tipo 2', count: 1 },
    ]);
  });

  it('filtra por disponibilidad, conector, potencia y texto sin tildes', () => {
    const a = station('VOLT El Poblado', 6.2, -75.57, [
      evse({ status: 'Charging' }),
      evse({ status: 'Available', standard: 'IEC_62196_T2', maxPowerKw: 22 }),
    ]);
    const b = station('VOLT Itagüí', 6.17, -75.61, [
      evse({ status: 'Available', maxPowerKw: 180 }),
    ]);
    expect(filterStations([a, b], NO_FILTERS)).toHaveLength(2);
    expect(
      filterStations([a, b], { ...NO_FILTERS, availableNow: true, minPowerKw: 100 }).map(
        (s) => s.name,
      ),
    ).toEqual(['VOLT Itagüí']);
    expect(
      filterStations([a, b], { ...NO_FILTERS, standards: ['IEC_62196_T2'] }).map((s) => s.name),
    ).toEqual(['VOLT El Poblado']);
    expect(filterStations([a, b], { ...NO_FILTERS, query: 'itagui' }).map((s) => s.name)).toEqual([
      'VOLT Itagüí',
    ]);
    expect(activeFilterCount({ ...NO_FILTERS, availableNow: true, minPowerKw: 50 })).toBe(2);
  });

  it('ordena por distancia y detecta la estación en sitio', () => {
    const near = station('Cerca', 6.2442, -75.5812, []);
    const far = station('Lejos', 6.3, -75.5, []);
    const sorted = sortByDistance([far, near], { latitude: 6.2442, longitude: -75.5812 });
    expect(sorted.map((s) => s.location.name)).toEqual(['Cerca', 'Lejos']);
    expect(isOnSite(sorted[0]?.distanceKm ?? null)).toBe(true);
    expect(isOnSite(sorted[1]?.distanceKm ?? null)).toBe(false);
    expect(sortByDistance([far, near], null).every((s) => s.distanceKm === null)).toBe(true);
    expect(driveMinutes(2.4)).toBe(6);
  });

  it('numera cargadores, arma la URL de navegación y lee el horario', () => {
    expect(chargerNumber(0)).toBe('01');
    expect(directionsUrl({ latitude: 6.2, longitude: -75.5 }, 'web')).toContain(
      'destination=6.2,-75.5',
    );
    expect(directionsUrl({ latitude: 6.2, longitude: -75.5 }, 'android')).toBe(
      'google.navigation:q=6.2,-75.5',
    );
    expect(isOpen24h({ twentyfourseven: true })).toBe(true);
    expect(isOpen24h(null)).toBe(false);
  });
});

describe('potencia por gabinete (ADR 0026)', () => {
  it('la disponibilidad usa la potencia del gabinete y marca el reparto', () => {
    const summary = availability([
      evse({ maxPowerKw: 90, chargerMaxPowerKw: 180, powerShared: true }),
      evse({ evseId: 'VOLT-X-2', maxPowerKw: 90, chargerMaxPowerKw: 180, powerShared: true }),
    ]);
    expect(summary.maxPowerKw).toBe(180);
    expect(summary.shared).toBe(true);
    expect(availability([evse({})]).shared).toBe(false);
  });

  it('el filtro de potencia mínima considera el gabinete', () => {
    const shared = station('S', 6.2, -75.5, [
      evse({ maxPowerKw: 90, chargerMaxPowerKw: 180, powerShared: true }),
    ]);
    expect(filterStations([shared], { ...NO_FILTERS, minPowerKw: 150 })).toHaveLength(1);
    expect(
      filterStations([station('T', 6.2, -75.5, [evse({ maxPowerKw: 90 })])], {
        ...NO_FILTERS,
        minPowerKw: 150,
      }),
    ).toHaveLength(0);
  });
});
