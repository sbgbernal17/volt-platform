import { ulid } from './ulid.ts';

export { isUlid, ulid } from './ulid.ts';

/** Catálogo de eventos de dominio (DAT §4.2). El nombre es `agregado.hecho` en pasado. */
export const EVENT_NAMES = [
  'charger.connected',
  'charger.disconnected',
  'charger.online',
  'charger.offline',
  'charger.booted',
  'charger.registered',
  'connector.status.changed',
  'authorization.granted',
  'authorization.denied',
  'session.requested',
  'session.authorized',
  'session.starting',
  'session.started',
  'session.metered',
  'session.suspended',
  'session.resumed',
  'session.stop_requested',
  'session.ended',
  'session.exposure_warning',
  'session.exposure_exhausted',
  'session.idle_ended',
  'session.priced',
  'session.settled',
  'session.failed',
  'session.cancelled',
  'session.expired',
  'transaction.orphaned',
  'command.sent',
  'command.completed',
  'command.timed_out',
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'payment.refunded',
  'payment.voided',
  'invoice.issued',
  'reservation.created',
  'tariff.published',
  'tariff.retired',
  'tariff.assigned',
  'setting.changed',
  'alarm.raised',
  'alarm.resolved',
  'driver.anonymized',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export type AggregateType =
  | 'charge_point'
  | 'connector'
  | 'session'
  | 'transaction'
  | 'command'
  | 'payment'
  | 'invoice'
  | 'reservation'
  | 'tariff'
  | 'setting'
  | 'alarm'
  | 'driver';

/**
 * Sobre común de todo evento. `orderingKey` es el chargeBoxId cuando el orden importa (estado
 * de conector, mediciones); los consumidores deduplican por `id` (bandeja de entrada idempotente).
 */
export interface EventEnvelope<TPayload = unknown> {
  readonly id: string;
  readonly name: EventName;
  readonly version: 1;
  readonly occurredAt: string;
  readonly tenantId: string;
  readonly aggregate: { readonly type: AggregateType; readonly id: string };
  readonly orderingKey: string;
  readonly traceId?: string;
  readonly payload: TPayload;
}

export interface CreateEnvelopeInput<TPayload> {
  name: EventName;
  tenantId: string;
  aggregate: { type: AggregateType; id: string };
  payload: TPayload;
  orderingKey?: string;
  occurredAt?: Date;
  traceId?: string;
}

export function isEventName(value: unknown): value is EventName {
  return typeof value === 'string' && (EVENT_NAMES as readonly string[]).includes(value);
}

export function createEnvelope<TPayload>(
  input: CreateEnvelopeInput<TPayload>,
): EventEnvelope<TPayload> {
  const occurredAt = input.occurredAt ?? new Date();
  const envelope: EventEnvelope<TPayload> = {
    id: ulid(occurredAt.getTime()),
    name: input.name,
    version: 1,
    occurredAt: occurredAt.toISOString(),
    tenantId: input.tenantId,
    aggregate: { type: input.aggregate.type, id: input.aggregate.id },
    orderingKey: input.orderingKey ?? input.aggregate.id,
    payload: input.payload,
    ...(input.traceId ? { traceId: input.traceId } : {}),
  };
  return envelope;
}
