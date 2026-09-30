/**
 * Trabajos de precios (iteración 4): liquidación de sesiones terminadas, activación de versiones
 * programadas y límites que detienen sesiones (tope de exposición y duración máxima).
 */
import {
  activateScheduledVersions,
  type CsmsLogger,
  type PricingService,
  type SessionService,
  stopSessionsOverLimits,
} from '@volt/csms';
import type { ISql } from 'postgres';
import type { SchedulerLogger } from '../scheduler.ts';

/**
 * Adapta el logger del planificador (pino) al de `@volt/csms` conservando `this`: los métodos de
 * pino no pueden pasarse sueltos (`{ info: logger.info }` falla con `this[writeSym] is not a
 * function` en cada llamada, y así estuvo cayendo el trabajo `session-limits` en la nube).
 */
export function csmsLogger(logger: SchedulerLogger): CsmsLogger {
  return {
    info: (obj, msg) => logger.info(obj, msg),
    warn: (obj, msg) => (logger.warn ?? logger.info).call(logger, obj, msg),
    error: (obj, msg) => logger.error(obj, msg),
  };
}

/** Sesiones ENDED listas para liquidar → SETTLED con sus líneas de costo (TAR §3.5). */
export async function settleSessions(
  pricing: PricingService,
  logger: SchedulerLogger,
): Promise<number> {
  const result = await pricing.settlePending({ limit: 200, actor: 'system:pricing' });
  if (result.settled > 0 || result.errors > 0) logger.info(result, 'liquidación de sesiones');
  return result.settled;
}

/** Versiones SCHEDULED cuya vigencia empezó y ACTIVE cuya vigencia terminó (TAR §2.4). */
export async function activateTariffs(sql: ISql, logger: SchedulerLogger): Promise<number> {
  const result = await activateScheduledVersions(sql);
  if (result.activated > 0 || result.retired > 0)
    logger.info(result, 'versiones de tarifa activadas o retiradas');
  return result.activated;
}

/** RemoteStopTransaction a las sesiones con el tope de exposición agotado o la duración máxima superada. */
export async function enforceSessionLimits(
  sql: ISql,
  sessions: SessionService,
  logger: SchedulerLogger,
): Promise<number> {
  const sweep = await stopSessionsOverLimits(sql, sessions, { logger: csmsLogger(logger) });
  return sweep.exposure + sweep.duration;
}
