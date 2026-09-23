import L from 'leaflet';
import { useEffect, useRef } from 'react';

export interface MapSite {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Cargadores conectados / total y conectores por estado, para el color y el tooltip. */
  online: number;
  total: number;
  charging: number;
  faulted: number;
}

const COLORS = { ok: '#0b7a5d', warn: '#b54708', bad: '#b42318', none: '#6b7a74' };

function colorFor(site: MapSite): string {
  if (site.total === 0) return COLORS.none;
  if (site.faulted > 0 || site.online === 0) return COLORS.bad;
  if (site.online < site.total) return COLORS.warn;
  return COLORS.ok;
}

/** Mapa de sedes con OpenStreetMap y marcadores circulares (sin imágenes externas). */
export function SitesMap({
  sites,
  onSelect,
}: {
  sites: MapSite[];
  onSelect?: ((id: string) => void) | undefined;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!container.current || map.current) return;
    map.current = L.map(container.current, {
      zoomControl: true,
      fadeAnimation: false,
      zoomAnimation: false,
    }).setView([4.65, -74.1], 11, { animate: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const points: L.LatLngExpression[] = [];
    for (const site of sites) {
      if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) continue;
      const marker = L.circleMarker([site.latitude, site.longitude], {
        radius: 10,
        color: '#ffffff',
        weight: 2,
        fillColor: colorFor(site),
        fillOpacity: 0.95,
      });
      marker.bindTooltip(
        `<strong>${site.name}</strong><br/>${site.online}/${site.total} · ${site.charging} ⚡${site.faulted ? ` · ${site.faulted} ⚠` : ''}`,
      );
      if (onSelect) marker.on('click', () => onSelect(site.id));
      marker.addTo(layer.current);
      points.push([site.latitude, site.longitude]);
    }
    if (points.length > 0) {
      map.current.fitBounds(L.latLngBounds(points).pad(0.3), { maxZoom: 14, animate: false });
    }
  }, [sites, onSelect]);

  return <div ref={container} className="map" />;
}
