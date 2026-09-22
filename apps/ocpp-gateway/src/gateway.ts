import { EventEmitter } from 'node:events';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  bootNotificationStatusFor,
  isChargePointStatus,
  isExpectedTransition,
  REJECTED_BOOT_INTERVAL_SECONDS,
} from '@volt/domain';
import { createEnvelope, type EventEnvelope } from '@volt/events';
import type { ConnectionDirectory } from '@volt/gateway-client';
import {
  isCentralSystemInitiated,
  isChargePointInitiated,
  isKnownAction,
  validateRequest,
  validateResponse,
} from '@volt/ocpp-schemas';
import { createRPCError, type IHandlersOption, type RPCClient, RPCServer } from 'ocpp-rpc';
import type { Logger } from 'pino';
import type { GatewayConfig } from './config.ts';
import { ConnectionRegistry, type LiveConnection } from './connections.ts';
import { InternalApi, type InternalCallRequest, type InternalResponse } from './internal-api.ts';
import { type GatewayPersistence, MemoryPersistence, type MessageLogEntry } from './persistence.ts';
import type { ChargePointRegistry, RegisteredChargePoint } from './registry.ts';

export const OCPP16_SUBPROTOCOL = 'ocpp1.6';

/** Código de cierre WebSocket "Service Restart" usado al drenar (OPS §4.8). */
export const CLOSE_CODE_SERVICE_RESTART = 1012;
/** Código de cierre "Policy Violation" para sockets desalojados o cerrados por administración. */
export const CLOSE_CODE_POLICY_VIOLATION = 1008;

/** Mientras el cargador no está aceptado solo puede hablar de registro y estado (SEG §2.5). */
const PENDING_ALLOWED_ACTIONS = new Set([
  'BootNotification',
  'Heartbeat',
  'StatusNotification',
  'DataTransfer',
]);

export interface DirectoryWithEviction extends ConnectionDirectory {
  publishEviction?(podId: string, chargeBoxId: string): Promise<number>;
}

export interface EvictionSource {
  subscribe(podId: string, handler: (chargeBoxId: string) => void): Promise<void>;
  close(): Promise<void>;
}

export interface GatewayDependencies {
  config: GatewayConfig;
  registry: ChargePointRegistry;
  logger: Logger;
  clock?: () => Date;
  persistence?: GatewayPersistence;
  directory?: DirectoryWithEviction;
  evictions?: EvictionSource;
}

export interface GatewayAddresses {
  ocppPort: number;
  healthPort: number;
  internalPort: number;
  internalUrl: string;
}

interface Counters {
  callsIn: number;
  callsRejected: number;
  authRejected: number;
  callsOut: number;
  callsOutFailed: number;
}

type Handler = (
  params: Record<string, unknown>,
  messageId: string,
) => Promise<Record<string, unknown>>;

interface SessionData {
  chargePoint: RegisteredChargePoint;
  remoteAddress?: string;
}

/**
 * Servidor OCPP-J 1.6. Autentica en el handshake (allowlist + Basic Auth), valida cada mensaje
 * contra los esquemas oficiales, atiende el perfil Core mínimo, persiste conectividad, arranques
 * y estados, publica la conexión en el directorio compartido y ejecuta los comandos que llegan por
 * la API interna. Las transacciones llegan en la iteración 3.
 */
export class Gateway extends EventEmitter<{ event: [EventEnvelope] }> {
  readonly connections = new ConnectionRegistry();
  private readonly counters: Counters = {
    callsIn: 0,
    callsRejected: 0,
    authRejected: 0,
    callsOut: 0,
    callsOutFailed: 0,
  };
  private readonly lastStatus = new Map<string, string>();
  private readonly outboundIds = new WeakMap<object, (id: string) => void>();
  private readonly rpc: RPCServer;
  private readonly persistence: GatewayPersistence;
  private readonly internalApi: InternalApi;
  private healthServer: Server | undefined;
  private ocppServer: Server | undefined;
  private internalUrl = '';
  private draining = false;
  private readonly startedAt: Date;
  private readonly now: () => Date;

