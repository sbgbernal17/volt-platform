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
