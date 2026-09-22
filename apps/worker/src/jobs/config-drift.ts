import { ChargePointOfflineError, type CommissioningService } from '@volt/csms';
import type { Sql } from 'postgres';
import type { Job, SchedulerLogger } from '../scheduler.ts';

export interface DriftCheckDependencies {
  sql: Sql;
  commissioning: CommissioningService;
  logger: SchedulerLogger;
  /** Cargadores por segundo (OPS §1.4: ≤ 20). */
  ratePerSecond?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface DriftCheckSummary {
  checked: number;
  drifted: number;
  offline: number;
  failed: number;
}

export const DRIFT_ACTOR = 'system:worker:config-drift';

/**
 * Revisión de deriva de configuración (OPS §1.4): GetConfiguration a cada cargador operativo
 * conectado, a ritmo limitado; la alarma CONFIG_DRIFT la abre o resuelve el servicio de
 * comisionamiento.
 */
export async function runConfigDriftCheck(
  deps: DriftCheckDependencies,
): Promise<DriftCheckSummary> {
  const rate = deps.ratePerSecond ?? 20;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const summary: DriftCheckSummary = { checked: 0, drifted: 0, offline: 0, failed: 0 };
  const targets = await deps.sql<{ id: string; charge_box_id: string }[]>`
    SELECT id, charge_box_id FROM assets.charge_point
    WHERE lifecycle_status IN ('OPERATIONAL', 'MAINTENANCE') AND connected
    ORDER BY charge_box_id`;
  for (const target of targets) {
    try {
      const result = await deps.commissioning.detectDrift(target.id, DRIFT_ACTOR);
      summary.checked += 1;
      if (result.sync.drift.length > 0) summary.drifted += 1;
    } catch (error) {
      if (error instanceof ChargePointOfflineError) summary.offline += 1;
      else {
        summary.failed += 1;
        deps.logger.error(
          { chargeBoxId: target.charge_box_id, err: error },
          'revisión de deriva fallida',
        );
      }
    }
    await sleep(Math.ceil(1000 / rate));
  }
  deps.logger.info({ ...summary, targets: targets.length }, 'revisión de deriva terminada');
  return summary;
}

/**
 * Envuelve una tarea para que se ejecute una vez al día a la hora UTC indicada. El planificador
 * la evalúa cada minuto; la última fecha de ejecución vive en memoria (una ejecución de más tras
 * un reinicio es aceptable para una lectura de configuración).
 */
export function dailyAt(
  name: string,
  hourUtc: number,
  run: () => Promise<unknown>,
  clock: () => Date = () => new Date(),
): Job & { lastRunDay?: string } {
  const job: Job & { lastRunDay?: string } = {
    name,
    intervalMs: 60_000,
    run: async () => {
      const now = clock();
      const day = now.toISOString().slice(0, 10);
      if (now.getUTCHours() !== hourUtc || job.lastRunDay === day) return;
      job.lastRunDay = day;
      await run();
    },
  };
  return job;
}