  constructor(private readonly deps: GatewayDependencies) {
    super();
    this.now = deps.clock ?? (() => new Date());
    this.startedAt = this.now();
    this.persistence = deps.persistence ?? new MemoryPersistence();
    this.internalApi = new InternalApi(
      {
        sendCall: (request) => this.sendCall(request),
        connectionInfo: (chargeBoxId) => this.connectionInfo(chargeBoxId),
        disconnect: (chargeBoxId, code, reason) => this.disconnect(chargeBoxId, code, reason),
      },
      deps.config.OCPP_GATEWAY_INTERNAL_TOKEN,
      deps.logger,
    );
    this.rpc = new RPCServer({
      protocols: [OCPP16_SUBPROTOCOL],
      strictMode: false,
      pingIntervalMs: deps.config.OCPP_PING_INTERVAL_S * 1000,
      callTimeoutMs: deps.config.OCPP_CALL_TIMEOUT_MS,
      respondWithDetailedErrors: deps.config.NODE_ENV !== 'production',
      maxBadMessages: 5,
    });
    this.rpc.auth((accept, reject, handshake) => {
      const forwarded = handshake.headers['x-forwarded-for'];
      const remoteAddress =
        (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined) ??
        handshake.remoteAddress;
      void this.authenticate(
        handshake.identity,
        handshake.endpoint,
        handshake.headers.authorization,
        handshake.password,
        remoteAddress,
      )
        .then((chargePoint) => {
          if (chargePoint) {
            const session: SessionData = {
              chargePoint,
              ...(remoteAddress ? { remoteAddress } : {}),
            };
            accept(session, OCPP16_SUBPROTOCOL);
          } else reject(401, 'Unauthorized');
        })
        .catch((error: unknown) => {
          this.deps.logger.error(
            { err: error, identity: handshake.identity },
            'error autenticando',
          );
          reject(500, 'Internal error');
        });
    });
    this.rpc.on('client', (client: RPCClient & { session: SessionData }) => {
      this.onClient(client, client.session);
    });
  }

  get podId(): string {
    return this.deps.config.OCPP_GATEWAY_POD_ID;
  }

  /** Solo se aceptan cargadores dados de alta cuyo usuario Basic Auth coincide con su identidad. */
  private async authenticate(
    identity: string,
    endpoint: string,
    authorization: string | undefined,
    password: Buffer | undefined,
    remoteAddress: string | undefined,
  ): Promise<RegisteredChargePoint | undefined> {
    const prefix = this.deps.config.OCPP_GATEWAY_PATH_PREFIX;
    const normalized = endpoint.replace(/\/+$/, '');
    if (normalized !== prefix) {
      this.counters.authRejected += 1;
      this.deps.logger.warn({ identity, endpoint, remoteAddress }, 'ruta no permitida');
      return undefined;
    }
    if (this.draining) return undefined;
    const username = basicAuthUsername(authorization);
    if (username !== identity) {
      this.counters.authRejected += 1;
      this.deps.logger.warn(
        { identity, remoteAddress },
        'usuario Basic Auth distinto de la identidad',
      );
      return undefined;
    }
    const chargePoint = await this.deps.registry.authenticate(identity, password, {
      ...(remoteAddress ? { remoteAddress } : {}),
    });
    if (!chargePoint) {
      this.counters.authRejected += 1;
      this.deps.logger.warn(
        { identity, remoteAddress },
        'cargador desconocido o credencial inválida',
      );
    }
    return chargePoint;
  }

