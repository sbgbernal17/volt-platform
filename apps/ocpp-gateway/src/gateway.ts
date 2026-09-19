import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  bootNotificationStatusFor,
  type ChargePointStatus,
  isChargePointStatus,
  isExpectedTransition,
  REJECTED_BOOT_INTERVAL_SECONDS,
} from '@volt/domain';
import { createEnvelope, type EventEnvelope } from '@volt/events';
import { isChargePointInitiated, isKnownAction, validateRequest } from '@volt/ocpp-schemas';
import { createRPCError, type IHandlersOption, type RPCClient, RPCServer } from 'ocpp-rpc';
import type { Logger } from 'pino';
import type { GatewayConfig } from './config.ts';
import { ConnectionRegistry } from './connections.ts';
import type { ChargePointRegistry, RegisteredChargePoint } from './registry.ts';

export const OCPP16_SUBPROTOCOL = 'ocpp1.6';

/** Código de cierre WebSocket "Service Restart" usado al drenar (OPS §4.8). */
export const CLOSE_CODE_SERVICE_RESTART = 1012;

export interface GatewayDependencies {
  config: GatewayConfig;
  registry: ChargePointRegistry;
  logger: Logger;
  clock?: () => Date;
}

export interface GatewayAddresses {
  ocppPort: number;
  healthPort: number;
}

interface Counters {
  callsIn: number;
  callsRejected: number;
  authRejected: number;
}

