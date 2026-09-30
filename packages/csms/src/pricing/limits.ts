/**
 * Límites que detienen una sesión en curso (TAR §3.3, ADR 0017): tope de exposición agotado y
 * duración máxima (parámetro `session.max_duration_min`). Cada sesión recibe un solo
 * RemoteStopTransaction: `requestStop` deja `stop_requested_by`, que excluye la sesión del
 * siguiente barrido; si el cargador rechaza la parada o el comando no sale, se reintenta pasados
 * `STOP_RETRY_MINUTES` (el comando queda en `ops.command` con la sesión como `correlation_id`), no en
 * cada ciclo: un cargador que perdió la transacción rechazaría cada intento.
 */
import type { ISql } from 'postgres';
import type { SessionService } from '../sessions/session-service.ts';
import { type CsmsLogger, silentLogger } from '../types.ts';

export const EXPOSURE_ACTOR = 'system:exposure-limit';
export const MAX_DURATION_ACTOR = 'system:max-duration';
/** Minutos entre intentos de parada sobre la misma sesión. */
export const STOP_RETRY_MINUTES = 5;

export interface LimitsSweep {
  exposure: number;
  duration: number;
  failed: number;
}

export async function stopSessionsOverLimits(
  db: ISql,
  sessions: SessionService,
  options: { logger?: CsmsLogger | undefined; now?: Date | undefined } = {},
): Promise<LimitsSweep> {
  const logger = options.logger ?? silentLogger;
  const now = options.now ?? new Date();
  const sweep: LimitsSweep = { exposure: 0, duration: 0, failed: 0 };
  const exhausted = await db<{ id: string; charge_point_id: string }[]>`
    SELECT s.id, s.charge_point_id FROM sessions.charging_session s
    WHERE s.exposure_exhausted_at IS NOT NULL AND s.stop_requested_by IS NULL
      AND s.state IN ('CHARGING', 'SUSPENDED_EV', 'SUSPENDED_EVSE')
      AND NOT EXISTS (
        SELECT 1 FROM ops.command c
        WHERE c.correlation_id = s.id::text AND c.action = 'RemoteStopTransaction'
          AND c.requested_at > ${now} - make_interval(mins => ${STOP_RETRY_MINUTES}))
    ORDER BY s.exposure_exhausted_at LIMIT 100`;
  for (const row of exhausted) {
    try {
      await sessions.requestStop(row.id, EXPOSURE_ACTOR);
      sweep.exposure += 1;
      logger.warn({ sessionId: row.id }, 'sesión detenida por tope de exposición');
    } catch (error) {
      sweep.failed += 1;
      logger.warn(
        { sessionId: row.id, err: error },
        'no se pudo detener la sesión por tope de exposición',
      );
    }
  }
  const overtime = await db<{ id: string }[]>`
    SELECT s.id FROM sessions.charging_session s
    WHERE s.state IN ('CHARGING', 'SUSPENDED_EV', 'SUSPENDED_EVSE') AND s.stop_requested_by IS NULL
      AND s.started_at IS NOT NULL AND s.connector_id IS NOT NULL
      AND s.started_at < ${now} - make_interval(mins => COALESCE((config.resolve('session.max_duration_min', s.connector_id))::int, 240))
      AND NOT EXISTS (
        SELECT 1 FROM ops.command c
        WHERE c.correlation_id = s.id::text AND c.action = 'RemoteStopTransaction'
          AND c.requested_at > ${now} - make_interval(mins => ${STOP_RETRY_MINUTES}))
    ORDER BY s.started_at LIMIT 100`;
  for (const row of overtime) {
    try {
      await sessions.requestStop(row.id, MAX_DURATION_ACTOR);
      sweep.duration += 1;
      logger.warn({ sessionId: row.id }, 'sesión detenida por duración máxima');
    } catch (error) {
      sweep.failed += 1;
      logger.warn(
        { sessionId: row.id, err: error },
        'no se pudo detener la sesión por duración máxima',
      );
    }
  }
  return sweep;
}