  private onClient(client: RPCClient, session: SessionData): void {
    const { chargePoint } = session;
    const log = this.deps.logger.child({
      chargeBoxId: chargePoint.identity,
      tenantId: chargePoint.tenantId,
    });
    const now = this.now();
    const previous = this.connections.register(chargePoint, client, now);
    const connection = this.connections.get(chargePoint.identity) as LiveConnection;
    if (previous) {
      log.warn('conexión duplicada: se cierra la anterior');
      this.stopRefresh(previous);
      void previous.client.close({
        code: 1000,
        reason: 'Replaced by a newer connection',
        awaitPending: false,
      });
      void this.closeInPersistence(previous, 1000, 'Replaced by a newer connection');
    }
    connection.opened = this.openInPersistence(connection, session, log);
    log.info(
      {
        lifecycle: chargePoint.lifecycle,
        connections: this.connections.size,
        remoteAddress: session.remoteAddress,
      },
      'cargador conectado',
    );
    this.publish('charger.connected', chargePoint, 'charge_point', chargePoint.identity, {
      lifecycle: chargePoint.lifecycle,
      replacedPrevious: previous !== undefined,
      podId: this.podId,
    });

    client.on('call', (event: { outbound: boolean; payload: unknown[] }) => {
      if (!event.outbound) return;
      const params = event.payload[3];
      const resolve =
        typeof params === 'object' && params ? this.outboundIds.get(params) : undefined;
      if (resolve) resolve(String(event.payload[1]));
    });
    client.on('message', (event: { message: string | Buffer; outbound: boolean }) => {
      this.logRaw(connection, event.message, event.outbound);
    });

    const handlers: Record<string, Handler> = {
      BootNotification: async (params, messageId) => {
        const outcome = await this.persistence.bootNotification({
          chargePoint: connection.chargePoint,
          params,
          uniqueId: messageId,
          at: this.now(),
          heartbeatIntervalS: this.deps.config.OCPP_HEARTBEAT_INTERVAL_S,
        });
        connection.chargePoint = { ...connection.chargePoint, lifecycle: outcome.lifecycle };
        const status = bootNotificationStatusFor(outcome.lifecycle);
        const interval =
          status === 'Accepted'
            ? this.deps.config.OCPP_HEARTBEAT_INTERVAL_S
            : status === 'Pending'
              ? this.deps.config.OCPP_PENDING_RETRY_S
              : REJECTED_BOOT_INTERVAL_SECONDS;
        log.info(
          {
            status,
            lifecycle: outcome.lifecycle,
            vendor: params.chargePointVendor,
            model: params.chargePointModel,
            inventoryMismatch: outcome.inventoryMismatch,
          },
          'BootNotification',
        );
        this.publish(
          'charger.booted',
          connection.chargePoint,
          'charge_point',
          chargePoint.identity,
          {
            status,
            lifecycle: outcome.lifecycle,
            inventoryMismatch: outcome.inventoryMismatch,
            vendor: params.chargePointVendor,
            model: params.chargePointModel,
            serialNumber: params.chargePointSerialNumber,
            firmwareVersion: params.firmwareVersion,
            meterSerialNumber: params.meterSerialNumber,
            uniqueId: messageId,
          },
        );
        return { status, currentTime: this.now().toISOString(), interval };
      },
      Heartbeat: async () => ({ currentTime: this.now().toISOString() }),
      StatusNotification: async (params) => {
        const connectorId = Number(params.connectorId);
        const status = params.status;
        if (!isChargePointStatus(status)) return {};
        const key = `${chargePoint.identity}:${connectorId}`;
        const previousStatus = this.lastStatus.get(key);
        const expected =
          previousStatus && isChargePointStatus(previousStatus)
            ? isExpectedTransition(previousStatus, status)
            : true;
        this.lastStatus.set(key, status);
        if (!expected) {
          log.warn(
            { connectorId, from: previousStatus, to: status },
            'transición de estado no prevista',
          );
        }
        const persisted = await this.persistence.statusNotification({
          chargePoint: connection.chargePoint,
          params,
          at: this.now(),
        });
        this.publish('connector.status.changed', connection.chargePoint, 'connector', key, {
          connectorId,
          status,
          errorCode: params.errorCode,
          info: params.info,
          vendorErrorCode: params.vendorErrorCode,
          statusAtChargePoint: params.timestamp ?? null,
          previousStatus: previousStatus ?? null,
          expectedTransition: expected,
          inventoried: persisted.known,
        });
        return {};
      },
      DataTransfer: async (params) => {
        log.info(
          { vendorId: params.vendorId, messageId: params.messageId },
          'DataTransfer no soportado',
        );
        return { status: 'UnknownVendorId' };
      },
      // Sin tokens emitidos todavía, ninguna autorización local es válida (SEG S4).
      Authorize: async (params) => {
        log.info(
          { idTag: params.idTag },
          'Authorize rechazado: autorización pendiente de la iteración 3',
        );
        return { idTagInfo: { status: 'Invalid' } };
      },
    };

    client.handle(async ({ method, params, messageId }: IHandlersOption) => {
      const action = method ?? '';
      this.counters.callsIn += 1;
      this.touch(connection);
      if (!isKnownAction(action) || !isChargePointInitiated(action)) {
        this.counters.callsRejected += 1;
        log.warn({ action }, 'acción no implementada o no permitida desde el cargador');
        throw createRPCError('NotImplemented', `Acción no soportada: ${action}`);
      }
      const validation = validateRequest(action, params);
      if (!validation.ok) {
        this.counters.callsRejected += 1;
        log.warn({ action, errors: validation.errors }, 'payload inválido');
        throw createRPCError('FormationViolation', 'Payload inválido según el esquema OCPP 1.6', {
          errors: validation.errors,
        });
      }
      if (
        bootNotificationStatusFor(connection.chargePoint.lifecycle) !== 'Accepted' &&
        !PENDING_ALLOWED_ACTIONS.has(action)
      ) {
        this.counters.callsRejected += 1;
        log.warn(
          { action, lifecycle: connection.chargePoint.lifecycle },
          'acción no permitida antes de aceptar el cargador',
        );
        throw createRPCError(
          'SecurityError',
          'El cargador aún no está aceptado por el sistema central',
        );
      }
      const handler = handlers[action];
      if (!handler) {
        this.counters.callsRejected += 1;
        log.warn({ action }, 'acción válida pero aún no implementada');
        throw createRPCError('NotImplemented', `Acción pendiente de implementación: ${action}`);
      }
      return handler((params ?? {}) as Record<string, unknown>, messageId ?? '');
    });

    client.on('close', (event: { code?: number; reason?: string } = {}) => {
      const current = this.connections.unregister(chargePoint.identity, client);
      if (!current) return;
      this.stopRefresh(current);
      log.info(
        { code: event.code, reason: event.reason, connections: this.connections.size },
        'cargador desconectado',
      );
      void this.closeInPersistence(current, event.code, event.reason).then(() =>
        this.deps.directory
          ?.unregister(chargePoint.identity, this.podId)
          .catch((error: unknown) => {
            log.error({ err: error }, 'no se pudo borrar la conexión del directorio');
          }),
      );
      this.publish(
        'charger.disconnected',
        current.chargePoint,
        'charge_point',
        chargePoint.identity,
        {
          code: event.code ?? null,
          reason: event.reason ?? null,
          generation: current.generation,
        },
      );
    });
  }

