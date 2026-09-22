import { randomUUID } from 'node:crypto';
import { HIGH_PRIORITY_ACTIONS } from '@volt/domain';
import { ulid } from '@volt/events';
import type { CallOutcome, SendCallInput } from '@volt/gateway-client';
import { validateRequest } from '@volt/ocpp-schemas';
import type { Sql } from 'postgres';
import { ValidationError } from './errors.ts';
import { getChargePoint } from './inventory.ts';
import type { CsmsLogger } from './types.ts';
import { silentLogger, toJson } from './types.ts';

/** Comandos CSMS → cargador disponibles en esta iteración (FUN M11, OPS §1). */
export const REMOTE_ACTIONS = [
  'GetConfiguration',
  'ChangeConfiguration',
  'Reset',
  'TriggerMessage',
  'ChangeAvailability',
  'UnlockConnector',
  'ClearCache',
  'RemoteStartTransaction',
  'RemoteStopTransaction',
] as const;
export type RemoteAction = (typeof REMOTE_ACTIONS)[number];

export function isRemoteAction(value: unknown): value is RemoteAction {
  return typeof value === 'string' && (REMOTE_ACTIONS as readonly string[]).includes(value);
}

/** Plazos de espera del CALLRESULT por acción (ARQ §4.3): 10 s salvo Reset (30 s). */
export function defaultTimeoutMs(action: RemoteAction): number {
  return action === 'Reset' ? 30_000 : 10_000;
}

const ACCEPTED_STATUSES = new Set(['Accepted', 'Scheduled', 'Unlocked']);

/** Lo que el servicio necesita del gateway (lo cumple `GatewayClient` y cualquier doble de prueba). */
export interface GatewaySender {
  sendCall(input: SendCallInput): Promise<CallOutcome>;
}

export interface SendCommandInput {
  chargePointId: string;
  action: RemoteAction;
  payload: Record<string, unknown>;
  /** `staff:<id>` | `driver:<id>` | `system:<job>` */
  requestedBy: string;
  timeoutMs?: number;
  correlationId?: string;
}

export interface CommandRow {
  id: string;
  tenant_id: string;
  charge_point_id: string;
  action: string;
  payload: Record<string, unknown>;
  unique_id: string;
  state: 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'ERROR' | 'TIMEOUT' | 'CANCELLED';
  priority: number;
  attempts: number;
  timeout_ms: number;
  expected_generation: bigint | null;
  requested_by: string;
  correlation_id: string | null;
  requested_at: Date;
  sent_at: Date | null;
  responded_at: Date | null;
  response: Record<string, unknown> | null;
  result_status: string | null;
  error_code: string | null;
  error_description: string | null;
}

export interface CommandResult {
  command: CommandRow;
  outcome: CallOutcome;
}

/**
 * Envía un comando OCPP al cargador a través del gateway y lo deja registrado en `ops.command`
 * (PENDING → SENT → ACCEPTED | REJECTED | ERROR | TIMEOUT; CANCELLED si nunca salió).
 */
export class CommandService {
  private readonly logger: CsmsLogger;

  constructor(
    private readonly sql: Sql,
    private readonly gateway: GatewaySender,
    options: { logger?: CsmsLogger } = {},
  ) {
    this.logger = options.logger ?? silentLogger;
  }

  async send(input: SendCommandInput): Promise<CommandResult> {
    if (!isRemoteAction(input.action)) {
      throw new ValidationError(`Acción no permitida: ${String(input.action)}`);
    }
    const validation = validateRequest(input.action, input.payload);
    if (!validation.ok) {
      throw new ValidationError(
        `Payload de ${input.action} inválido según OCPP 1.6`,
        validation.errors,
      );
    }
    const chargePoint = await getChargePoint(this.sql, input.chargePointId);
    const id = randomUUID();
    const provisionalUniqueId = ulid();
    const timeoutMs = input.timeoutMs ?? defaultTimeoutMs(input.action);
    const priority = (HIGH_PRIORITY_ACTIONS as readonly string[]).includes(input.action) ? 1 : 5;
    await this.sql`
      INSERT INTO ops.command (id, tenant_id, charge_point_id, action, payload, unique_id, state, priority,
                               timeout_ms, expected_generation, requested_by, correlation_id, timeout_at)
      VALUES (${id}, ${chargePoint.tenant_id}, ${chargePoint.id}, ${input.action}, ${toJson(this.sql, input.payload)},
              ${provisionalUniqueId}, 'PENDING', ${priority}, ${timeoutMs}, ${chargePoint.connection_generation.toString()}::bigint,
              ${input.requestedBy}, ${input.correlationId ?? null},
              now() + make_interval(secs => ${timeoutMs / 1000}))`;

    const outcome = await this.gateway.sendCall({
      chargeBoxId: chargePoint.charge_box_id,
      action: input.action,
      payload: input.payload,
      timeoutMs,
    });

    // El uniqueId del CALL lo genera el gateway (ADR 0013); si por cualquier motivo se repitiera para
    // este cargador, se conserva el provisional en lugar de perder el registro del comando.
    const wireId = outcome.uniqueId || provisionalUniqueId;
    const collision = await this.sql`
      SELECT 1 FROM ops.command WHERE charge_point_id = ${chargePoint.id} AND unique_id = ${wireId} AND id <> ${id}`;
    const uniqueId = collision.length > 0 ? provisionalUniqueId : wireId;
    if (outcome.ok) {
      const resultStatus =
        typeof outcome.result.status === 'string' ? (outcome.result.status as string) : null;
      const state =
        resultStatus === null || ACCEPTED_STATUSES.has(resultStatus) ? 'ACCEPTED' : 'REJECTED';
      await this.sql`
        UPDATE ops.command SET state = ${state}, unique_id = ${uniqueId}, attempts = 1, sent_at = now(),
               responded_at = now(), response = ${toJson(this.sql, outcome.result)}, result_status = ${resultStatus}
        WHERE id = ${id}`;
    } else {
      const wasSent = ['TIMEOUT', 'CALL_ERROR', 'INVALID_RESPONSE'].includes(outcome.error.code);
      const state = outcome.error.code === 'TIMEOUT' ? 'TIMEOUT' : wasSent ? 'ERROR' : 'CANCELLED';
      await this.sql`
        UPDATE ops.command SET state = ${state}, unique_id = ${uniqueId}, attempts = ${wasSent ? 1 : 0},
               sent_at = CASE WHEN ${wasSent} THEN now() ELSE NULL END, responded_at = now(),
               error_code = ${outcome.error.ocppErrorCode ?? outcome.error.code},
               error_description = ${outcome.error.description.slice(0, 500)},
               response = ${outcome.error.details === undefined ? null : toJson(this.sql, outcome.error.details)}
        WHERE id = ${id}`;
      this.logger.warn(
        {
          commandId: id,
          action: input.action,
          chargeBoxId: chargePoint.charge_box_id,
          error: outcome.error,
        },
        'comando sin resultado',
      );
    }
    const command = await this.get(id);
    return { command, outcome };
  }

  async get(id: string): Promise<CommandRow> {
    const rows = await this.sql<CommandRow[]>`SELECT * FROM ops.command WHERE id = ${id}`;
    const row = rows[0];
    if (!row) throw new Error(`comando ${id} no encontrado`);
    return row;
  }

  async list(chargePointId: string, limit = 50): Promise<CommandRow[]> {
    return this.sql<CommandRow[]>`
      SELECT * FROM ops.command WHERE charge_point_id = ${chargePointId}
      ORDER BY requested_at DESC LIMIT ${limit}`;
  }
}
