/**
 * Mapa de estaciones en iOS y Android (react-native-maps) con el estilo oscuro del handoff,
 * marcadores píldora (libres/total; seleccionado con potencia máxima) y punto azul del conductor.
 */
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { formatKw } from '../lib/format.ts';
import { DARK_MAP_STYLE } from '../lib/google-maps.ts';
import { availability } from '../lib/stations.ts';
import { colors } from '../theme/tokens.ts';
import { MapPill } from './map-pill.tsx';
import type { SiteMapProps } from './site-map.types.ts';

/** Centro por defecto: área metropolitana de Medellín, donde opera VOLT. */
const MEDELLIN = { latitude: 6.2442, longitude: -75.5812, latitudeDelta: 0.2, longitudeDelta: 0.2 };

export function SiteMap({
  locations,
  selectedId,
  onSelect,
  onDeselect,
  user,
  focus,
}: SiteMapProps) {
  const map = useRef<MapView>(null);
  const region = useMemo(() => {
    if (locations.length === 0) return MEDELLIN;
    const lats = locations.map((l) => l.latitude);
    const lons = locations.map((l) => l.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: Math.max(0.04, (maxLat - minLat) * 1.8),
      longitudeDelta: Math.max(0.04, (maxLon - minLon) * 1.8),
    };
  }, [locations]);

  useEffect(() => {
    if (!focus) return;
    const delta = focus.zoom === 'near' ? 0.012 : 0.08;
    map.current?.animateToRegion(
      { ...focus.coords, latitudeDelta: delta, longitudeDelta: delta },
      300,
    );
  }, [focus]);

  return (
    <View style={styles.container}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        customMapStyle={DARK_MAP_STYLE}
        userInterfaceStyle="dark"
        showsUserLocation={user !== null}
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        showsCompass={false}
        toolbarEnabled={false}
        onPress={onDeselect}
      >
        {locations.map((location) => {
          const summary = availability(location.evses);
          const visual = summary.noData
            ? 'nodata'
            : summary.allOut
              ? 'out'
              : summary.available > 0
                ? 'available'
                : 'occupied';
          const selected = location.id === selectedId;
          return (
            <Marker
              key={`${location.id}-${selected ? 'sel' : 'std'}-${summary.available}`}
              coordinate={{ latitude: location.latitude, longitude: location.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              accessibilityLabel={`${location.name}, ${summary.available} de ${summary.total}`}
              onPress={(event) => {
                event.stopPropagation();
                onSelect(location);
              }}
            >
              <MapPill
                visual={visual}
                label={summary.noData ? '—' : `${summary.available}/${summary.total}`}
                selected={selected}
                detail={selected && summary.maxPowerKw ? formatKw(summary.maxPowerKw) : undefined}
              />
            </Marker>
          );
        })}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.map.bg },
});
