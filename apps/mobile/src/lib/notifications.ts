/**
 * Notificaciones push con Expo (ADR 0022): permiso, token del dispositivo y registro en la API
 * (`PUT /v1/me/devices`). Expo Go no admite push desde el SDK 53 y el navegador tampoco: en esos
 * casos se informa y no se registra nada.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ApiClient } from '../api/client.ts';
import type { DeviceRegistration } from '../api/types.ts';

export type PushRegistration =
  | { ok: true; token: string; registration: DeviceRegistration }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no-project' | 'error'; error?: unknown };

const EXPO_TOKEN_KEY = 'volt.pushToken';
let lastToken: string | null = null;

export function pushSupported(): boolean {
  if (Platform.OS === 'web') return false;
  if (!Device.isDevice) return false;
  return Constants.appOwnership !== 'expo';
}

export function configureNotificationHandler(): void {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('volt', {
      name: 'Volt',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#DC2626',
    }).catch(() => undefined);
  }
}

export async function registerForPush(
  api: ApiClient,
  locale: 'es' | 'en',
): Promise<PushRegistration> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const current = await Notifications.getPermissionsAsync();
    let granted =
      current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (!granted) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted;
    }
    if (!granted) return { ok: false, reason: 'denied' };
    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
    if (!projectId) return { ok: false, reason: 'no-project' };
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const registration = await api.put<DeviceRegistration>('/me/devices', {
      pushToken: token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      locale,
      appVersion: Constants.expoConfig?.version ?? undefined,
      deviceName: Device.modelName ?? undefined,
    });
    lastToken = token;
    return { ok: true, token, registration };
  } catch (error) {
    return { ok: false, reason: 'error', error };
  }
}

/** Baja del dispositivo al cerrar sesión (si se había registrado en esta ejecución). */
export async function unregisterPush(api: ApiClient): Promise<void> {
  if (!lastToken) return;
  try {
    await api.post('/me/devices/unregister', { pushToken: lastToken });
  } catch {
    // sin red: el token queda inválido cuando Expo lo rechace
  }
  lastToken = null;
}

export { EXPO_TOKEN_KEY };
