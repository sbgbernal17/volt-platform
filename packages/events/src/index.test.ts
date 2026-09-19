import { describe, expect, it } from 'vitest';
import { createEnvelope, EVENT_NAMES, isEventName, isUlid, ulid } from './index.ts';

describe('ulid', () => {
  it('genera identificadores válidos y ordenables', () => {
    const a = ulid(1_000);
    const b = ulid(2_000);
    expect(isUlid(a)).toBe(true);
    expect(a.length).toBe(26);
    expect(a < b).toBe(true);
  });

  it('conserva el orden dentro del mismo milisegundo', () => {
    const t = 5_000;
    const first = ulid(t);
    const second = ulid(t);
    expect(first < second).toBe(true);
    expect(first.slice(0, 10)).toBe(second.slice(0, 10));
  });

  it('rechaza cadenas con caracteres fuera del alfabeto', () => {
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAI')).toBe(false);
    expect(isUlid(123)).toBe(false);
  });
});

describe('envelope de eventos', () => {
  it('conoce el catálogo', () => {
    expect(EVENT_NAMES.length).toBeGreaterThan(30);
    expect(isEventName('session.started')).toBe(true);
    expect(isEventName('session.exploded')).toBe(false);
  });

  it('usa el id del agregado como ordering key por defecto', () => {
    const envelope = createEnvelope({
      name: 'connector.status.changed',
      tenantId: 'volt',
      aggregate: { type: 'connector', id: 'CP001:1' },
      payload: { status: 'Charging' },
      occurredAt: new Date('2026-09-19T12:00:00Z'),
    });
    expect(envelope.orderingKey).toBe('CP001:1');
    expect(envelope.occurredAt).toBe('2026-09-19T12:00:00.000Z');
    expect(envelope.version).toBe(1);
    expect(isUlid(envelope.id)).toBe(true);
    expect('traceId' in envelope).toBe(false);
  });

  it('respeta un ordering key explícito (por cargador)', () => {
    const envelope = createEnvelope({
      name: 'session.metered',
      tenantId: 'volt',
      aggregate: { type: 'session', id: 'S1' },
      orderingKey: 'CP001',
      payload: {},
      traceId: 'abc',
    });
    expect(envelope.orderingKey).toBe('CP001');
    expect(envelope.traceId).toBe('abc');
  });
});
