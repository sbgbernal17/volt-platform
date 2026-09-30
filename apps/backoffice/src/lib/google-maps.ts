/**
 * Carga única de Maps JavaScript API (iteración 9, ADR 0024) con la clave de navegador que llega
 * por `config.js`. La clave es pública por diseño: va restringida por referrer y solo a esa API.
 * Sin clave, los mapas muestran un aviso y las listas hacen el trabajo.
 */
export type MapsLibrary = typeof google.maps;

const CALLBACK = '__voltGoogleMapsReady';
const AUTH_FAILURE = 'gm_authFailure';

let loading: Promise<MapsLibrary> | null = null;
let authFailed = false;

export class GoogleMapsError extends Error {
  constructor(
    readonly reason: 'no-key' | 'auth' | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'GoogleMapsError';
  }
}

declare global {
  interface Window {
    [CALLBACK]?: () => void;
    [AUTH_FAILURE]?: () => void;
  }
}

/** Devuelve `google.maps` cargado (una sola inserción del script por página). */
export function loadGoogleMaps(apiKey: string, language = 'es'): Promise<MapsLibrary> {
  if (!apiKey) {
    return Promise.reject(new GoogleMapsError('no-key', 'Sin clave de Google Maps'));
  }
  if (authFailed) {
    return Promise.reject(new GoogleMapsError('auth', 'Clave de Google Maps rechazada'));
  }
  if (typeof google !== 'undefined' && google.maps !== undefined) {
    return Promise.resolve(google.maps);
  }
  if (loading) return loading;
  loading = new Promise<MapsLibrary>((resolve, reject) => {
    window[AUTH_FAILURE] = () => {
      authFailed = true;
      loading = null;
      reject(new GoogleMapsError('auth', 'Clave de Google Maps rechazada'));
    };
    window[CALLBACK] = () => {
      delete window[CALLBACK];
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
      reject(new GoogleMapsError('network', 'No se pudo cargar Google Maps'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Ícono SVG (círculo con borde blanco y texto) como URL de datos, sin imágenes externas. */
export function circleIcon(fill: string, label: string, size = 30): string {
  const half = size / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<circle cx="${half}" cy="${half}" r="${half - 2}" fill="${fill}" stroke="#ffffff" stroke-width="2"/>
<text x="${half}" y="${half + 4}" text-anchor="middle" font-family="Roboto, Arial, sans-serif" font-size="11" font-weight="700" fill="#ffffff">${label}</text>
</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * Marcadores (iteración 9, adición del 30-09): con Map ID (`googleMapsMapId`) se usan los marcadores
 * avanzados (`AdvancedMarkerElement`, estilos administrados en la nube); sin él, los clásicos. La
 * misma interfaz sirve para los dos, con el ícono centrado en la coordenada.
 */
export interface MarkerIcon {
  url: string;
  width: number;
  height: number;
}

export interface MarkerHandle {
  /** Ancla para `InfoWindow.open`. */
  readonly anchor: google.maps.Marker | google.maps.marker.AdvancedMarkerElement;
  setMap(map: google.maps.Map | null): void;
  remove(): void;
  setPosition(position: google.maps.LatLngLiteral): void;
  getPosition(): google.maps.LatLngLiteral | null;
  onClick(listener: () => void): void;
  onDragEnd(listener: (position: google.maps.LatLngLiteral | null) => void): void;
}

export interface CreateMarkerOptions {
  map: google.maps.Map;
  position?: google.maps.LatLngLiteral | undefined;
  title?: string | undefined;
  icon: MarkerIcon;
  zIndex?: number | undefined;
  draggable?: boolean | undefined;
  clickable?: boolean | undefined;
  /** Marcadores avanzados (requieren Map ID). */
  advanced: boolean;
}

export function toLatLngLiteral(
  position:
    | google.maps.LatLng
    | google.maps.LatLngLiteral
    | google.maps.LatLngAltitude
    | google.maps.LatLngAltitudeLiteral
    | null
    | undefined,
): google.maps.LatLngLiteral | null {
  if (!position) return null;
  const lat = typeof position.lat === 'function' ? position.lat() : position.lat;
  const lng = typeof position.lng === 'function' ? position.lng() : position.lng;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export function createMarker(maps: MapsLibrary, options: CreateMarkerOptions): MarkerHandle {
  const { icon } = options;
  const Advanced = options.advanced ? maps.marker?.AdvancedMarkerElement : undefined;
  if (Advanced) {
    const img = document.createElement('img');
    img.src = icon.url;
    img.width = icon.width;
    img.height = icon.height;
    img.alt = '';
    img.draggable = false;
    img.style.display = 'block';
    // El marcador avanzado ancla el contenido por su base; el ícono se centra en la coordenada.
    img.style.transform = 'translateY(50%)';
    const marker = new Advanced({
      map: options.map,
      ...(options.position ? { position: options.position } : {}),
      ...(options.title ? { title: options.title } : {}),
      content: img,
      ...(options.zIndex !== undefined ? { zIndex: options.zIndex } : {}),
      gmpDraggable: options.draggable ?? false,
      gmpClickable: options.clickable ?? true,
    });
    return {
      anchor: marker,
      setMap: (map) => {
        marker.map = map;
      },
      remove: () => {
        marker.map = null;
      },
      setPosition: (position) => {
        marker.position = position;
      },
      getPosition: () => toLatLngLiteral(marker.position),
      onClick: (listener) => {
        marker.addListener('click', listener);
      },
      onDragEnd: (listener) => {
        marker.addListener('dragend', () => listener(toLatLngLiteral(marker.position)));
      },
    };
  }
  const marker = new maps.Marker({
    map: options.map,
    ...(options.position ? { position: options.position } : {}),
    ...(options.title ? { title: options.title } : {}),
    ...(options.zIndex !== undefined ? { zIndex: options.zIndex } : {}),
    draggable: options.draggable ?? false,
    clickable: options.clickable ?? true,
    icon: {
      url: icon.url,
      scaledSize: new maps.Size(icon.width, icon.height),
      anchor: new maps.Point(icon.width / 2, icon.height / 2),
    },
  });
  return {
    anchor: marker,
    setMap: (map) => marker.setMap(map),
    remove: () => marker.setMap(null),
    setPosition: (position) => marker.setPosition(position),
    getPosition: () => toLatLngLiteral(marker.getPosition()),
    onClick: (listener) => {
      marker.addListener('click', listener);
    },
    onDragEnd: (listener) => {
      marker.addListener('dragend', () => listener(toLatLngLiteral(marker.getPosition())));
    },
  };
}
