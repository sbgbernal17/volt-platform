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
