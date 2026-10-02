/**
 * Lectura de la versión instalada y búsqueda de actualizaciones OTA con expo-updates (ADR 0022).
 * En la web y en el cliente de desarrollo expo-updates está deshabilitado: no se busca nada.
 */
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import type { AppBuildInfo } from './app-build.ts';

export function appBuildInfo(): AppBuildInfo {
  const enabled = Platform.OS !== 'web' && Updates.isEnabled;
  return {
    version: Constants.expoConfig?.version ?? '0.0.0',
    channel: enabled ? (Updates.channel ?? null) : null,
    updateId: enabled && !Updates.isEmbeddedLaunch ? (Updates.updateId ?? null) : null,
    updatedAt: enabled && !Updates.isEmbeddedLaunch ? (Updates.createdAt ?? null) : null,
    embedded: enabled ? Updates.isEmbeddedLaunch : true,
    updatesEnabled: enabled,
  };
}

export type UpdateCheckResult = 'updated' | 'current' | 'unavailable' | 'error';

/**
 * Busca una actualización en el canal de la app; si hay una, la descarga y reinicia la app con ella
 * (la promesa no vuelve en ese caso). Devuelve `current` si ya es la última.
 */
export async function checkAndApplyUpdate(): Promise<UpdateCheckResult> {
  if (Platform.OS === 'web' || !Updates.isEnabled) return 'unavailable';
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return 'current';
    const fetched = await Updates.fetchUpdateAsync();
    if (!fetched.isNew) return 'current';
    await Updates.reloadAsync();
    return 'updated';
  } catch {
    return 'error';
  }
}
