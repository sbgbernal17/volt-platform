import type { Sql } from 'postgres';
import { raiseAlarm, resolveAlarm } from './alarms.ts';
import type { CommandResult, CommandService } from './commands.ts';
import { ChargePointOfflineError, ConflictError } from './errors.ts';
import {
  type ChargePointRow,
  type ConfigTemplateRow,
  getChargePoint,
  getConfigTemplate,
  listConfiguration,
  seedDesiredConfiguration,
} from './inventory.ts';
import { transitionLifecycle } from './lifecycle.ts';
import { type CsmsLogger, silentLogger, toJson } from './types.ts';

export interface DriftEntry {
  key: string;
  desired: string | null;
  observed: string | null;
  readonly: boolean | null;
  source: string;
  lastResult: string | null;
  /** La key está en `optional_keys` de la plantilla: no bloquea el paso a CONFIGURED. */
  optional: boolean;
}

export interface SyncResult {
  chargePointId: string;
  chargeBoxId: string;
  commandId: string;
  keysReported: number;
  unknownKeys: string[];
  numberOfConnectors: number | null;
  supportedProfiles: string[];
  drift: DriftEntry[];
  /** Deriva que bloquea: keys no opcionales y escribibles (o desconocidas) con valor distinto. */
  blockingDrift: DriftEntry[];
}

export interface KeyChangeResult {
  key: string;
  value: string;
  status: 'Accepted' | 'RebootRequired' | 'Rejected' | 'NotSupported' | 'ERROR';
  commandId: string;
  error?: string;
}

export interface ApplyTemplateResult {
  chargePointId: string;
  chargeBoxId: string;
  template: { id: string; name: string; version: number };
  before: SyncResult;
  changes: KeyChangeResult[];
  rebootRequired: boolean;
  rebooted: boolean;
  after: SyncResult;
  lifecycle: { from: string; to: string };
  configured: boolean;
}

export interface DriftCheckResult {
  sync: SyncResult;
  alarm: { raised: boolean; resolved: boolean; fingerprint: string };
}

export interface CommissioningOptions {
  logger?: CsmsLogger;
  /** Espera máxima a que el cargador reconecte tras un Reset (por defecto 30 s). */
  rebootWaitMs?: number;
  pollMs?: number;
}

export const CONFIG_DRIFT_ALARM = 'CONFIG_DRIFT';
export const INVENTORY_MISMATCH_ALARM = 'INVENTORY_MISMATCH';

export function driftFingerprint(chargeBoxId: string): string {
  return `${CONFIG_DRIFT_ALARM}|${chargeBoxId}`;
}

interface ConfigurationKeyItem {
  key: string;
  readonly: boolean;
  value?: string;
}

/**
 * Comisionamiento de un cargador (OPS §1.3, pasos 5 y 6): lectura completa de la configuración,
 * aplicación de la plantilla asignada, reinicio si hace falta, verificación y detección de deriva.
 */
export class CommissioningService {
  private readonly logger: CsmsLogger;
  private readonly rebootWaitMs: number;
  private readonly pollMs: number;

  constructor(
    private readonly sql: Sql,
    private readonly commands: CommandService,
    options: CommissioningOptions = {},
  ) {
    this.logger = options.logger ?? silentLogger;
    this.rebootWaitMs = options.rebootWaitMs ?? 30_000;
    this.pollMs = options.pollMs ?? 250;
  }