  private async openInPersistence(
    connection: LiveConnection,
    session: SessionData,
    log: Logger,
  ): Promise<void> {
    try {
      const { generation } = await this.persistence.connectionOpened({
        chargePoint: connection.chargePoint,
        podId: this.podId,
        ...(session.remoteAddress ? { remoteAddress: session.remoteAddress } : {}),
        protocol: OCPP16_SUBPROTOCOL,
        at: connection.connectedAt,
      });
      connection.generation = generation;
    } catch (error) {
      log.error({ err: error }, 'no se pudo persistir la conexión');
    }
    const directory = this.deps.directory;
    if (!directory) return;
    try {
      const { previousPodId } = await directory.register(
        {
          chargeBoxId: connection.identity,
          podId: this.podId,
          internalUrl: this.internalUrl,
          protocol: OCPP16_SUBPROTOCOL,
          connectedAt: connection.connectedAt.toISOString(),
          generation: connection.generation,
        },
        this.deps.config.OCPP_CONN_TTL_MS,
      );
      if (previousPodId && previousPodId !== this.podId && directory.publishEviction) {
        log.warn({ previousPodId }, 'el cargador estaba en otro pod: se pide desalojo');
        await directory.publishEviction(previousPodId, connection.identity);
      }
      if (this.connections.get(connection.identity) === connection) {
        connection.refreshTimer = setInterval(() => {
          void directory
            .refresh(connection.identity, this.podId, this.deps.config.OCPP_CONN_TTL_MS)
            .catch((error: unknown) =>
              log.error({ err: error }, 'no se pudo refrescar el directorio'),
            );
        }, this.deps.config.OCPP_CONN_REFRESH_MS);
        connection.refreshTimer.unref();
      }
    } catch (error) {
      log.error({ err: error }, 'no se pudo publicar la conexión en el directorio');
    }
  }

