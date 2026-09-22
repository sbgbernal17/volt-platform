import { INVENTORY_MISMATCH_ALARM, raiseAlarm, toJson, transitionLifecycle } from '@volt/csms';
import { bootNotificationStatusFor, type LifecycleState } from '@volt/domain';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import type { RegisteredChargePoint } from './registry.ts';

export interface ConnectionOpenedInfo {
  chargePoint: RegisteredChargePoint;
  podId: string;
  remoteAddress?: string;
  protocol: string;
  securityProfile?: number;
  at: Date;
}

export interface ConnectionClosedInfo {
  chargePoint: RegisteredChargePoint;
  generation: number;
  code?: number;
  reason?: string;
  at: Date;
  messagesIn: number;
  messagesOut: number;
}

export interface BootInfo {
  chargePoint: RegisteredChargePoint;
  params: Record<string, unknown>;
  uniqueId: string;
  at: Date;
  heartbeatIntervalS: number;
}

export interface BootOutcome {
  lifecycle: LifecycleState;
  inventoryMismatch: boolean;
}

export interface StatusInfo {
  chargePoint: RegisteredChargePoint;
  params: Record<string, unknown>;
  at: Date;
}

export interface MessageLogEntry {
  ts: Date;
  tenantId: string;
  chargeBoxId: string;
  direction: 'CP2CS' | 'CS2CP';
  messageType: 2 | 3 | 4;
  uniqueId: string;
  action?: string;
  payload?: unknown;
  errorCode?: string;
  errorDescription?: string;
  sizeBytes: number;
  pod: string;
  generation: number;
}

/**
 * Puerto de persistencia del gateway: conectividad, BootNotification, estados de conector,
 * último mensaje visto y log OCPP. `MemoryPersistence` sirve para laboratorio sin base de datos.
 */
export interface GatewayPersistence {
  connectionOpened(info: ConnectionOpenedInfo): Promise<{ generation: number }>;
  connectionClosed(info: ConnectionClosedInfo): Promise<void>;
  bootNotification(info: BootInfo): Promise<BootOutcome>;
  statusNotification(info: StatusInfo): Promise<{ known: boolean }>;
  seen(chargePoint: RegisteredChargePoint, at: Date): Promise<void>;
  logMessage(entry: MessageLogEntry): void;
  flush(): Promise<void>;
}

export class MemoryPersistence implements GatewayPersistence {
  private readonly generations = new Map<string, number>();
  readonly messages: MessageLogEntry[] = [];

  async connectionOpened(info: ConnectionOpenedInfo): Promise<{ generation: number }> {
    const generation = (this.generations.get(info.chargePoint.identity) ?? 0) + 1;
    this.generations.set(info.chargePoint.identity, generation);
    return { generation };
  }

  async connectionClosed(): Promise<void> {}

  async bootNotification(info: BootInfo): Promise<BootOutcome> {
    return { lifecycle: info.chargePoint.lifecycle, inventoryMismatch: false };
  }

  async statusNotification(): Promise<{ known: boolean }> {
    return { known: true };
  }

  async seen(): Promise<void> {}

  logMessage(entry: MessageLogEntry): void {
    this.messages.push(entry);
    if (this.messages.length > 1000) this.messages.shift();
  }

  async flush(): Promise<void> {}
}

const MAX_LOGGED_PAYLOAD_BYTES = 16 * 1024;

