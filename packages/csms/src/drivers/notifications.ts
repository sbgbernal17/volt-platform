/**
 * Notificaciones al conductor (`auth.driver_notification`): rastro de lo enviado por cada evento de
 * dominio y bandeja de avisos de la app. Idempotente por (conductor, evento, clase).
 */
import { randomUUID } from 'node:crypto';
import type { ISql } from 'postgres';
import { toJson } from '../types.ts';
import type { DriverLocale } from './identity.ts';
import type { PushKind } from './push-texts.ts';

export type NotificationStatus = 'PENDING' | 'SENT' | 'NO_DEVICE' | 'FAILED';

export interface DriverNotificationRow {
  id: string;
  tenant_id: string;
  driver_id: string;
  event_id: string;
  kind: PushKind;
  session_id: string | null;
  locale: DriverLocale;
  title: string;
  body: string;
  data: Record<string, unknown>;
  devices: number;
  status: NotificationStatus;
  error: string | null;
  read_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertNotificationInput {
  tenantId: string;
  driverId: string;
  eventId: string;
  kind: PushKind;
  sessionId?: string | null | undefined;
  locale: DriverLocale;
  title: string;
  body: string;
  data?: Record<string, unknown> | undefined;
  status: NotificationStatus;
  devices?: number | undefined;
}

/** Inserta la notificación; devuelve `undefined` si ya existía (mismo conductor, evento y clase). */
export async function insertDriverNotification(
  db: ISql,
  input: InsertNotificationInput,
): Promise<DriverNotificationRow | undefined> {
  const rows = await db<DriverNotificationRow[]>`
    INSERT INTO auth.driver_notification
      (id, tenant_id, driver_id, event_id, kind, session_id, locale, title, body, data, devices, status)
    VALUES (${randomUUID()}, ${input.tenantId}, ${input.driverId}, ${input.eventId}, ${input.kind},
            ${input.sessionId ?? null}, ${input.locale}, ${input.title}, ${input.body},
            ${toJson(db as never, input.data ?? {})}, ${input.devices ?? 0}, ${input.status})
    ON CONFLICT (driver_id, event_id, kind) DO NOTHING
    RETURNING *`;
  return rows[0];
}

/** Ya se avisó de esta clase para la sesión (clases que solo se envían una vez por sesión). */
export async function hasSessionNotification(
  db: ISql,
  driverId: string,
  sessionId: string,
  kind: PushKind,
): Promise<boolean> {
  const rows = await db`
    SELECT 1 FROM auth.driver_notification
    WHERE driver_id = ${driverId} AND session_id = ${sessionId} AND kind = ${kind} LIMIT 1`;
  return rows.length > 0;
}

export async function updateDriverNotification(
  db: ISql,
  id: string,
  patch: {
    status: NotificationStatus;
    devices?: number | undefined;
    error?: string | null | undefined;
  },
): Promise<void> {
  await db`
    UPDATE auth.driver_notification SET
      status = ${patch.status},
      devices = COALESCE(${patch.devices ?? null}, devices),
      error = ${patch.error ? patch.error.slice(0, 500) : null},
      updated_at = now()
    WHERE id = ${id}`;
}

export async function listDriverNotifications(
  db: ISql,
  driverId: string,
  options: { limit?: number | undefined; before?: Date | undefined } = {},
): Promise<DriverNotificationRow[]> {
  return db<DriverNotificationRow[]>`
    SELECT * FROM auth.driver_notification
    WHERE driver_id = ${driverId} AND (${options.before ?? null}::timestamptz IS NULL OR created_at < ${options.before ?? null})
    ORDER BY created_at DESC LIMIT ${options.limit ?? 50}`;
}

/** Marca como leídas las indicadas o, sin lista, todas las del conductor. Devuelve cuántas cambiaron. */
export async function markNotificationsRead(
  db: ISql,
  driverId: string,
  ids?: readonly string[] | undefined,
): Promise<number> {
  const list = ids ? [...ids] : null;
  const result = await db`
    UPDATE auth.driver_notification SET read_at = now(), updated_at = now()
    WHERE driver_id = ${driverId} AND read_at IS NULL AND (${list}::uuid[] IS NULL OR id = ANY(${list}::uuid[]))`;
  return result.count;
}

export async function countUnreadNotifications(db: ISql, driverId: string): Promise<number> {
  const rows = await db<{ count: number }[]>`
    SELECT count(*)::int AS count FROM auth.driver_notification WHERE driver_id = ${driverId} AND read_at IS NULL`;
  return rows[0]?.count ?? 0;
}
