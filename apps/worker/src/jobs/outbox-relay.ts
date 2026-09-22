import { claimPendingEvents, markPublished, markPublishFailed, type OutboxRow } from '@volt/csms';
import type { Redis } from 'ioredis';
import type { Sql } from 'postgres';
import type { SchedulerLogger } from '../scheduler.ts';

/** Puerto de publicación de eventos. En producción lo implementa Pub/Sub (iteración 8). */
export interface EventPublisher {
  publish(events: OutboxRow[]): Promise<void>;
}

/** Publicación en un canal Redis (desarrollo y laboratorio; consumidores locales). */
export class RedisEventPublisher implements EventPublisher {
  constructor(
    private readonly redis: Redis,
    private readonly channel = 'domain-events',
  ) {}

  async publish(events: OutboxRow[]): Promise<void> {
    for (const event of events) {
      await this.redis.publish(this.channel, JSON.stringify(event.payload));
    }
  }
}

/** Publicador que solo registra en el log (sin Redis ni Pub/Sub). */
export class LogEventPublisher implements EventPublisher {
  constructor(private readonly logger: SchedulerLogger) {}

  async publish(events: OutboxRow[]): Promise<void> {
    const byType = new Map<string, number>();
    for (const event of events) byType.set(event.type, (byType.get(event.type) ?? 0) + 1);
    this.logger.info({ events: Object.fromEntries(byType) }, 'eventos publicados (log)');
  }
}

/** Publicador en memoria para pruebas. */
export class MemoryEventPublisher implements EventPublisher {
  readonly published: OutboxRow[] = [];
  failNext = false;

  async publish(events: OutboxRow[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('publicación fallida (simulada)');
    }
    this.published.push(...events);
  }
}

/**
 * Relay del outbox (DAT §4.4): toma un lote de eventos pendientes con bloqueo (SKIP LOCKED),
 * los publica y los marca como publicados en la misma transacción; si la publicación falla, se
 * anota el intento y el error y el lote se reintenta en el siguiente ciclo (at-least-once).
 */
export async function relayOutbox(
  sql: Sql,
  publisher: EventPublisher,
  options: { batch?: number; logger?: SchedulerLogger } = {},
): Promise<number> {
  return sql.begin(async (tx) => {
    const events = await claimPendingEvents(tx, options.batch ?? 500);
    if (events.length === 0) return 0;
    const ids = events.map((event) => event.id);
    try {
      await publisher.publish(events);
    } catch (error) {
      await markPublishFailed(tx, ids, (error as Error).message);
      options.logger?.error({ err: error, events: events.length }, 'relay del outbox fallido');
      return 0;
    }
    await markPublished(tx, ids);
    return events.length;
  });
}