  private async closeInPersistence(
    connection: LiveConnection,
    code: number | undefined,
    reason: string | undefined,
  ): Promise<void> {
    try {
      await connection.opened;
      await this.persistence.connectionClosed({
        chargePoint: connection.chargePoint,
        generation: connection.generation,
        ...(code !== undefined ? { code } : {}),
        ...(reason !== undefined ? { reason } : {}),
        at: this.now(),
        messagesIn: connection.messagesIn,
        messagesOut: connection.messagesOut,
      });
    } catch (error) {
      this.deps.logger.error(
        { err: error, chargeBoxId: connection.identity },
        'no se pudo persistir el cierre',
      );
    }
  }

  private stopRefresh(connection: LiveConnection): void {
    if (connection.refreshTimer) {
      clearInterval(connection.refreshTimer);
      connection.refreshTimer = undefined;
    }
  }

  /** Cualquier mensaje cuenta como señal de vida (FUN M02); se escribe con un mínimo entre escrituras. */
  private touch(connection: LiveConnection): void {
    const now = this.now();
    this.connections.touch(connection.identity, now);
    const minMs = this.deps.config.OCPP_SEEN_WRITE_INTERVAL_S * 1000;
    if (now.getTime() - connection.lastSeenPersistedAt.getTime() >= minMs) {
      connection.lastSeenPersistedAt = now;
      void this.persistence.seen(connection.chargePoint, now).catch((error: unknown) => {
        this.deps.logger.error(
          { err: error, chargeBoxId: connection.identity },
          'no se pudo actualizar last_seen_at',
        );
      });
    }
  }

  private logRaw(connection: LiveConnection, message: string | Buffer, outbound: boolean): void {
    const text = typeof message === 'string' ? message : message.toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    const [type, id, third, fourth, fifth] = parsed as unknown[];
    if (type !== 2 && type !== 3 && type !== 4) return;
    const uniqueId = String(id);
    const entry: MessageLogEntry = {
      ts: this.now(),
      tenantId: connection.chargePoint.tenantId,
      chargeBoxId: connection.identity,
      direction: outbound ? 'CS2CP' : 'CP2CS',
      messageType: type,
      uniqueId,
      sizeBytes: Buffer.byteLength(text),
      pod: this.podId,
      generation: connection.generation,
    };
    if (type === 2) {
      entry.action = String(third);
      entry.payload = fourth;
      connection.recentActions.set(uniqueId, entry.action);
      if (connection.recentActions.size > 200) {
        const oldest = connection.recentActions.keys().next().value;
        if (oldest !== undefined) connection.recentActions.delete(oldest);
      }
    } else {
      const action = connection.recentActions.get(uniqueId);
      if (action) entry.action = action;
      if (type === 3) entry.payload = third;
      else {
        entry.errorCode = String(third);
        entry.errorDescription = String(fourth ?? '');
        entry.payload = fifth;
      }
    }
    if (outbound) connection.messagesOut += 1;
    this.persistence.logMessage(entry);
  }

