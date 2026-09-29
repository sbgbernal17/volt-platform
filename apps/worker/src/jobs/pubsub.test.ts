import type { OutboxRow } from '@volt/csms';
import { describe, expect, it } from 'vitest';
import { CompositeEventPublisher, metadataTokenSource, PubSubEventPublisher } from './pubsub.ts';

function event(id: number): OutboxRow {
  return {
    id: BigInt(id),
    event_id: `evt-${id}`,
    type: 'session.metered',
    version: 1,
    tenant_id: 'tenant',
    aggregate_type: 'session',
    aggregate_id: `s-${id}`,
    ordering_key: `s-${id}`,
    occurred_at: new Date('2026-09-29T00:00:00Z'),
    payload: { hello: id } as unknown as OutboxRow['payload'],
    created_at: new Date('2026-09-29T00:00:00Z'),
    published_at: null,
    attempts: 0,
    last_error: null,
  };
}

describe('PubSubEventPublisher', () => {
  it('publica por REST con el sobre en data y los atributos de filtrado', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const publisher = new PubSubEventPublisher(
      'projects/p/topics/domain-events',
      async () => 'tok',
      fetchImpl,
    );
    await publisher.publish([event(1), event(2)]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://pubsub.googleapis.com/v1/projects/p/topics/domain-events:publish',
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      messages: { data: string; attributes: Record<string, string> }[];
    };
    expect(body.messages).toHaveLength(2);
    expect(JSON.parse(Buffer.from(body.messages[0]?.data ?? '', 'base64').toString())).toEqual({
      hello: 1,
    });
    expect(body.messages[1]?.attributes).toEqual({
      type: 'session.metered',
      tenantId: 'tenant',
      aggregateType: 'session',
      aggregateId: 's-2',
      eventId: 'evt-2',
    });
  });

  it('falla (para que el relay reintente) cuando Pub/Sub responde error', async () => {
    const fetchImpl = (async () =>
      new Response('permiso denegado', { status: 403 })) as typeof fetch;
    const publisher = new PubSubEventPublisher('projects/p/topics/t', async () => 'tok', fetchImpl);
    await expect(publisher.publish([event(1)])).rejects.toThrow(/403/);
  });

  it('no llama a la API sin eventos', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}');
    }) as typeof fetch;
    await new PubSubEventPublisher('projects/p/topics/t', async () => 'tok', fetchImpl).publish([]);
    expect(called).toBe(false);
  });
});

describe('metadataTokenSource', () => {
  it('reutiliza el token hasta un minuto antes de vencer', async () => {
    let requests = 0;
    const fetchImpl = (async () => {
      requests += 1;
      return new Response(JSON.stringify({ access_token: `t${requests}`, expires_in: 3600 }));
    }) as typeof fetch;
    const source = metadataTokenSource(fetchImpl);
    expect(await source()).toBe('t1');
    expect(await source()).toBe('t1');
    expect(requests).toBe(1);
  });
});

describe('CompositeEventPublisher', () => {
  it('publica en todos los destinos en orden', async () => {
    const order: string[] = [];
    const composite = new CompositeEventPublisher([
      { publish: async () => void order.push('a') },
      { publish: async () => void order.push('b') },
    ]);
    await composite.publish([event(1)]);
    expect(order).toEqual(['a', 'b']);
  });
});
