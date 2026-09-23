/** Configuración en tiempo de ejecución que inyecta `public/config.js` (o el contenedor). */
export interface RuntimeConfig {
  apiBaseUrl: string;
}

declare global {
  interface Window {
    __VOLT_CONFIG__?: Partial<RuntimeConfig>;
  }
}

export function runtimeConfig(): RuntimeConfig {
  const injected = typeof window === 'undefined' ? undefined : window.__VOLT_CONFIG__;
  return { apiBaseUrl: (injected?.apiBaseUrl ?? '').replace(/\/$/, '') };
}
