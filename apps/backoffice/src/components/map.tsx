/**
 * Mapas del back-office con Maps JavaScript API (iteración 9, ADR 0024): sedes con estado en vivo
 * (color por estado y texto siempre presente), un marcador por sede y un selector de coordenadas
 * para el alta de sedes. Sin clave configurada se muestra un aviso y la lista hace el trabajo.
 */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { runtimeConfig } from '../lib/config.ts';
import {
  circleIcon,
  GoogleMapsError,
  loadGoogleMaps,
  type MapsLibrary,
} from '../lib/google-maps.ts';

export interface MapSite {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Cargadores conectados / total y conectores por estado, para el color y el rótulo. */
  online: number;
  total: number;
  charging: number;
  faulted: number;
}

/** Colores de estado del manual de marca (verde disponible, ámbar operativo, rojo profundo, gris). */
const COLORS = { ok: '#15803d', warn: '#b45309', bad: '#991b1b', none: '#6b7a74' };
/** Centro por defecto: área metropolitana de Medellín, donde opera VOLT. */
const DEFAULT_CENTER = { lat: 6.2442, lng: -75.5812 };
const DEFAULT_ZOOM = 11;

export function colorFor(site: MapSite): string {
  if (site.total === 0) return COLORS.none;
  if (site.faulted > 0 || site.online === 0) return COLORS.bad;
  if (site.online < site.total) return COLORS.warn;
  return COLORS.ok;
}

type MapStatus = 'loading' | 'ready' | 'no-key' | 'auth' | 'network';

/** Carga la biblioteca una vez y crea el mapa sobre el contenedor. */
function useGoogleMap(options: {
  center?: { lat: number; lng: number } | undefined;
  zoom?: number | undefined;
}) {
  const { locale } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const [status, setStatus] = useState<MapStatus>('loading');
  const [lib, setLib] = useState<MapsLibrary | null>(null);
  const initialCenter = useRef(options.center ?? DEFAULT_CENTER);
  const initialZoom = useRef(options.zoom ?? DEFAULT_ZOOM);

  useEffect(() => {
    const key = runtimeConfig().googleMapsApiKey;
    if (!key) {
      setStatus('no-key');
      return;
    }
    let cancelled = false;
    void loadGoogleMaps(key, locale)
      .then(async (maps) => {
        if (cancelled || !container.current) return;
        const { Map: GoogleMap } = (await maps.importLibrary('maps')) as google.maps.MapsLibrary;
        await maps.importLibrary('marker');
        if (cancelled || !container.current) return;
        map.current = new GoogleMap(container.current, {
          center: initialCenter.current,
          zoom: initialZoom.current,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          styles: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }],
        });
        setLib(maps);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus(error instanceof GoogleMapsError ? error.reason : 'network');
      });
    return () => {
      cancelled = true;
      map.current = null;
    };
  }, [locale]);

  return { container, map, lib, status };
}

function MapNotice({ status }: { status: Exclude<MapStatus, 'ready'> }) {
  const { t } = useI18n();
  const key = {
    loading: 'map.loading',
    'no-key': 'map.noKey',
    auth: 'map.authFailure',
    network: 'map.network',
  } as const;
  return (
    <div className="map-notice">
      <p className={status === 'loading' ? 'muted' : ''}>{t(key[status])}</p>
    </div>
  );
}

