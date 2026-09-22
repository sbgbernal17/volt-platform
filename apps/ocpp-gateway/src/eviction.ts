import { evictChannel } from '@volt/gateway-client';
import { Redis } from 'ioredis';

/**
 * Escucha `cs:evict:{podId}`: otro pod tomó la conexión de un cargador y pide cerrar el socket
 * viejo que aún vive aquí (ARQ §4.4). Usa una conexión Redis dedicada (modo suscriptor).
 */
export class RedisEvictionListener {
  private subscriber: Redis | undefined;

  constructor(private readonly redisUrl: string) {}

  async subscribe(podId: string, handler: (chargeBoxId: string) => void): Promise<void> {
    this.subscriber = new Redis(this.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
    await this.subscriber.connect();
    await this.subscriber.subscribe(evictChannel(podId));
    this.subscriber.on('message', (_channel: string, message: string) => handler(message));
  }

  async close(): Promise<void> {
    if (!this.subscriber) return;
    await this.subscriber.quit().catch(() => undefined);
    this.subscriber = undefined;
  }
}
