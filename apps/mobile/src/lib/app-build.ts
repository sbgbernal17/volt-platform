/**
 * Qué versión de la app corre: la versión nativa (la que se instala desde la tienda) y el código
 * JavaScript que trae, que puede ser el incluido en la instalación o una actualización OTA publicada
 * después con EAS Update (ADR 0022). Módulo puro; la lectura de Expo está en `app-updates.ts`.
 */
import { formatDateTime } from './format.ts';

export interface AppBuildInfo {
  /** Versión de la app (`expo.version`, la misma de la tienda). */
  version: string;
  /** Canal de actualizaciones (perfil de compilación: staging, production…); null en la web y en desarrollo. */
  channel: string | null;
  /** Identificador de la actualización OTA en uso; null cuando corre el código incluido en la instalación. */
  updateId: string | null;
  /** Fecha de publicación de esa actualización. */
  updatedAt: Date | null;
  /** true cuando corre el código incluido en la instalación (sin actualización OTA aplicada). */
  embedded: boolean;
  /** false en la web y en el cliente de desarrollo: no hay actualizaciones que buscar. */
  updatesEnabled: boolean;
}

/** Texto para el pie de Cuenta: versión, origen del código y, si aplica, fecha e id de la actualización. */
export function formatAppBuild(info: AppBuildInfo, locale: 'es' | 'en'): string {
  const version = `${locale === 'es' ? 'Versión' : 'Version'} ${info.version}`;
  if (!info.updatesEnabled) return version;
  if (info.embedded || !info.updateId) {
    return `${version} · ${locale === 'es' ? 'código incluido en la instalación' : 'code bundled with the install'}`;
  }
  const when = info.updatedAt ? formatDateTime(info.updatedAt, locale) : null;
  const label = locale === 'es' ? 'actualización' : 'update';
  const id = info.updateId.slice(0, 8);
  return when ? `${version} · ${label} ${id} · ${when}` : `${version} · ${label} ${id}`;
}