  /** GetConfiguration sin `key` (todas) y persistencia de `observed_value`/`readonly` por key. */
  async syncConfiguration(chargePointId: string, actor: string): Promise<SyncResult> {
    const chargePoint = await getChargePoint(this.sql, chargePointId);
    const template = chargePoint.config_template_id
      ? await getConfigTemplate(this.sql, chargePoint.config_template_id)
      : undefined;
    const { command, outcome } = await this.commands.send({
      chargePointId,
      action: 'GetConfiguration',
      payload: {},
      requestedBy: actor,
    });
    if (!outcome.ok) throw this.toError(chargePoint, outcome.error.code, outcome.error.description);
    const reported = Array.isArray(outcome.result.configurationKey)
      ? (outcome.result.configurationKey as ConfigurationKeyItem[])
      : [];
    const unknownKeys = Array.isArray(outcome.result.unknownKey)
      ? (outcome.result.unknownKey as string[])
      : [];
    await this.persistObserved(chargePointId, reported);

    const byKey = new Map(reported.map((item) => [item.key, item.value ?? null]));
    const numberOfConnectors = parseIntOrNull(byKey.get('NumberOfConnectors') ?? null);
    const supportedProfiles = (byKey.get('SupportedFeatureProfiles') ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    await this.sql`
      UPDATE assets.charge_point SET
        config_synced_at = now(),
        supported_profiles = COALESCE(NULLIF(${supportedProfiles}::text[], '{}'::text[]), supported_profiles),
        updated_at = now()
      WHERE id = ${chargePointId}`;
    if (numberOfConnectors !== null) {
      const inventoried = await this.sql<{ count: bigint }[]>`
        SELECT count(*)::bigint AS count FROM assets.connector WHERE charge_point_id = ${chargePointId}`;
      const expected = Number(inventoried[0]?.count ?? 0);
      if (expected !== numberOfConnectors) {
        await raiseAlarm(this.sql, {
          tenantId: chargePoint.tenant_id,
          chargePointId,
          siteId: chargePoint.site_id,
          kind: INVENTORY_MISMATCH_ALARM,
          severity: 'WARNING',
          fingerprint: `${INVENTORY_MISMATCH_ALARM}|${chargePoint.charge_box_id}|connectors`,
          details: {
            reason: 'NumberOfConnectors',
            reported: numberOfConnectors,
            inventoried: expected,
          },
        });
        this.logger.warn(
          { chargeBoxId: chargePoint.charge_box_id, reported: numberOfConnectors, expected },
          'NumberOfConnectors distinto del inventario',
        );
      }
    }
    const drift = await this.readDrift(chargePointId, template);
    return {
      chargePointId,
      chargeBoxId: chargePoint.charge_box_id,
      commandId: command.id,
      keysReported: reported.length,
      unknownKeys,
      numberOfConnectors,
      supportedProfiles,
      drift,
      blockingDrift: drift.filter(isBlocking),
    };
  }

  /**
   * Aplica la plantilla asignada: ChangeConfiguration por cada key con deriva, Reset(Soft) si algún
   * cambio lo exige, verificación con un GetConfiguration nuevo y paso a CONFIGURED cuando no queda
   * deriva bloqueante (desde CONNECTED_PENDING).
   */
  async applyTemplate(chargePointId: string, actor: string): Promise<ApplyTemplateResult> {
    const chargePoint = await getChargePoint(this.sql, chargePointId);
    if (!chargePoint.config_template_id) {
      throw new ConflictError(
        'El cargador no tiene plantilla de configuración asignada',
        'NO_TEMPLATE',
      );
    }
    const template = await getConfigTemplate(this.sql, chargePoint.config_template_id);
    await seedDesiredConfiguration(this.sql, chargePointId, template.id);

    const before = await this.syncConfiguration(chargePointId, actor);
    const changes: KeyChangeResult[] = [];
    let rebootRequired = false;
    for (const entry of before.drift) {
      if (entry.desired === null || entry.readonly === true) continue;
      // Una key opcional que el firmware ya declaró NotSupported no se reintenta en cada aplicación.
      if (entry.optional && entry.lastResult === 'NotSupported') continue;
      const change = await this.changeKey(chargePointId, entry.key, entry.desired, actor);
      changes.push(change);
      if (change.status === 'RebootRequired') rebootRequired = true;
      if (change.status === 'ERROR' && change.error?.startsWith('NOT_CONNECTED')) {
        throw new ChargePointOfflineError(
          chargePoint.charge_box_id,
          'se perdió la conexión al aplicar la plantilla',
        );
      }
    }

    let rebooted = false;
    if (rebootRequired) {
      const beforeReset = await getChargePoint(this.sql, chargePointId);
      const reset = await this.commands.send({
        chargePointId,
        action: 'Reset',
        payload: { type: 'Soft' },
        requestedBy: actor,
      });
      if (reset.outcome.ok && reset.command.state === 'ACCEPTED') {
        rebooted = await this.waitForReboot(chargePointId, beforeReset.connection_generation);
        if (!rebooted) {
          this.logger.warn(
            { chargeBoxId: chargePoint.charge_box_id },
            'el cargador no reconectó tras el Reset',
          );
        }
      } else {
        this.logger.warn(
          { chargeBoxId: chargePoint.charge_box_id, result: reset.command.result_status },
          'Reset no aceptado',
        );
      }
    }

    const after = await this.syncConfiguration(chargePointId, actor);
    const current = await getChargePoint(this.sql, chargePointId);
    const commandIds = [before.commandId, ...changes.map((c) => c.commandId), after.commandId];
    let lifecycle = { from: current.lifecycle_status, to: current.lifecycle_status };
    let configured = false;
    if (after.blockingDrift.length === 0) {
      if (current.lifecycle_status === 'CONNECTED_PENDING') {
        const result = await transitionLifecycle(this.sql, {
          chargePointId,
          to: 'CONFIGURED',
          actor,
          reason: 'plantilla aplicada sin deriva bloqueante',
          evidence: { commandIds, template: template.name, version: template.version },
        });
        lifecycle = { from: result.from, to: result.to };
        configured = true;
        // Para que el cargador reciba Accepted sin esperar su reintento de BootNotification.
        await this.commands
          .send({
            chargePointId,
            action: 'TriggerMessage',
            payload: { requestedMessage: 'BootNotification' },
            requestedBy: actor,
          })
          .catch((error: unknown) =>
            this.logger.warn({ err: error }, 'TriggerMessage(BootNotification) falló'),
          );
      } else if (
        current.lifecycle_status !== 'PROVISIONED' &&
        current.lifecycle_status !== 'INVENTORIED'
      ) {
        configured = true;
      }
      await resolveAlarm(
        this.sql,
        driftFingerprint(chargePoint.charge_box_id),
        'plantilla aplicada',
      );
    }
    return {
      chargePointId,
      chargeBoxId: chargePoint.charge_box_id,
      template: { id: template.id, name: template.name, version: template.version },
      before,
      changes,
      rebootRequired,
      rebooted,
      after,
      lifecycle,
      configured,
    };
  }

  /** Cambia una key como override del operador y la aplica en el cargador si está conectado. */
  async setOverride(
    chargePointId: string,
    key: string,
    value: string,
    actor: string,
  ): Promise<KeyChangeResult> {
    await getChargePoint(this.sql, chargePointId);
    await this.sql`
      INSERT INTO assets.charge_point_config (charge_point_id, key, desired_value, source, last_changed_at)
      VALUES (${chargePointId}, ${key}, ${value}, 'OVERRIDE', now())
      ON CONFLICT (charge_point_id, key) DO UPDATE
        SET desired_value = EXCLUDED.desired_value, source = 'OVERRIDE', last_changed_at = now()`;
    return this.changeKey(chargePointId, key, value, actor);
  }

  /** Lectura de configuración y alarma CONFIG_DRIFT abierta/resuelta según haya deriva (OPS §1.4). */
  async detectDrift(chargePointId: string, actor: string): Promise<DriftCheckResult> {
    const sync = await this.syncConfiguration(chargePointId, actor);
    const chargePoint = await getChargePoint(this.sql, chargePointId);
    const fingerprint = driftFingerprint(chargePoint.charge_box_id);
    if (sync.drift.length > 0) {
      await raiseAlarm(this.sql, {
        tenantId: chargePoint.tenant_id,
        chargePointId,
        siteId: chargePoint.site_id,
        kind: CONFIG_DRIFT_ALARM,
        severity: 'WARNING',
        fingerprint,
        details: {
          keys: sync.drift.map((d) => ({ key: d.key, desired: d.desired, observed: d.observed })),
          blocking: sync.blockingDrift.length,
        },
      });
      return { sync, alarm: { raised: true, resolved: false, fingerprint } };
    }
    const resolved = await resolveAlarm(this.sql, fingerprint, 'sin deriva en la última lectura');
    return { sync, alarm: { raised: false, resolved: resolved > 0, fingerprint } };
  }

  private async changeKey(
    chargePointId: string,
    key: string,
    value: string,
    actor: string,
  ): Promise<KeyChangeResult> {
    let result: CommandResult;
    try {
      result = await this.commands.send({
        chargePointId,
        action: 'ChangeConfiguration',
        payload: { key, value },
        requestedBy: actor,
      });
    } catch (error) {
      return { key, value, status: 'ERROR', commandId: '', error: (error as Error).message };
    }
    const { command, outcome } = result;
    if (!outcome.ok) {
      return {
        key,
        value,
        status: 'ERROR',
        commandId: command.id,
        error: `${outcome.error.code}: ${outcome.error.description}`,
      };
    }
    const status = String(outcome.result.status ?? 'Rejected') as KeyChangeResult['status'];
    const applied = status === 'Accepted' || status === 'RebootRequired';
    await this.sql`
      UPDATE assets.charge_point_config SET
        last_result = ${status},
        observed_value = CASE WHEN ${applied} THEN ${value} ELSE observed_value END,
        last_synced_at = CASE WHEN ${applied} THEN now() ELSE last_synced_at END
      WHERE charge_point_id = ${chargePointId} AND key = ${key}`;
    return { key, value, status, commandId: command.id };
  }

  private async persistObserved(
    chargePointId: string,
    reported: ConfigurationKeyItem[],
  ): Promise<void> {
    const rows = reported
      .filter(
        (item) => typeof item.key === 'string' && item.key.length > 0 && item.key.length <= 50,
      )
      .map((item) => ({
        charge_point_id: chargePointId,
        key: item.key,
        observed_value: item.value === undefined ? null : String(item.value).slice(0, 500),
        readonly: Boolean(item.readonly),
      }));
    if (rows.length === 0) return;
    await this.sql`
      INSERT INTO assets.charge_point_config (charge_point_id, key, observed_value, readonly, source, last_synced_at)
      SELECT r.charge_point_id::uuid, r.key, r.observed_value, r.readonly, 'DEVICE', now()
      FROM jsonb_to_recordset(${toJson(this.sql, rows)}::jsonb)
        AS r(charge_point_id text, key text, observed_value text, readonly boolean)
      ON CONFLICT (charge_point_id, key) DO UPDATE
        SET observed_value = EXCLUDED.observed_value, readonly = EXCLUDED.readonly, last_synced_at = now()`;
  }

  private async readDrift(
    chargePointId: string,
    template: ConfigTemplateRow | undefined,
  ): Promise<DriftEntry[]> {
    const optional = new Set(template?.optional_keys ?? []);
    const rows = await listConfiguration(this.sql, chargePointId);
    return rows
      .filter((row) => row.drift)
      .map((row) => ({
        key: row.key,
        desired: row.desired_value,
        observed: row.observed_value,
        readonly: row.readonly,
        source: row.source,
        lastResult: row.last_result,
        optional: optional.has(row.key),
      }));
  }

  private async waitForReboot(chargePointId: string, generationBefore: bigint): Promise<boolean> {
    const deadline = Date.now() + this.rebootWaitMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      const rows = await this.sql<
        { connected: boolean; connection_generation: bigint; last_boot_at: Date | null }[]
      >`
        SELECT connected, connection_generation, last_boot_at FROM assets.charge_point WHERE id = ${chargePointId}`;
      const row = rows[0];
      if (row?.connected && row.connection_generation > generationBefore && row.last_boot_at)
        return true;
    }
    return false;
  }

  private toError(chargePoint: ChargePointRow, code: string, description: string): Error {
    if (code === 'NOT_CONNECTED' || code === 'UNAVAILABLE') {
      return new ChargePointOfflineError(chargePoint.charge_box_id, description);
    }
    return new ConflictError(`GetConfiguration falló (${code}): ${description}`, 'COMMAND_FAILED');
  }
}

function isBlocking(entry: DriftEntry): boolean {
  return !entry.optional && entry.readonly !== true;
}

function parseIntOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}
