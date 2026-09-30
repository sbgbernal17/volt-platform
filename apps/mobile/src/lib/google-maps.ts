/**
 * Carga única de Maps JavaScript API en la versión web de la app (iteración 9, ADR 0024). La clave
 * de navegador llega en `GET /v1/config` (`maps.browserKey`): es pública por diseño, restringida
 * por referrer y solo a esa API. Solo lo importa `site-map.web.tsx`; en iOS y Android el mapa es
 * nativo (react-native-maps).
 */
const CALLBACK = '__voltGoogleMapsReady';

let loading: Promise<typeof google.maps> | null = null;
let authFailed = false;

export function loadGoogleMaps(apiKey: string, language = 'es'): Promise<typeof google.maps> {
  if (!apiKey) return Promise.reject(new Error('sin clave de Google Maps'));
  if (authFailed) return Promise.reject(new Error('clave de Google Maps rechazada'));
  if (typeof google !== 'undefined' && google.maps !== undefined) {
    return Promise.resolve(google.maps);
  }
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const scope = globalThis as unknown as Record<string, (() => void) | undefined>;
    scope.gm_authFailure = () => {
      authFailed = true;
      loading = null;
      reject(new Error('clave de Google Maps rechazada'));
    };
    scope[CALLBACK] = () => {
      delete scope[CALLBACK];
      resolve(google.maps);
    };
    const params = new URLSearchParams({
      key: apiKey,
      v: 'weekly',
      loading: 'async',
      callback: CALLBACK,
      language,
      region: 'CO',
    });
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('no se pudo cargar Google Maps'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Ícono SVG (círculo con borde y texto) como URL de datos, sin imágenes externas. */
export function circleIcon(fill: string, label: string, size = 32): string {
  const half = size / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<circle cx="${half}" cy="${half}" r="${half - 2}" fill="${fill}" stroke="#ffffff" stroke-width="2"/>
<text x="${half}" y="${half + 4}" text-anchor="middle" font-family="Roboto, Arial, sans-serif" font-size="12" font-weight="700" fill="#ffffff">${label}</text>
</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * Marcador píldora del handoff (MapMarker) como SVG en URL de datos: círculo con el glifo del estado
 * a la izquierda y "libres/total" a la derecha; seleccionado: fondo rojo VOLT, borde blanco y
 * potencia máxima. El glifo se dibuja con trazos (check, reloj, bloqueo, interrogación) para no
 * depender de fuentes de íconos dentro del SVG.
 */
export type MarkerVisual = 'available' | 'occupied' | 'out' | 'nodata';

const GLYPHS: Record<MarkerVisual, string> = {
  available:
    '<path d="M-4.5 0.5 L-1.5 3.5 L4.5 -3" fill="none" stroke="%s" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  occupied:
    '<circle r="5.5" fill="none" stroke="%s" stroke-width="1.8"/><path d="M0 -3 V0.5 L2.5 2" fill="none" stroke="%s" stroke-width="1.8" stroke-linecap="round"/>',
  out: '<circle r="5.5" fill="none" stroke="%s" stroke-width="1.8"/><path d="M-4 -4 L4 4" stroke="%s" stroke-width="1.8" stroke-linecap="round"/>',
  nodata:
    '<path d="M-2.5 -2 A2.5 2.5 0 1 1 0.5 0.8 L0 2" fill="none" stroke="%s" stroke-width="1.8" stroke-linecap="round"/><circle cy="4.5" r="1" fill="%s"/>',
};

const VISUAL_COLORS: Record<MarkerVisual, { glyph: string; soft: string }> = {
  available: { glyph: '#22C55E', soft: '#193123' },
  occupied: { glyph: '#F59E0B', soft: '#33260F' },
  out: { glyph: '#9CA3AF', soft: '#262626' },
  nodata: { glyph: '#9CA3AF', soft: '#262626' },
};

export interface PillIcon {
  url: string;
  width: number;
  height: number;
}

export function pillIcon(
  visual: MarkerVisual,
  label: string,
  selected = false,
  detail?: string,
): PillIcon {
  const height = selected ? 44 : 34;
  const circle = selected ? 32 : 26;
  const fontSize = selected ? 15 : 13;
  const textValue = selected && detail ? `${detail} · ${label}` : label;
  const textWidth = Math.round(textValue.length * fontSize * 0.62) + 6;
  const width = 4 + circle + 6 + textWidth + 10;
  const palette = VISUAL_COLORS[visual];
  const glyphColor = selected ? palette.glyph : palette.glyph;
  const glyph = GLYPHS[visual].split('%s').join(glyphColor);
  const bg = selected ? '#EF4136' : '#0B0B0B';
  const border = selected ? '#FFFFFF' : '#525252';
  const circleFill = selected ? '#FFFFFF' : palette.soft;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${(height - 2) / 2}" fill="${bg}" stroke="${border}" stroke-width="${selected ? 2 : 1}"/>
<circle cx="${4 + circle / 2}" cy="${height / 2}" r="${circle / 2}" fill="${circleFill}"/>
<g transform="translate(${4 + circle / 2} ${height / 2})">${glyph}</g>
<text x="${4 + circle + 6}" y="${height / 2 + fontSize * 0.36}" font-family="Roboto, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#FFFFFF">${escapeXml(textValue)}</text>
</svg>`;
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, width, height };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Estilo oscuro y desaturado del mapa (handoff): sin puntos de interés de otras marcas. */
export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0e0e0f' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8f' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0e0e0f' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0f1711' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1b1b1c' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#2a2a2b' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2a2a2b' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0c1620' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#2a2a2b' }],
  },
];
