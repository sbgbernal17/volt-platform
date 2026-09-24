/**
 * Configuración dinámica de Expo: parte de app.json y añade lo que no debe vivir en el repositorio.
 * La clave de Google Maps para Android (restringida al paquete y a las firmas) llega por la variable
 * GOOGLE_MAPS_ANDROID_API_KEY en tiempo de compilación (variable de entorno de EAS o secreto de CI).
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim();
  return {
    ...config,
    name: config.name ?? 'Volt',
    slug: config.slug ?? 'volt',
    android: {
      ...config.android,
      ...(mapsKey
        ? { config: { ...config.android?.config, googleMaps: { apiKey: mapsKey } } }
        : {}),
    },
  };
};