/** Mapa de sedes con marcadores por estado y tarjeta al hacer clic (con enlace a la sede). */
export function SitesMap({
  sites,
  onSelect,
}: {
  sites: MapSite[];
  onSelect?: ((id: string) => void) | undefined;
}) {
  const { t } = useI18n();
  const { container, map, lib, status } = useGoogleMap({});
  const markers = useRef<google.maps.Marker[]>([]);
  const info = useRef<google.maps.InfoWindow | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const openLabel = t('map.open');

  useEffect(() => {
    if (!lib || !map.current) return;
    for (const marker of markers.current) marker.setMap(null);
    markers.current = [];
    info.current ??= new lib.InfoWindow();
    const bounds = new lib.LatLngBounds();
    let count = 0;
    for (const site of sites) {
      if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) continue;
      const position = { lat: site.latitude, lng: site.longitude };
      const marker = new lib.Marker({
        map: map.current,
        position,
        title: site.name,
        icon: {
          url: circleIcon(colorFor(site), `${site.online}/${site.total}`, 34),
          scaledSize: new lib.Size(34, 34),
          anchor: new lib.Point(17, 17),
        },
      });
      marker.addListener('click', () => {
        const content = document.createElement('div');
        content.className = 'map-card';
        const title = document.createElement('strong');
        title.textContent = site.name;
        const detail = document.createElement('div');
        detail.textContent = `${site.online}/${site.total} · ${site.charging} ⚡${site.faulted ? ` · ${site.faulted} ⚠` : ''}`;
        content.append(title, detail);
        if (selectRef.current) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'small primary';
          button.textContent = openLabel;
          button.addEventListener('click', () => selectRef.current?.(site.id));
          content.append(button);
        }
        info.current?.setContent(content);
        info.current?.open({ map: map.current, anchor: marker });
      });
      markers.current.push(marker);
      bounds.extend(position);
      count += 1;
    }
    if (count === 1) {
      map.current.setCenter(bounds.getCenter());
      map.current.setZoom(14);
    } else if (count > 1) {
      map.current.fitBounds(bounds, 48);
    }
  }, [sites, lib, map, openLabel]);

  return (
    <div className="map">
      <div ref={container} className="map-canvas" />
      {status !== 'ready' ? <MapNotice status={status} /> : null}
    </div>
  );
}

/** Mapa de una sola sede (detalle). */
export function SiteMarkerMap({
  latitude,
  longitude,
  name,
}: {
  latitude: number;
  longitude: number;
  name: string;
}) {
  const valid = Number.isFinite(latitude) && Number.isFinite(longitude);
  const { container, map, lib, status } = useGoogleMap({
    center: valid ? { lat: latitude, lng: longitude } : undefined,
    zoom: valid ? 15 : undefined,
  });
  useEffect(() => {
    if (!lib || !map.current || !valid) return;
    const marker = new lib.Marker({
      map: map.current,
      position: { lat: latitude, lng: longitude },
      title: name,
      icon: {
        url: circleIcon('#dc2626', '', 26),
        scaledSize: new lib.Size(26, 26),
        anchor: new lib.Point(13, 13),
      },
    });
    map.current.setCenter({ lat: latitude, lng: longitude });
    return () => marker.setMap(null);
  }, [lib, map, latitude, longitude, name, valid]);
  return (
    <div className="map compact">
      <div ref={container} className="map-canvas" />
      {status !== 'ready' ? <MapNotice status={status} /> : null}
    </div>
  );
}

/** Selector de coordenadas: clic en el mapa fija el marcador y devuelve latitud y longitud. */
export function CoordinatePicker({
  latitude,
  longitude,
  onChange,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (coordinates: { latitude: number; longitude: number }) => void;
}) {
  const { t } = useI18n();
  const valid = latitude !== null && longitude !== null;
  const { container, map, lib, status } = useGoogleMap({
    center: valid ? { lat: latitude, lng: longitude } : undefined,
    zoom: valid ? 15 : undefined,
  });
  const marker = useRef<google.maps.Marker | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    if (!lib || !map.current) return;
    marker.current ??= new lib.Marker({
      map: map.current,
      draggable: true,
      icon: {
        url: circleIcon('#dc2626', '', 26),
        scaledSize: new lib.Size(26, 26),
        anchor: new lib.Point(13, 13),
      },
    });
    const emit = (position: google.maps.LatLng | null | undefined) => {
      if (!position) return;
      changeRef.current({
        latitude: Number(position.lat().toFixed(6)),
        longitude: Number(position.lng().toFixed(6)),
      });
    };
    const clickListener = map.current.addListener('click', (event: google.maps.MapMouseEvent) => {
      marker.current?.setPosition(event.latLng);
      emit(event.latLng);
    });
    const dragListener = marker.current.addListener('dragend', () =>
      emit(marker.current?.getPosition()),
    );
    return () => {
      clickListener.remove();
      dragListener.remove();
    };
  }, [lib, map]);

  useEffect(() => {
    if (!marker.current || !map.current) return;
    if (!valid) {
      marker.current.setMap(null);
      return;
    }
    marker.current.setMap(map.current);
    marker.current.setPosition({ lat: latitude, lng: longitude });
    map.current.panTo({ lat: latitude, lng: longitude });
  }, [latitude, longitude, valid, map]);

  return (
    <div>
      <div className="map compact">
        <div ref={container} className="map-canvas" />
        {status !== 'ready' ? <MapNotice status={status} /> : null}
      </div>
      <div className="help">{t('map.pickHelp')}</div>
    </div>
  );
}