type Handler = (params: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * Servidor OCPP-J 1.6. Responsabilidades: autenticar en el handshake (allowlist + Basic Auth),
 * validar cada mensaje contra los esquemas oficiales, responder al perfil Core mínimo
 * (BootNotification, Heartbeat, StatusNotification, DataTransfer, Authorize) y publicar eventos
 * de dominio. Las transacciones y los comandos llegan en la iteración 3.
 */
export class Gateway extends EventEmitter<{ event: [EventEnvelope] }> {
  readonly connections = new ConnectionRegistry();
  private readonly counters: Counters = { callsIn: 0, callsRejected: 0, authRejected: 0 };
  private readonly lastStatus = new Map<string, ChargePointStatus>();
  private readonly rpc: RPCServer;
  private healthServer: Server | undefined;
  private ocppServer: Server | undefined;
  private draining = false;
  private readonly startedAt: Date;
  private readonly now: () => Date;

  constructor(private readonly deps: GatewayDependencies) {
    super();
    this.now = deps.clock ?? (() => new Date());
    this.startedAt = this.now();
    this.rpc = new RPCServer({
      protocols: [OCPP16_SUBPROTOCOL],
      strictMode: false,
      pingIntervalMs: deps.config.OCPP_PING_INTERVAL_S * 1000,
      callTimeoutMs: deps.config.OCPP_CALL_TIMEOUT_MS,
      respondWithDetailedErrors: deps.config.NODE_ENV !== 'production',
      maxBadMessages: 5,
    });
    this.rpc.auth((accept, reject, handshake) => {
      void this.authenticate(
        handshake.identity,
        handshake.endpoint,
        handshake.headers.authorization,
        handshake.password,
      )
        .then((chargePoint) => {
          if (chargePoint) accept({ chargePoint }, OCPP16_SUBPROTOCOL);
          else reject(401, 'Unauthorized');
        })
        .catch((error: unknown) => {
          this.deps.logger.error(
            { err: error, identity: handshake.identity },
            'error autenticando',
          );
          reject(500, 'Internal error');
        });
    });
    this.rpc.on(
      'client',
      (client: RPCClient & { session: { chargePoint: RegisteredChargePoint } }) => {
        this.onClient(client, client.session.chargePoint);
      },
    );
  }

  /** Solo se aceptan cargadores dados de alta cuyo usuario Basic Auth coincide con su identidad. */
  private async authenticate(
    identity: string,
    endpoint: string,
    authorization: string | undefined,
    password: Buffer | undefined,
  ): Promise<RegisteredChargePoint | undefined> {
    const prefix = this.deps.config.OCPP_GATEWAY_PATH_PREFIX;
    const normalized = endpoint.replace(/\/+$/, '');
    if (normalized !== prefix) {
      this.counters.authRejected += 1;
      this.deps.logger.warn({ identity, endpoint }, 'ruta no permitida');
      return undefined;
    }
    if (this.draining) return undefined;
    const username = basicAuthUsername(authorization);
    if (username !== identity) {
      this.counters.authRejected += 1;
      this.deps.logger.warn({ identity }, 'usuario Basic Auth distinto de la identidad');
      return undefined;
    }
    const chargePoint = await this.deps.registry.authenticate(identity, password);
    if (!chargePoint) {
      this.counters.authRejected += 1;
      this.deps.logger.warn({ identity }, 'cargador desconocido o credencial inválida');
    }
    return chargePoint;
  }

  private onClient(client: RPCClient, chargePoint: RegisteredChargePoint): void {
    const log = this.deps.logger.child({
      chargeBoxId: chargePoint.identity,
      tenantId: chargePoint.tenantId,
    });
    const previous = this.connections.register(chargePoint, client, this.now());
    if (previous) {
      log.warn('conexión duplicada: se cierra la anterior');
      void previous.client.close({
        code: 1000,
        reason: 'Replaced by a newer connection',
        awaitPending: false,
      });
    }
    log.info(
      { lifecycle: chargePoint.lifecycle, connections: this.connections.size },
      'cargador conectado',
    );
    this.publish('charger.connected', chargePoint, 'charge_point', chargePoint.identity, {
      lifecycle: chargePoint.lifecycle,
      replacedPrevious: previous !== undefined,
    });

    const handlers: Record<string, Handler> = {
      BootNotification: async (params) => {
        const status = bootNotificationStatusFor(chargePoint.lifecycle);
        const interval =
          status === 'Accepted'
            ? this.deps.config.OCPP_HEARTBEAT_INTERVAL_S
            : status === 'Pending'
              ? this.deps.config.OCPP_PENDING_RETRY_S
              : REJECTED_BOOT_INTERVAL_SECONDS;
        log.info(
          { status, vendor: params.chargePointVendor, model: params.chargePointModel },
          'BootNotification',
        );
        this.publish('charger.booted', chargePoint, 'charge_point', chargePoint.identity, {
          status,
          vendor: params.chargePointVendor,
          model: params.chargePointModel,
          serialNumber: params.chargePointSerialNumber,
          firmwareVersion: params.firmwareVersion,
          meterSerialNumber: params.meterSerialNumber,
        });
        return { status, currentTime: this.now().toISOString(), interval };
      },
      Heartbeat: async () => ({ currentTime: this.now().toISOString() }),
      StatusNotification: async (params) => {
        const connectorId = Number(params.connectorId);
        const status = params.status;
        if (!isChargePointStatus(status)) return {};
        const key = `${chargePoint.identity}:${connectorId}`;
        const previousStatus = this.lastStatus.get(key);
        const expected = previousStatus ? isExpectedTransition(previousStatus, status) : true;
        this.lastStatus.set(key, status);
        if (!expected) {
          log.warn(
            { connectorId, from: previousStatus, to: status },
            'transición de estado no prevista',
          );
        }
        this.publish('connector.status.changed', chargePoint, 'connector', key, {
          connectorId,
          status,
          errorCode: params.errorCode,
          info: params.info,
          vendorErrorCode: params.vendorErrorCode,
          statusAtChargePoint: params.timestamp ?? null,
          previousStatus: previousStatus ?? null,
          expectedTransition: expected,
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

    client.handle(async ({ method, params }: IHandlersOption) => {
      const action = method ?? '';
      this.counters.callsIn += 1;
      this.connections.touch(chargePoint.identity, this.now());
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
      const handler = handlers[action];
      if (!handler) {
        this.counters.callsRejected += 1;
        log.warn({ action }, 'acción válida pero aún no implementada');
        throw createRPCError('NotImplemented', `Acción pendiente de implementación: ${action}`);
      }
      return handler((params ?? {}) as Record<string, unknown>);
    });

    client.on('close', (event: { code?: number; reason?: string } = {}) => {
      const wasCurrent = this.connections.unregister(chargePoint.identity, client);
      if (!wasCurrent) return;
      log.info(
        { code: event.code, reason: event.reason, connections: this.connections.size },
        'cargador desconectado',
      );
      this.publish('charger.disconnected', chargePoint, 'charge_point', chargePoint.identity, {
        code: event.code ?? null,
        reason: event.reason ?? null,
      });
    });
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
    const addresses = {
      ocppPort: (this.ocppServer.address() as AddressInfo).port,
      healthPort: (this.healthServer.address() as AddressInfo).port,
    };
    logger.info(
      { ...addresses, pathPrefix: config.OCPP_GATEWAY_PATH_PREFIX },
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
    await new Promise<void>((resolve) =>
      this.healthServer ? this.healthServer.close(() => resolve()) : resolve(),
    );
    this.deps.logger.info('gateway detenido');
  }

  private handleHealth(url: string, res: import('node:http').ServerResponse): void {
    if (url === '/healthz') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'ocpp-gateway',
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
      const lines = [
        '# TYPE ocpp_connections gauge',
        `ocpp_connections ${this.connections.size}`,
        '# TYPE ocpp_calls_in_total counter',
        `ocpp_calls_in_total ${this.counters.callsIn}`,
        '# TYPE ocpp_calls_rejected_total counter',
        `ocpp_calls_rejected_total ${this.counters.callsRejected}`,
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

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
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
