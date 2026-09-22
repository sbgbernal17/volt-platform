import type { LifecycleState } from '@volt/domain';
import { hashSecret, verifySecret } from '@volt/security';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import type { ChargePointRegistry, RegisteredChargePoint } from './registry.ts';

export interface DbRegistryOptions {
  /** Fallos consecutivos dentro de la ventana que bloquean la credencial (SEG §2.5: 5). */
  maxFailures?: number;
  failureWindowMinutes?: number;
  lockMinutes?: number;
  /** Validez de la clave tras su primer uso correcto (SEG §2.3: 90 días). */
  usedTtlDays?: number;
}

interface CredentialRow {
  id: string;
  tenant_id: string;
  site_id: string;
  lifecycle_status: LifecycleState;
  key_hash: string | null;
  next_key_hash: string | null;
  expires_at: Date | null;
  locked_until: Date | null;
}

/**
 * Registro de cargadores sobre `assets.charge_point` y `assets.charge_point_credential`:
 * verifica la AuthorizationKey (scrypt), aplica bloqueo por intentos fallidos, caducidad de la
 * clave de bootstrap y promoción de la clave nueva durante una rotación (SEG §2.3 y §2.5).
 */
export class DbRegistry implements ChargePointRegistry {
  private readonly maxFailures: number;
  private readonly failureWindowMinutes: number;
  private readonly lockMinutes: number;
  private readonly usedTtlDays: number;
  /** Hash de relleno para que las identidades desconocidas cuesten lo mismo que las conocidas. */
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly sql: Sql,
    private readonly logger: Logger,
    options: DbRegistryOptions = {},
  ) {
    this.maxFailures = options.maxFailures ?? 5;
    this.failureWindowMinutes = options.failureWindowMinutes ?? 10;
    this.lockMinutes = options.lockMinutes ?? 15;
    this.usedTtlDays = options.usedTtlDays ?? 90;
    this.dummyHash = hashSecret('volt-dummy-credential');
  }

  async authenticate(
    identity: string,
    password: Buffer | undefined,
    context: { remoteAddress?: string } = {},
  ): Promise<RegisteredChargePoint | undefined> {
    const rows = await this.sql<CredentialRow[]>`
      SELECT cp.id, cp.tenant_id, cp.site_id, cp.lifecycle_status,
             c.key_hash, c.next_key_hash, c.expires_at, c.locked_until
      FROM assets.charge_point cp
      LEFT JOIN assets.charge_point_credential c ON c.charge_point_id = cp.id
      WHERE cp.charge_box_id = ${identity}`;
    const row = rows[0];
    const log = this.logger.child({ chargeBoxId: identity, remoteAddress: context.remoteAddress });
    if (!row?.key_hash || !password) {
      await verifySecret(password ?? '', await this.dummyHash);
      log.warn({ reason: !row ? 'UnknownChargeBoxId' : 'NoCredential' }, 'security_event');
      return undefined;
    }
    if (row.lifecycle_status === 'DECOMMISSIONED' || row.lifecycle_status === 'INVENTORIED') {
      await verifySecret(password, await this.dummyHash);
      log.warn(
        { reason: 'LifecycleNotAllowed', lifecycle: row.lifecycle_status },
        'security_event',
      );
      return undefined;
    }
    const now = Date.now();
    const lockedUntil = row.locked_until?.getTime();
    const expiresAt = row.expires_at?.getTime();
    if (lockedUntil !== undefined && lockedUntil > now) {
      await verifySecret(password, await this.dummyHash);
      log.warn({ reason: 'CredentialLocked', lockedUntil: row.locked_until }, 'security_event');
      return undefined;
    }
    if (expiresAt !== undefined && expiresAt < now) {
      await verifySecret(password, await this.dummyHash);
      log.warn({ reason: 'CredentialExpired', expiresAt: row.expires_at }, 'security_event');
      return undefined;
    }
    let matches = await verifySecret(password, row.key_hash);
    let promoted = false;
    if (!matches && row.next_key_hash) {
      matches = await verifySecret(password, row.next_key_hash);
      promoted = matches;
    }
    if (!matches) {
      const failures = await this.recordFailure(row.id);
      log.warn({ reason: 'AuthFailed', failures }, 'security_event');
      return undefined;
    }
    await this.recordSuccess(row.id, promoted);
    if (promoted) log.info({ reason: 'AuthorizationKeyRotated' }, 'security_event');
    return {
      id: row.id,
      identity,
      tenantId: row.tenant_id,
      siteId: row.site_id,
      lifecycle: row.lifecycle_status,
    };
  }

  private async recordFailure(chargePointId: string): Promise<number> {
    const rows = await this.sql<{ failed_attempts: number }[]>`
      UPDATE assets.charge_point_credential SET
        failed_attempts = CASE
          WHEN last_failed_at IS NOT NULL
               AND last_failed_at > now() - make_interval(mins => ${this.failureWindowMinutes})
          THEN failed_attempts + 1 ELSE 1 END,
        last_failed_at = now()
      WHERE charge_point_id = ${chargePointId}
      RETURNING failed_attempts`;
    const failures = rows[0]?.failed_attempts ?? 0;
    if (failures >= this.maxFailures) {
      await this.sql`
        UPDATE assets.charge_point_credential
        SET locked_until = now() + make_interval(mins => ${this.lockMinutes}), failed_attempts = 0
        WHERE charge_point_id = ${chargePointId}`;
    }
    return failures;
  }

  private async recordSuccess(chargePointId: string, promoted: boolean): Promise<void> {
    await this.sql`
      UPDATE assets.charge_point_credential SET
        failed_attempts = 0, locked_until = NULL, last_used_at = now(),
        first_used_at = COALESCE(first_used_at, now()),
        expires_at = CASE WHEN bootstrap THEN now() + make_interval(days => ${this.usedTtlDays}) ELSE expires_at END,
        bootstrap = false,
        key_hash = CASE WHEN ${promoted} THEN next_key_hash ELSE key_hash END,
        next_key_hash = CASE WHEN ${promoted} THEN NULL ELSE next_key_hash END,
        rotation_started_at = CASE WHEN ${promoted} THEN NULL ELSE rotation_started_at END
      WHERE charge_point_id = ${chargePointId}`;
  }
}