function normalize(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function differs(inventory: string | null, reported: unknown): boolean {
  const expected = normalize(inventory);
  const actual = normalize(reported);
  if (!expected || !actual) return false;
  return expected.toLowerCase() !== actual.toLowerCase();
}

/** Enmascara idTag y AuthorizationKey antes de escribir el log (SEG §2.5, control 10). */
export function maskSensitive(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const copy: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  if (typeof copy.idTag === 'string') copy.idTag = `${copy.idTag.slice(0, 2)}***`;
  if (typeof copy.parentIdTag === 'string') copy.parentIdTag = '***';
  if (copy.key === 'AuthorizationKey' && typeof copy.value === 'string') copy.value = '***';
  return copy;
}

/** Persistencia sobre PostgreSQL (esquemas assets y ops). */
export class DbPersistence implements GatewayPersistence {
  private buffer: MessageLogEntry[] = [];
  private flushTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly sql: Sql,
    private readonly logger: Logger,
    private readonly options: { logFlushMs?: number; logBatchSize?: number } = {},
  ) {}

  async connectionOpened(info: ConnectionOpenedInfo): Promise<{ generation: number }> {
    const rows = await this.sql<{ connection_generation: bigint }[]>`
      UPDATE assets.charge_point
      SET connected = true, connection_generation = connection_generation + 1,
          last_seen_at = ${info.at}, updated_at = now()
      WHERE id = ${info.chargePoint.id}
      RETURNING connection_generation`;
    const generation = Number(rows[0]?.connection_generation ?? 0);
    await this.sql`
      INSERT INTO ops.charge_point_connection
        (charge_point_id, generation, pod, remote_ip, subprotocol, security_profile, connected_at)
      VALUES (${info.chargePoint.id}, ${generation}, ${info.podId}, ${info.remoteAddress ?? null},
              ${info.protocol}, ${info.securityProfile ?? null}, ${info.at})
      ON CONFLICT (charge_point_id, generation) DO NOTHING`;
    return { generation };
  }

  async connectionClosed(info: ConnectionClosedInfo): Promise<void> {
    await this.sql`
      UPDATE ops.charge_point_connection
      SET disconnected_at = ${info.at}, close_code = ${info.code ?? null},
          close_reason = ${info.reason ?? null}, msgs_in = ${info.messagesIn}, msgs_out = ${info.messagesOut}
      WHERE charge_point_id = ${info.chargePoint.id} AND generation = ${info.generation}`;
    // Fencing: solo la conexión vigente marca el cargador como desconectado.
    await this.sql`
      UPDATE assets.charge_point
      SET connected = false, last_disconnect_at = ${info.at}, updated_at = now()
      WHERE id = ${info.chargePoint.id} AND connection_generation = ${info.generation}`;
  }

  async bootNotification(info: BootInfo): Promise<BootOutcome> {
    const { chargePoint, params, at } = info;
    const rows = await this.sql<
      {
        lifecycle_status: LifecycleState;
        vendor: string | null;
        model: string | null;
        site_id: string;
      }[]
    >`SELECT lifecycle_status, vendor, model, site_id FROM assets.charge_point WHERE id = ${chargePoint.id}`;
    const current = rows[0];
    if (!current) return { lifecycle: chargePoint.lifecycle, inventoryMismatch: false };
    const mismatch =
      differs(current.vendor, params.chargePointVendor) ||
      differs(current.model, params.chargePointModel);
    await this.sql`
      UPDATE assets.charge_point SET
        boot_vendor = ${normalize(params.chargePointVendor)},
        boot_model = ${normalize(params.chargePointModel)},
        serial_number = COALESCE(serial_number, ${normalize(params.chargePointSerialNumber)}),
        firmware_version = COALESCE(${normalize(params.firmwareVersion)}, firmware_version),
        iccid = COALESCE(${normalize(params.iccid)}, iccid),
        imsi = COALESCE(${normalize(params.imsi)}, imsi),
        meter_type = COALESCE(${normalize(params.meterType)}, meter_type),
        meter_serial = COALESCE(${normalize(params.meterSerialNumber)}, meter_serial),
        last_boot_at = ${at}, last_seen_at = ${at}, heartbeat_interval_s = ${info.heartbeatIntervalS},
        updated_at = now()
      WHERE id = ${chargePoint.id}`;

    let lifecycle = current.lifecycle_status;
    const evidence = {
      uniqueId: info.uniqueId,
      action: 'BootNotification',
      reported: {
        vendor: params.chargePointVendor ?? null,
        model: params.chargePointModel ?? null,
      },
      inventory: { vendor: current.vendor, model: current.model },
    };
    if (lifecycle === 'PROVISIONED') {
      // Primer arranque: el cargador ya habla con la plataforma (OPS §1.2).
      const result = await transitionLifecycle(this.sql, {
        chargePointId: chargePoint.id,
        to: 'CONNECTED_PENDING',
        actor: 'system:ocpp-gateway',
        reason: 'primer BootNotification',
        evidence: { uniqueId: info.uniqueId, action: 'BootNotification' },
      });
      lifecycle = result.to;
    }
    if (mismatch && lifecycle === 'CONNECTED_PENDING') {
      const result = await transitionLifecycle(this.sql, {
        chargePointId: chargePoint.id,
        to: 'REJECTED',
        actor: 'system:ocpp-gateway',
        reason: 'vendor o model distintos del inventario',
        evidence,
      });
      lifecycle = result.to;
      await raiseAlarm(this.sql, {
        tenantId: chargePoint.tenantId,
        chargePointId: chargePoint.id,
        siteId: current.site_id,
        kind: INVENTORY_MISMATCH_ALARM,
        severity: 'CRITICAL',
        fingerprint: `${INVENTORY_MISMATCH_ALARM}|${chargePoint.identity}|boot`,
        details: evidence,
      });
      this.logger.warn(
        { chargeBoxId: chargePoint.identity, evidence },
        'BootNotification rechazado: inventario',
      );
    } else if (mismatch) {
      await raiseAlarm(this.sql, {
        tenantId: chargePoint.tenantId,
        chargePointId: chargePoint.id,
        siteId: current.site_id,
        kind: INVENTORY_MISMATCH_ALARM,
        severity: 'WARNING',
        fingerprint: `${INVENTORY_MISMATCH_ALARM}|${chargePoint.identity}|boot`,
        details: evidence,
      });
    }
    await this.sql`
      UPDATE assets.charge_point SET registration_status = ${bootNotificationStatusFor(lifecycle)}
      WHERE id = ${chargePoint.id}`;
    return { lifecycle, inventoryMismatch: mismatch };
  }

  async statusNotification(info: StatusInfo): Promise<{ known: boolean }> {
    const { chargePoint, params, at } = info;
    const connectorId = Number(params.connectorId);
    const status = String(params.status);
    const errorCode = String(params.errorCode ?? 'NoError');
    const statusAtCp = typeof params.timestamp === 'string' ? new Date(params.timestamp) : null;
    const validStatusAt = statusAtCp && !Number.isNaN(statusAtCp.getTime()) ? statusAtCp : null;
    if (connectorId === 0) {
      await this.sql`
        UPDATE assets.charge_point
        SET cp_status = ${status}::assets.ocpp_status, cp_error_code = ${errorCode}::assets.error_code,
            last_seen_at = ${at}, updated_at = now()
        WHERE id = ${chargePoint.id}`;
      return { known: true };
    }
    const result = await this.sql`
      UPDATE assets.connector SET
        ocpp_status = ${status}::assets.ocpp_status, error_code = ${errorCode}::assets.error_code,
        vendor_error_code = ${normalize(params.vendorErrorCode)}, status_info = ${normalize(params.info)},
        status_at_cp = ${validStatusAt}, status_received_at = ${at}, status_seq = status_seq + 1
      WHERE charge_point_id = ${chargePoint.id} AND ocpp_connector_id = ${connectorId}`;
    if (result.count === 0) {
      this.logger.warn(
        { chargeBoxId: chargePoint.identity, connectorId },
        'StatusNotification de un conector no inventariado',
      );
      return { known: false };
    }
    return { known: true };
  }

  async seen(chargePoint: RegisteredChargePoint, at: Date): Promise<void> {
    await this.sql`
      UPDATE assets.charge_point SET last_seen_at = ${at}
      WHERE id = ${chargePoint.id} AND (last_seen_at IS NULL OR last_seen_at < ${at})`;
  }

  logMessage(entry: MessageLogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= (this.options.logBatchSize ?? 200)) {
      void this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), this.options.logFlushMs ?? 1000);
      this.flushTimer.unref();
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    const rows = batch.map((entry) => {
      const payload =
        entry.sizeBytes > MAX_LOGGED_PAYLOAD_BYTES
          ? { truncated: true, sizeBytes: entry.sizeBytes }
          : maskSensitive(entry.payload);
      return {
        ts: entry.ts.toISOString(),
        tenant_id: entry.tenantId,
        charge_box_id: entry.chargeBoxId,
        direction: entry.direction,
        message_type: entry.messageType,
        unique_id: entry.uniqueId.slice(0, 36),
        action: entry.action ?? null,
        payload: payload === undefined ? null : payload,
        error_code: entry.errorCode ?? null,
        error_description: entry.errorDescription?.slice(0, 500) ?? null,
        size_bytes: entry.sizeBytes,
        pod: entry.pod,
        connection_generation: entry.generation,
      };
    });
    try {
      await this.sql`
        INSERT INTO ops.ocpp_message_log
          (ts, tenant_id, charge_box_id, direction, message_type, unique_id, action, payload,
           error_code, error_description, size_bytes, pod, connection_generation)
        SELECT r.ts::timestamptz, NULLIF(r.tenant_id, '')::uuid, r.charge_box_id, r.direction, r.message_type,
               r.unique_id, r.action, r.payload, r.error_code, r.error_description, r.size_bytes, r.pod,
               r.connection_generation
        FROM jsonb_to_recordset(${toJson(this.sql, rows)}::jsonb) AS r(
          ts text, tenant_id text, charge_box_id text, direction text, message_type smallint,
          unique_id text, action text, payload jsonb, error_code text, error_description text,
          size_bytes integer, pod text, connection_generation bigint)`;
    } catch (error) {
      this.logger.error({ err: error, rows: rows.length }, 'no se pudo escribir el log OCPP');
    }
  }
}
