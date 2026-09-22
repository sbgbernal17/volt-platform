import type { Redis } from 'ioredis';

/** Entrada del directorio `cs:conn:{chargeBoxId}` (ARQ §4.3 y §4.4). */
export interface ConnectionRecord {
  chargeBoxId: string;
  podId: string;
  /** URL base de la API interna del pod que tiene el WebSocket, p. ej. `http://10.8.1.23:9222`. */
  internalUrl: string;
  protocol: string;
  connectedAt: string;
  generation: number;
}

export interface ConnectionDirectory {
  /** Registra la conexión; devuelve el pod anterior si otro pod la tenía (para evicción). */
  register(record: ConnectionRecord, ttlMs: number): Promise<{ previousPodId?: string }>;
  /** Renueva el TTL solo si la entrada sigue siendo de este pod. */
  refresh(chargeBoxId: string, podId: string, ttlMs: number): Promise<boolean>;
  /** Borra la entrada solo si sigue siendo de este pod (compare-and-delete). */
  unregister(chargeBoxId: string, podId: string): Promise<boolean>;
  lookup(chargeBoxId: string): Promise<ConnectionRecord | undefined>;
}

export const CONNECTION_KEY_PREFIX = 'cs:conn:';
export const EVICT_CHANNEL_PREFIX = 'cs:evict:';

export function connectionKey(chargeBoxId: string): string {
  return `${CONNECTION_KEY_PREFIX}${chargeBoxId}`;
}

export function evictChannel(podId: string): string {
  return `${EVICT_CHANNEL_PREFIX}${podId}`;
}

const REFRESH_IF_OWNER = `
  local value = redis.call('GET', KEYS[1])
  if not value then return 0 end
  if cjson.decode(value).podId ~= ARGV[1] then return 0 end
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])`;

const DELETE_IF_OWNER = `
  local value = redis.call('GET', KEYS[1])
  if not value then return 0 end
  if cjson.decode(value).podId ~= ARGV[1] then return 0 end
  return redis.call('DEL', KEYS[1])`;

function parseRecord(raw: string | null): ConnectionRecord | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<ConnectionRecord>;
    if (
      typeof parsed.chargeBoxId !== 'string' ||
      typeof parsed.podId !== 'string' ||
      typeof parsed.internalUrl !== 'string'
    ) {
      return undefined;
    }
    return {
      chargeBoxId: parsed.chargeBoxId,
      podId: parsed.podId,
      internalUrl: parsed.internalUrl,
      protocol: parsed.protocol ?? 'ocpp1.6',
      connectedAt: parsed.connectedAt ?? '',
      generation: Number(parsed.generation ?? 0),
    };
  } catch {
    return undefined;
  }
}

/** Directorio en Redis con TTL (90 s por defecto en el gateway) y operaciones condicionadas al pod. */
export class RedisConnectionDirectory implements ConnectionDirectory {
  constructor(private readonly redis: Redis) {}

  async register(record: ConnectionRecord, ttlMs: number): Promise<{ previousPodId?: string }> {
    const key = connectionKey(record.chargeBoxId);
    const previous = parseRecord(await this.redis.get(key));
    await this.redis.set(key, JSON.stringify(record), 'PX', ttlMs);
    return previous && previous.podId !== record.podId ? { previousPodId: previous.podId } : {};
  }

  async refresh(chargeBoxId: string, podId: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.eval(
      REFRESH_IF_OWNER,
      1,
      connectionKey(chargeBoxId),
      podId,
      ttlMs,
    );
    return Number(result) === 1;
  }

  async unregister(chargeBoxId: string, podId: string): Promise<boolean> {
    const result = await this.redis.eval(DELETE_IF_OWNER, 1, connectionKey(chargeBoxId), podId);
    return Number(result) === 1;
  }

  async lookup(chargeBoxId: string): Promise<ConnectionRecord | undefined> {
    return parseRecord(await this.redis.get(connectionKey(chargeBoxId)));
  }

  /** Pide al pod que aún tiene un socket viejo para ese cargador que lo cierre (ARQ §4.4). */
  async publishEviction(podId: string, chargeBoxId: string): Promise<number> {
    return this.redis.publish(evictChannel(podId), chargeBoxId);
  }
}

/**
 * Directorio estático para entornos sin Redis (laboratorio, pruebas): todo cargador se busca en
 * el único gateway conocido. `lookup` devuelve siempre una entrada; el gateway responderá
 * NOT_CONNECTED si no tiene el socket.
 */
export class StaticConnectionDirectory implements ConnectionDirectory {
  private readonly records = new Map<string, ConnectionRecord>();

  constructor(
    private readonly internalUrl: string,
    private readonly podId = 'static',
  ) {}

  async register(record: ConnectionRecord): Promise<{ previousPodId?: string }> {
    this.records.set(record.chargeBoxId, record);
    return {};
  }

  async refresh(): Promise<boolean> {
    return true;
  }

  async unregister(chargeBoxId: string): Promise<boolean> {
    return this.records.delete(chargeBoxId);
  }

  async lookup(chargeBoxId: string): Promise<ConnectionRecord | undefined> {
    return (
      this.records.get(chargeBoxId) ?? {
        chargeBoxId,
        podId: this.podId,
        internalUrl: this.internalUrl,
        protocol: 'ocpp1.6',
        connectedAt: '',
        generation: 0,
      }
    );
  }
}
