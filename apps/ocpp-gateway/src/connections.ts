import type { RPCClient } from 'ocpp-rpc';
import type { RegisteredChargePoint } from './registry.ts';

export interface LiveConnection {
  readonly identity: string;
  /** Instantánea del cargador; el ciclo de vida se actualiza tras cada BootNotification. */
  chargePoint: RegisteredChargePoint;
  readonly client: RPCClient;
  readonly connectedAt: Date;
  /** Generación de conexión (fencing token, §5.11); la asigna la persistencia. */
  generation: number;
  lastSeenAt: Date;
  /** Último `last_seen_at` escrito en la base de datos (para no escribir en cada mensaje). */
  lastSeenPersistedAt: Date;
  /** Contadores de mensajes de esta conexión. */
  messagesIn: number;
  messagesOut: number;
  /** CALL del CSMS en cola o en vuelo por esta conexión. */
  pendingCalls: number;
  /** Acción de las últimas CALL por uniqueId para correlacionar CALLRESULT/CALLERROR en el log. */
  readonly recentActions: Map<string, string>;
  /** Se resuelve cuando la conexión quedó persistida y publicada en el directorio. */
  opened?: Promise<void>;
  refreshTimer?: NodeJS.Timeout | undefined;
}

/**
 * Conexiones vivas de este pod. El directorio compartido (Redis, chargeBoxId -> pod) lo alimenta
 * el gateway a partir de este registro; aquí vive la verdad local.
 */
export class ConnectionRegistry {
  private readonly connections = new Map<string, LiveConnection>();

  /**
   * Registra una conexión nueva. Si ya existía otra para la misma identidad, la anterior se
   * cierra: los cargadores reconectan tras cortes de red y el socket viejo suele estar muerto.
   */
  register(
    chargePoint: RegisteredChargePoint,
    client: RPCClient,
    now = new Date(),
  ): LiveConnection | undefined {
    const previous = this.connections.get(chargePoint.identity);
    const connection: LiveConnection = {
      identity: chargePoint.identity,
      chargePoint,
      client,
      connectedAt: now,
      generation: 0,
      lastSeenAt: now,
      lastSeenPersistedAt: now,
      messagesIn: 0,
      messagesOut: 0,
      pendingCalls: 0,
      recentActions: new Map(),
    };
    this.connections.set(chargePoint.identity, connection);
    return previous;
  }

  /** Elimina la conexión solo si sigue siendo la vigente para esa identidad. */
  unregister(identity: string, client: RPCClient): LiveConnection | undefined {
    const current = this.connections.get(identity);
    if (!current || current.client !== client) return undefined;
    this.connections.delete(identity);
    return current;
  }

  touch(identity: string, now = new Date()): LiveConnection | undefined {
    const current = this.connections.get(identity);
    if (current) {
      current.lastSeenAt = now;
      current.messagesIn += 1;
    }
    return current;
  }

  get(identity: string): LiveConnection | undefined {
    return this.connections.get(identity);
  }

  get size(): number {
    return this.connections.size;
  }

  list(): LiveConnection[] {
    return [...this.connections.values()];
  }
}