  /** Envía una CALL a un cargador conectado a este pod (API interna, ADR 0013). */
  async sendCall(request: InternalCallRequest): Promise<InternalResponse> {
    const connection = this.connections.get(request.chargeBoxId);
    if (!connection) {
      return {
        status: 404,
        body: {
          error: { code: 'NOT_CONNECTED', description: 'El cargador no está conectado a este pod' },
        },
      };
    }
    if (!isKnownAction(request.action) || !isCentralSystemInitiated(request.action)) {
      return {
        status: 400,
        body: {
          error: {
            code: 'INVALID_REQUEST',
            description: `Acción no iniciable por el sistema central: ${request.action}`,
          },
        },
      };
    }
    const validation = validateRequest(request.action, request.payload);
    if (!validation.ok) {
      return {
        status: 400,
        body: {
          error: {
            code: 'INVALID_REQUEST',
            description: 'Payload inválido según el esquema OCPP 1.6',
            details: validation.errors,
          },
        },
      };
    }
    if (connection.pendingCalls >= this.deps.config.OCPP_CALL_QUEUE_MAX) {
      return {
        status: 429,
        body: {
          error: {
            code: 'QUEUE_FULL',
            description: 'Demasiadas CALL pendientes para este cargador',
          },
        },
      };
    }
    const timeoutMs = Math.min(request.timeoutMs ?? this.deps.config.OCPP_CALL_TIMEOUT_MS, 120_000);
    const params = { ...request.payload };
    let uniqueId = '';
    this.outboundIds.set(params, (id) => {
      uniqueId = id;
    });
    connection.pendingCalls += 1;
    this.counters.callsOut += 1;
    const started = Date.now();
    try {
      const result = await connection.client.call(request.action, params, {
        callTimeoutMs: timeoutMs,
      });
      const rttMs = Date.now() - started;
      const responseValidation = validateResponse(request.action, result);
      if (!responseValidation.ok) {
        this.counters.callsOutFailed += 1;
        return {
          status: 422,
          body: {
            uniqueId,
            error: {
              code: 'INVALID_RESPONSE',
              description: 'La respuesta del cargador no cumple el esquema',
              details: responseValidation.errors,
            },
          },
        };
      }
      return { status: 200, body: { uniqueId, result, rttMs } };
    } catch (error) {
      this.counters.callsOutFailed += 1;
      // ocpp-rpc exporta sus clases de error con spread (CJS): no son importables por nombre en ESM.
      if (error instanceof Error && error.constructor.name === 'TimeoutError') {
        return {
          status: 504,
          body: {
            uniqueId,
            error: { code: 'TIMEOUT', description: `Sin CALLRESULT en ${timeoutMs} ms` },
          },
        };
      }
      const rpcError = error as {
        rpcErrorCode?: string;
        rpcErrorMessage?: string;
        details?: unknown;
        message?: string;
      };
      if (rpcError.rpcErrorCode) {
        return {
          status: 502,
          body: {
            uniqueId,
            error: {
              code: 'CALL_ERROR',
              ocppErrorCode: rpcError.rpcErrorCode,
              description: rpcError.rpcErrorMessage || rpcError.message || 'CALLERROR',
              details: rpcError.details ?? null,
            },
          },
        };
      }
      return {
        status: 404,
        body: {
          uniqueId,
          error: { code: 'NOT_CONNECTED', description: rpcError.message ?? 'Conexión cerrada' },
        },
      };
    } finally {
      connection.pendingCalls -= 1;
      this.outboundIds.delete(params);
    }
  }

  connectionInfo(chargeBoxId: string): InternalResponse {
    const connection = this.connections.get(chargeBoxId);
    if (!connection)
      return { status: 404, body: { chargeBoxId, connected: false, podId: this.podId } };
    return {
      status: 200,
      body: {
        chargeBoxId,
        connected: true,
        podId: this.podId,
        protocol: OCPP16_SUBPROTOCOL,
        connectedAt: connection.connectedAt.toISOString(),
        lastSeenAt: connection.lastSeenAt.toISOString(),
        pendingCalls: connection.pendingCalls,
        messagesIn: connection.messagesIn,
        generation: connection.generation,
        lifecycle: connection.chargePoint.lifecycle,
      },
    };
  }

  async disconnect(chargeBoxId: string, code: number, reason: string): Promise<InternalResponse> {
    const connection = this.connections.get(chargeBoxId);
    if (!connection)
      return {
        status: 404,
        body: { error: { code: 'NOT_CONNECTED', description: 'Sin conexión' } },
      };
    await connection.client.close({ code, reason, awaitPending: false }).catch(() => undefined);
    return { status: 204, body: undefined };
  }

  private publish(
    name: EventEnvelope['name'],
    chargePoint: RegisteredChargePoint,
    aggregateType: EventEnvelope['aggregate']['type'],
    aggregateId: string,
    payload: Record<string, unknown>,
  ): void {
    this.emit(
      'event',
      createEnvelope({
        name,
        tenantId: chargePoint.tenantId,
        aggregate: { type: aggregateType, id: aggregateId },
        orderingKey: chargePoint.identity,
        payload: { chargeBoxId: chargePoint.identity, ...payload },
        occurredAt: this.now(),
      }),
    );
  }

