/**
 * Dispositivos del conductor para notificaciones push (Expo Push, ADR 0022). El token identifica el
 * dispositivo: si otra cuenta entra en el mismo teléfono, el token pasa a esa cuenta.
 */
import { randomUUID } from 'node:crypto';
import type { ISql } from 'postgres';
import { ValidationError } from '../errors.ts';
import type { DriverLocale } from './identity.ts';

export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export interface DriverDeviceRow {
  id: string;
  tenant_id: string;
  driver_id: string;
  push_token: string;
  platform: DevicePlatform;
  locale: DriverLocale;
  app_version: string | null;
  device_name: string | null;
  status: 'ACTIVE' | 'INVALID' | 'REMOVED';
  invalid_reason: string | null;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

/** Formato de los tokens de Expo (`ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`). */
export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,64}\]$/.test(token);
}

export interface RegisterDeviceInput {
  tenantId: string;
  driverId: string;
  pushToken: string;
  platform: DevicePlatform;
  locale?: DriverLocale | undefined;
  appVersion?: string | undefined;
  deviceName?: string | undefined;
}

export async function registerDriverDevice(
  db: ISql,
  input: RegisterDeviceInput,
): Promise<DriverDeviceRow> {
  if (!isExpoPushToken(input.pushToken))
    throw new ValidationError('Token de notificaciones inválido');
  const rows = await db<DriverDeviceRow[]>`
    INSERT INTO auth.driver_device (id, tenant_id, driver_id, push_token, platform, locale, app_version, device_name)
    VALUES (${randomUUID()}, ${input.tenantId}, ${input.driverId}, ${input.pushToken}, ${input.platform},
            ${input.locale ?? 'es'}, ${input.appVersion ?? null}, ${input.deviceName ?? null})
    ON CONFLICT (push_token) DO UPDATE SET
      driver_id = EXCLUDED.driver_id, tenant_id = EXCLUDED.tenant_id, platform = EXCLUDED.platform,
      locale = EXCLUDED.locale, app_version = EXCLUDED.app_version, device_name = EXCLUDED.device_name,
      status = 'ACTIVE', invalid_reason = NULL, last_seen_at = now(), updated_at = now()
    RETURNING *`;
  return rows[0] as DriverDeviceRow;
}

/** Baja del dispositivo (cierre de sesión en la app). Devuelve `false` si no era de este conductor. */
export async function unregisterDriverDevice(
  db: ISql,
  driverId: string,
  pushToken: string,
): Promise<boolean> {
  const result = await db`
    UPDATE auth.driver_device SET status = 'REMOVED', updated_at = now()
    WHERE driver_id = ${driverId} AND push_token = ${pushToken} AND status <> 'REMOVED'`;
  return result.count > 0;
}

export async function listDriverDevices(
  db: ISql,
  driverId: string,
  onlyActive = true,
): Promise<DriverDeviceRow[]> {
  return db<DriverDeviceRow[]>`
    SELECT * FROM auth.driver_device
    WHERE driver_id = ${driverId} AND (${!onlyActive} OR status = 'ACTIVE')
    ORDER BY last_seen_at DESC`;
}

/** Token rechazado por Expo (`DeviceNotRegistered`): no se vuelve a usar hasta que la app lo registre de nuevo. */
export async function markDeviceInvalid(
  db: ISql,
  pushToken: string,
  reason: string,
): Promise<void> {
  await db`
    UPDATE auth.driver_device SET status = 'INVALID', invalid_reason = ${reason.slice(0, 200)}, updated_at = now()
    WHERE push_token = ${pushToken} AND status = 'ACTIVE'`;
}
