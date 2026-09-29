/**
 * Mapa de estaciones en el navegador con Maps JavaScript API (iteración 9): color por
 * disponibilidad con el número de conectores libres siempre visible; al tocar una estación se
 * abre su lista. Sin clave configurada se muestra la indicación y la lista hace el trabajo.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '../auth/auth.tsx';
import { useI18n } from '../i18n/index.tsx';
import { circleIcon, loadGoogleMaps } from '../lib/google-maps.ts';
import { colors } from '../theme/tokens.ts';
import { Notice } from '../theme/ui.tsx';
import type { SiteMapProps } from './site-map.types.ts';

/** Centro por defecto: área metropolitana de Medellín, donde opera VOLT. */
const MEDELLIN = { lat: 6.2442, lng: -75.5812 };

export function SiteMap({ locations, onSelect, webHint }: SiteMapProps) {
  const auth = useAuth();
  const { locale } = useI18n();
  const apiKey = auth.config?.maps.browserKey ?? '';
  const container = useRef<View>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markers = useRef<google.maps.Marker[]>([]);
  const [lib, setLib] = useState<typeof google.maps | null>(null);
  const [failed, setFailed] = useState(false);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    void loadGoogleMaps(apiKey, locale)
      .then(async (maps) => {
        const element = container.current as unknown as HTMLElement | null;
        if (cancelled || !element) return;
        const { Map: GoogleMap } = (await maps.importLibrary('maps')) as google.maps.MapsLibrary;
        await maps.importLibrary('marker');
        if (cancelled) return;
        map.current = new GoogleMap(element, {
          center: MEDELLIN,
          zoom: 11,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          colorScheme: 'DARK',
        });
        setLib(maps);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      map.current = null;
    };
  }, [apiKey, locale]);

  useEffect(() => {
    if (!lib || !map.current) return;
    for (const marker of markers.current) marker.setMap(null);
    markers.current = [];
    const bounds = new lib.LatLngBounds();
    for (const location of locations) {
      const available = location.evses.filter((e) => e.status === 'Available').length;
      const position = { lat: location.latitude, lng: location.longitude };
      const marker = new lib.Marker({
        map: map.current,
        position,
        title: location.name,
        icon: {
          url: circleIcon(available > 0 ? colors.success : colors.textSecondary, String(available)),
          scaledSize: new lib.Size(32, 32),
          anchor: new lib.Point(16, 16),
        },
      });
      marker.addListener('click', () => selectRef.current(location));
      markers.current.push(marker);
      bounds.extend(position);
    }
    if (locations.length === 1) {
      map.current.setCenter(bounds.getCenter());
      map.current.setZoom(14);
    } else if (locations.length > 1) {
      map.current.fitBounds(bounds, 40);
    }
  }, [locations, lib]);

  if (!apiKey || failed) return <Notice tone="info">{webHint}</Notice>;
  return (
    <View
      ref={container}
      style={{ height: 320, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface }}
    />
  );
}
