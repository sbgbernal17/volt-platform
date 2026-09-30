/**
 * Ubicación del conductor para el mapa (handoff, pantallas 02 y 23): permiso "mientras usa la app",
 * una lectura al abrir el mapa y otra al tocar "Mi ubicación". En el navegador, la API del sistema.
 */
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { Coordinates } from './stations.ts';

export type LocationStatus = 'idle' | 'loading' | 'ready' | 'denied' | 'unavailable';

export function useUserLocation(): {
  coords: Coordinates | null;
  status: LocationStatus;
  request: () => Promise<Coordinates | null>;
} {
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');

  const request = useCallback(async (): Promise<Coordinates | null> => {
    setStatus('loading');
    try {
      if (Platform.OS === 'web') {
        const position = await new Promise<Coordinates>((resolve, reject) => {
          const geo = (globalThis as { navigator?: { geolocation?: Geolocation } }).navigator
            ?.geolocation;
          if (!geo) {
            reject(new Error('unavailable'));
            return;
          }
          geo.getCurrentPosition(
            (result) =>
              resolve({ latitude: result.coords.latitude, longitude: result.coords.longitude }),
            (error) => reject(error),
            { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
          );
        });
        setCoords(position);
        setStatus('ready');
        return position;
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setStatus('denied');
        return null;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setCoords(next);
      setStatus('ready');
      return next;
    } catch (error) {
      const code = (error as { code?: number }).code;
      // 1 = PERMISSION_DENIED en el navegador.
      setStatus(code === 1 ? 'denied' : 'unavailable');
      return null;
    }
  }, []);

  useEffect(() => {
    void request();
  }, [request]);

  return { coords, status, request };
}