  async start(): Promise<GatewayAddresses> {
    const { config, logger } = this.deps;
    this.ocppServer = await this.rpc.listen(config.OCPP_GATEWAY_PORT, config.OCPP_GATEWAY_HOST);
    this.healthServer = createServer((req, res) => this.handleHealth(req.url ?? '/', res));
    await new Promise<void>((resolve) =>
      this.healthServer?.listen(config.OCPP_GATEWAY_HEALTH_PORT, config.OCPP_GATEWAY_HOST, resolve),
    );
    const internalPort = await this.internalApi.listen(
      config.OCPP_GATEWAY_INTERNAL_PORT,
      config.OCPP_GATEWAY_HOST,
    );
    this.internalUrl =
      config.OCPP_GATEWAY_INTERNAL_URL ??
      `http://${process.env.POD_IP ?? '127.0.0.1'}:${internalPort}`;
    if (this.deps.evictions) {
      await this.deps.evictions.subscribe(this.podId, (chargeBoxId) => {
        const connection = this.connections.get(chargeBoxId);
        if (!connection) return;
        logger.warn({ chargeBoxId }, 'desalojo: el cargador se conectó a otro pod');
        void connection.client.close({
          code: CLOSE_CODE_POLICY_VIOLATION,
          reason: 'Connection moved to another pod',
          awaitPending: false,
        });
      });
    }
    const addresses = {
      ocppPort: (this.ocppServer.address() as AddressInfo).port,
      healthPort: (this.healthServer.address() as AddressInfo).port,
      internalPort,
      internalUrl: this.internalUrl,
    };
    logger.info(
      {
        ...addresses,
        pathPrefix: config.OCPP_GATEWAY_PATH_PREFIX,
        podId: this.podId,
        internalApi: Boolean(config.OCPP_GATEWAY_INTERNAL_TOKEN),
      },
      'gateway OCPP escuchando',
    );
    return addresses;
  }

  /** Cierra las conexiones de forma escalonada (código 1012) y apaga los servidores. */
  async stop(): Promise<void> {
    this.draining = true;
    const rate = this.deps.config.OCPP_DRAIN_RATE_PER_S;
    const clients = this.connections.list();
    for (let i = 0; i < clients.length; i++) {
      const connection = clients[i];
      if (!connection) continue;
      this.stopRefresh(connection);
      void connection.client.close({
        code: CLOSE_CODE_SERVICE_RESTART,
        reason: 'Service Restart',
        awaitPending: true,
      });
      if ((i + 1) % rate === 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await this.rpc.close({
      code: CLOSE_CODE_SERVICE_RESTART,
      reason: 'Service Restart',
      awaitPending: true,
    });
    await this.internalApi.close();
    await new Promise<void>((resolve) =>
      this.healthServer ? this.healthServer.close(() => resolve()) : resolve(),
    );
    await this.deps.evictions?.close();
    await this.persistence.flush();
    this.deps.logger.info('gateway detenido');
  }

  private handleHealth(url: string, res: ServerResponse): void {
    if (url === '/healthz') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'ocpp-gateway',
        podId: this.podId,
        connections: this.connections.size,
        uptimeSeconds: Math.floor((this.now().getTime() - this.startedAt.getTime()) / 1000),
      });
      return;
    }
    if (url === '/readyz') {
      const ready = !this.draining && this.ocppServer?.listening === true;
      sendJson(res, ready ? 200 : 503, { status: ready ? 'ready' : 'draining' });
      return;
    }
    if (url === '/metrics') {
      const pending = this.connections.list().reduce((sum, c) => sum + c.pendingCalls, 0);
      const lines = [
        '# TYPE ocpp_connections gauge',
        `ocpp_connections ${this.connections.size}`,
        '# TYPE ocpp_pending_calls gauge',
        `ocpp_pending_calls ${pending}`,
        '# TYPE ocpp_calls_in_total counter',
        `ocpp_calls_in_total ${this.counters.callsIn}`,
        '# TYPE ocpp_calls_rejected_total counter',
        `ocpp_calls_rejected_total ${this.counters.callsRejected}`,
        '# TYPE ocpp_calls_out_total counter',
        `ocpp_calls_out_total ${this.counters.callsOut}`,
        '# TYPE ocpp_calls_out_failed_total counter',
        `ocpp_calls_out_failed_total ${this.counters.callsOutFailed}`,
        '# TYPE ocpp_auth_rejected_total counter',
        `ocpp_auth_rejected_total ${this.counters.authRejected}`,
      ];
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      res.end(`${lines.join('\n')}\n`);
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Extrae el usuario de una cabecera `Authorization: Basic ...`; undefined si no es Basic. */
export function basicAuthUsername(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, encoded] = header.split(' ');
  if (scheme?.toLowerCase() !== 'basic' || !encoded) return undefined;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  return separator === -1 ? decoded : decoded.slice(0, separator);
}
