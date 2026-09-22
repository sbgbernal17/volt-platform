import { type CreateEnvelopeInput, createEnvelope, type EventEnvelope } from '@volt/events';
import type { ISql } from 'postgres';
import { toJson } from '../types.ts';

export interface OutboxRow {
  id: bigint;
  event_id: string;
  type: string;
  version: number;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  ordering_key: string;
  occurred_at: Date;
  payload: EventEnvelope;
  created_at: Date;
  published_at: Date | null;
  attempts: number;
  last_error: string | null;
}

/**
 * Escribe un evento de dominio en `ops.event_outbox` dentro de la transacción en curso (DAT §4.4):
 * nunca se publica desde el código de negocio; el relay del worker lo entrega después.
 */
export async function appendEvent<TPayload>(
  db: ISql,
  input: CreateEnvelopeInput<TPayload>,
): Promise<EventEnvelope<TPayload>> {
  const envelope = createEnvelope(input);
  await db`
    INSERT INTO ops.event_outbox
      (event_id, type, version, tenant_id, aggregate_type, aggregate_id, ordering_key, occurred_at, payload)
    VALUES (${envelope.id}, ${envelope.name}, ${envelope.version}, ${envelope.tenantId},
            ${envelope.aggregate.type}, ${envelope.aggregate.id}, ${envelope.orderingKey},
            ${new Date(envelope.occurredAt)}, ${toJson(db as never, envelope)})`;
  return envelope;
}

/** Eventos de un agregado con id de outbox mayor que `afterId` (SSE con Last-Event-ID). */
export async function listAggregateEvents(
  db: ISql,
  aggregateType: string,
  aggregateId: string,
  afterId = 0n,
  limit = 200,
): Promise<OutboxRow[]> {
  return db<OutboxRow[]>`
    SELECT * FROM ops.event_outbox
    WHERE aggregate_type = ${aggregateType} AND aggregate_id = ${aggregateId} AND id > ${afterId.toString()}::bigint
    ORDER BY id LIMIT ${limit}`;
}

/** Lote de eventos pendientes de publicar, bloqueados para este relay (SKIP LOCKED). */
export async function claimPendingEvents(db: ISql, limit = 500): Promise<OutboxRow[]> {
  return db<OutboxRow[]>`
    SELECT * FROM ops.event_outbox WHERE published_at IS NULL
    ORDER BY id FOR UPDATE SKIP LOCKED LIMIT ${limit}`;
}

export async function markPublished(db: ISql, ids: bigint[]): Promise<void> {
  if (ids.length === 0) return;
  await db`
    UPDATE ops.event_outbox SET published_at = now(), attempts = attempts + 1
    WHERE id = ANY(${ids.map((id) => id.toString())}::bigint[])`;
}

export async function markPublishFailed(db: ISql, ids: bigint[], error: string): Promise<void> {
  if (ids.length === 0) return;
  await db`
    UPDATE ops.event_outbox SET attempts = attempts + 1, last_error = ${error.slice(0, 500)}
    WHERE id = ANY(${ids.map((id) => id.toString())}::bigint[])`;
}
