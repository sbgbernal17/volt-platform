/** Configuración en tiempo de ejecución que inyecta `public/config.js` (o el contenedor). */
export interface RuntimeConfig {
  apiBaseUrl: string;
  /** Clave de navegador de Maps JavaScript API (pública, restringida por referrer); vacía = sin mapa. */
  googleMapsApiKey: string;
}

declare global {
  interface Window {
    __VOLT_CONFIG__?: Partial<RuntimeConfig>;
  }
}

export function runtimeConfig(): RuntimeConfig {
  const injected = typeof window === 'undefined' ? undefined : window.__VOLT_CONFIG__;
  const fromBuild = (import.meta.env?.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined) ?? '';
  return {
    apiBaseUrl: (injected?.apiBaseUrl ?? '').replace(/\/$/, ''),
    googleMapsApiKey: (injected?.googleMapsApiKey ?? fromBuild).trim(),
  };
}
