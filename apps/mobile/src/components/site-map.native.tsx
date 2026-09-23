/** Mapa de sedes (iOS y Android) con react-native-maps: color por disponibilidad, siempre con texto. */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { colors } from '../theme/tokens.ts';
import type { SiteMapProps } from './site-map.types.ts';

const BOGOTA = { latitude: 4.6534, longitude: -74.0836, latitudeDelta: 0.25, longitudeDelta: 0.25 };

export function SiteMap({ locations, onSelect }: SiteMapProps) {
  const region = useMemo(() => {
    if (locations.length === 0) return BOGOTA;
    const lats = locations.map((l) => l.latitude);
    const lons = locations.map((l) => l.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: Math.max(0.05, (maxLat - minLat) * 1.6),
      longitudeDelta: Math.max(0.05, (maxLon - minLon) * 1.6),
    };
  }, [locations]);
  return (
    <View style={styles.container}>
      <MapView style={StyleSheet.absoluteFill} initialRegion={region} userInterfaceStyle="dark">
        {locations.map((location) => {
          const available = location.evses.filter((e) => e.status === 'Available').length;
          return (
            <Marker
              key={location.id}
              coordinate={{ latitude: location.latitude, longitude: location.longitude }}
              title={location.name}
              description={`${available}/${location.evses.length}`}
              pinColor={available > 0 ? colors.success : colors.textSecondary}
              onCalloutPress={() => onSelect(location)}
            />
          );
        })}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 320, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface },
});
