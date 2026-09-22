import { listAggregateEvents } from '@volt/csms';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ISql } from 'postgres';

export interface SseOptions {
  pollMs: number;
  heartbeatMs: number;
  /** Devuelve true cuando ya no habrá más eventos (sesión terminada). */
  isFinished: () => Promise<boolean>;
}

/**
 * Flujo SSE de los eventos de una sesión (ARQ §1.4, DAT §4.6): lee el outbox por agregado, usa el
 * id de outbox como `id:` para reanudar con `Last-Event-ID` y termina cuando la sesión acaba.
 * Sin dependencia de Pub/Sub: sondea la base de datos (suficiente para la escala del MVP).
 */
export async function streamSessionEvents(
  request: FastifyRequest,
  reply: FastifyReply,
  sql: ISql,
  sessionId: string,
  options: SseOptions,
): Promise<void> {
  const raw = reply.raw;
  reply.hijack();
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  raw.write(': connected\n\n');
  const header = request.headers['last-event-id'];
  const query = (request.query ?? {}) as { lastEventId?: string };
  let lastId = parseId(Array.isArray(header) ? header[0] : (header ?? query.lastEventId));
  let open = true;
  request.raw.on('close', () => {
    open = false;
  });
  let lastBeat = Date.now();
  try {
    while (open) {
      const events = await listAggregateEvents(sql, 'session', sessionId, lastId);
      for (const event of events) {
        raw.write(
          `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`,
        );
        lastId = event.id;
      }
      if (events.length === 0 && (await options.isFinished())) {
        raw.write('event: end\ndata: {}\n\n');
        break;
      }
      if (Date.now() - lastBeat >= options.heartbeatMs) {
        raw.write(': ping\n\n');
        lastBeat = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, options.pollMs));
    }
  } catch (error) {
    request.log.warn({ err: error, sessionId }, 'flujo SSE interrumpido');
  } finally {
    raw.end();
  }
}

function parseId(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}
