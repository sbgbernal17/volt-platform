/**
 * Mapa de estaciones en el navegador con Maps JavaScript API (ADR 0024): estilo oscuro del
 * handoff, marcadores píldora como SVG y punto azul del conductor. Sin clave configurada se
 * muestra la indicación y la lista hace el trabajo.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '../auth/auth.tsx';
import { useI18n } from '../i18n/index.tsx';
import { formatKw } from '../lib/format.ts';
import { DARK_MAP_STYLE, loadGoogleMaps, pillIcon } from '../lib/google-maps.ts';
import { availability } from '../lib/stations.ts';
import { colors } from '../theme/tokens.ts';
import { Notice } from '../theme/ui.tsx';
import type { SiteMapProps } from './site-map.types.ts';

/** Centro por defecto: área metropolitana de Medellín, donde opera VOLT. */
const MEDELLIN = { lat: 6.2442, lng: -75.5812 };

const USER_DOT = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56"><circle cx="28" cy="28" r="28" fill="rgba(59,130,246,0.18)"/><circle cx="28" cy="28" r="9" fill="#3B82F6" stroke="#FFFFFF" stroke-width="3"/></svg>`,
)}`;

export function SiteMap({
  locations,
  selectedId,
  onSelect,
  onDeselect,
  user,
  focus,
  webHint,
}: SiteMapProps) {
  const auth = useAuth();
  const { locale } = useI18n();
  const apiKey = auth.config?.maps.browserKey ?? '';
  const container = useRef<View>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markers = useRef<google.maps.Marker[]>([]);
  const userMarker = useRef<google.maps.Marker | null>(null);
  const [lib, setLib] = useState<typeof google.maps | null>(null);
  const [failed, setFailed] = useState(false);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const deselectRef = useRef(onDeselect);
  deselectRef.current = onDeselect;
  const fitted = useRef(false);

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
          zoom: 12,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          styles: DARK_MAP_STYLE as google.maps.MapTypeStyle[],
          backgroundColor: colors.map.bg,
        });
        map.current.addListener('click', () => deselectRef.current());
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
      const summary = availability(location.evses);
      const visual = summary.noData
        ? 'nodata'
        : summary.allOut
          ? 'out'
          : summary.available > 0
            ? 'available'
            : 'occupied';
      const selected = location.id === selectedId;
      const icon = pillIcon(
        visual,
        summary.noData ? '—' : `${summary.available}/${summary.total}`,
        selected,
        selected && summary.maxPowerKw ? formatKw(summary.maxPowerKw) : undefined,
      );
      const position = { lat: location.latitude, lng: location.longitude };
      const marker = new lib.Marker({
        map: map.current,
        position,
        title: `${location.name} · ${summary.available}/${summary.total}`,
        zIndex: selected ? 10 : 1,
        icon: {
          url: icon.url,
          scaledSize: new lib.Size(icon.width, icon.height),
          anchor: new lib.Point(icon.width / 2, icon.height / 2),
        },
      });
      marker.addListener('click', () => selectRef.current(location));
      markers.current.push(marker);
      bounds.extend(position);
    }
    if (!fitted.current && locations.length > 0) {
      fitted.current = true;
      if (locations.length === 1) {
        map.current.setCenter(bounds.getCenter());
        map.current.setZoom(14);
      } else {
        map.current.fitBounds(bounds, 60);
      }
    }
  }, [locations, lib, selectedId]);

  useEffect(() => {
    if (!lib || !map.current) return;
    if (!user) {
      userMarker.current?.setMap(null);
      userMarker.current = null;
      return;
    }
    const position = { lat: user.latitude, lng: user.longitude };
    if (userMarker.current) userMarker.current.setPosition(position);
    else
      userMarker.current = new lib.Marker({
        map: map.current,
        position,
        clickable: false,
        zIndex: 0,
        icon: { url: USER_DOT, scaledSize: new lib.Size(56, 56), anchor: new lib.Point(28, 28) },
      });
  }, [user, lib]);

  useEffect(() => {
    if (!lib || !map.current || !focus) return;
    map.current.panTo({ lat: focus.coords.latitude, lng: focus.coords.longitude });
    map.current.setZoom(focus.zoom === 'near' ? 15 : 12);
  }, [focus, lib]);

  if (!apiKey || failed) return <Notice tone="info">{webHint}</Notice>;
  return <View ref={container} style={{ flex: 1, backgroundColor: colors.map.bg }} />;
}
