import type { ConnectionDirectory, ConnectionRecord } from './directory.ts';

/**
 * Códigos de error de la API interna del gateway (equivalentes a los gRPC de ARQ §6.3):
 * NOT_CONNECTED (el pod no tiene ese cargador), TIMEOUT (sin CALLRESULT en el plazo),
 * UNAVAILABLE (pod inalcanzable), QUEUE_FULL (cola de salida llena), INVALID_REQUEST (payload
 * no válido según el esquema), INVALID_RESPONSE (respuesta del cargador no válida),
 * CALL_ERROR (el cargador respondió CALLERROR), UNAUTHORIZED (token interno incorrecto).
 */
export type GatewayErrorCode =
  | 'NOT_CONNECTED'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'QUEUE_FULL'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'CALL_ERROR'
  | 'UNAUTHORIZED'
  | 'INTERNAL';

export interface GatewayCallError {
  code: GatewayErrorCode;
  /** errorCode OCPP-J cuando `code` es CALL_ERROR (NotSupported, GenericError, ...). */
  ocppErrorCode?: string;
  description: string;
  details?: unknown;
}

export type CallOutcome =
  | { ok: true; uniqueId: string; result: Record<string, unknown>; rttMs: number; podId: string }
  | { ok: false; uniqueId?: string; error: GatewayCallError; podId?: string };

export interface SendCallInput {
  chargeBoxId: string;
  action: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
}

export interface ConnectionInfo {
  chargeBoxId: string;
  connected: boolean;
  podId?: string;
  protocol?: string;
  connectedAt?: string;
  lastSeenAt?: string;
  pendingCalls?: number;
  messagesIn?: number;
  generation?: number;
}

export interface GatewayClientOptions {
  directory: ConnectionDirectory;
  /** Token compartido de la API interna (OCPP_GATEWAY_INTERNAL_TOKEN). */
  token: string;
  fetchImpl?: typeof fetch;
  /** Espera antes del único reintento tras UNAVAILABLE o NOT_CONNECTED (ARQ §4.3, regla 6). */
  retryDelayMs?: number;
}

const HTTP_STATUS_TO_CODE: Record<number, GatewayErrorCode> = {
  400: 'INVALID_REQUEST',
  401: 'UNAUTHORIZED',
  404: 'NOT_CONNECTED',
  422: 'INVALID_RESPONSE',
  429: 'QUEUE_FULL',
  502: 'CALL_ERROR',
  504: 'TIMEOUT',
};

/** Cliente de la API interna del gateway: localiza el pod en el directorio y envía la CALL. */
export class GatewayClient {
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelayMs: number;

  constructor(private readonly options: GatewayClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retryDelayMs = options.retryDelayMs ?? 500;
  }

  async sendCall(input: SendCallInput): Promise<CallOutcome> {
    const first = await this.attempt(input);
    if (first.ok || (first.error.code !== 'UNAVAILABLE' && first.error.code !== 'NOT_CONNECTED')) {
      return first;
    }
    await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
    return this.attempt(input);
  }

  private async attempt(input: SendCallInput): Promise<CallOutcome> {
    const record = await this.options.directory.lookup(input.chargeBoxId);
    if (!record) {
      return {
        ok: false,
        error: { code: 'NOT_CONNECTED', description: 'El cargador no está conectado a ningún pod' },
      };
    }
    const timeoutMs = input.timeoutMs ?? 10_000;
    let response: Response;
    try {
      response = await this.fetchImpl(`${record.internalUrl}/internal/v1/calls`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          chargeBoxId: input.chargeBoxId,
          action: input.action,
          payload: input.payload,
          timeoutMs,
        }),
        signal: AbortSignal.timeout(timeoutMs + 5000),
      });
    } catch (error) {
      return {
        ok: false,
        podId: record.podId,
        error: {
          code: 'UNAVAILABLE',
          description: `Pod ${record.podId} inalcanzable: ${(error as Error).message}`,
        },
      };
    }
    const body = (await response.json().catch(() => ({}))) as {
      uniqueId?: string;
      result?: Record<string, unknown>;
      rttMs?: number;
      error?: { code?: string; ocppErrorCode?: string; description?: string; details?: unknown };
    };
    if (response.ok && body.result !== undefined) {
      return {
        ok: true,
        uniqueId: body.uniqueId ?? '',
        result: body.result,
        rttMs: body.rttMs ?? 0,
        podId: record.podId,
      };
    }
    const code = HTTP_STATUS_TO_CODE[response.status] ?? 'INTERNAL';
    return {
      ok: false,
      podId: record.podId,
      ...(body.uniqueId ? { uniqueId: body.uniqueId } : {}),
      error: {
        code,
        ...(body.error?.ocppErrorCode ? { ocppErrorCode: body.error.ocppErrorCode } : {}),
        description: body.error?.description ?? `HTTP ${response.status} del gateway`,
        ...(body.error?.details !== undefined ? { details: body.error.details } : {}),
      },
    };
  }

  async getConnection(chargeBoxId: string): Promise<ConnectionInfo> {
    const record = await this.options.directory.lookup(chargeBoxId);
    if (!record) return { chargeBoxId, connected: false };
    try {
      const response = await this.fetchImpl(
        `${record.internalUrl}/internal/v1/connections/${encodeURIComponent(chargeBoxId)}`,
        { headers: this.headers(), signal: AbortSignal.timeout(5000) },
      );
      if (response.status === 404) return { chargeBoxId, connected: false, podId: record.podId };
      if (!response.ok) return { chargeBoxId, connected: false, podId: record.podId };
      return (await response.json()) as ConnectionInfo;
    } catch {
      return { chargeBoxId, connected: false, podId: record.podId };
    }
  }

  async disconnect(
    chargeBoxId: string,
    code = 1008,
    reason = 'Administrative close',
  ): Promise<boolean> {
    const record = await this.options.directory.lookup(chargeBoxId);
    if (!record) return false;
    try {
      const response = await this.fetchImpl(
        `${record.internalUrl}/internal/v1/connections/${encodeURIComponent(chargeBoxId)}/disconnect`,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ code, reason }),
          signal: AbortSignal.timeout(5000),
        },
      );
      return response.status === 204;
    } catch {
      return false;
    }
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.options.token}`,
    };
  }
}

export type { ConnectionRecord };
