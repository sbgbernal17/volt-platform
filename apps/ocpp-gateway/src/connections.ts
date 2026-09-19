import type { RPCClient } from 'ocpp-rpc';
import type { RegisteredChargePoint } from './registry.ts';

export interface LiveConnection {
  readonly identity: string;
  readonly chargePoint: RegisteredChargePoint;
  readonly client: RPCClient;
  readonly connectedAt: Date;
  lastSeenAt: Date;
  /** Contador de mensajes recibidos en esta conexión. */
  messagesIn: number;
}

/**
 * Conexiones vivas de este pod. En producción se replica en Redis (chargeBoxId -> pod) para
 * enrutar comandos (ARQ §4); aquí vive la verdad local.
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
      lastSeenAt: now,
      messagesIn: 0,
    };
    this.connections.set(chargePoint.identity, connection);
    return previous;
  }

  /** Elimina la conexión solo si sigue siendo la vigente para esa identidad. */
  unregister(identity: string, client: RPCClient): boolean {
    const current = this.connections.get(identity);
    if (!current || current.client !== client) return false;
    this.connections.delete(identity);
    return true;
  }

  touch(identity: string, now = new Date()): void {
    const current = this.connections.get(identity);
    if (current) {
      current.lastSeenAt = now;
      current.messagesIn += 1;
    }
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
