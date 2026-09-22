import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectionKey, RedisConnectionDirectory } from './directory.ts';

const redisUrl = process.env.REDIS_URL;

describe.skipIf(!redisUrl)('RedisConnectionDirectory', () => {
  const redis = new Redis(redisUrl ?? '', { lazyConnect: true });
  const directory = new RedisConnectionDirectory(redis);
  const chargeBoxId = `CP-DIR-${process.pid}-${Date.now()}`;

  beforeAll(async () => {
    await redis.connect();
  });

  afterAll(async () => {
    await redis.del(connectionKey(chargeBoxId));
    redis.disconnect();
  });

  it('registra, renueva y borra solo si el pod es el dueño', async () => {
    const record = {
      chargeBoxId,
      podId: 'gw-a',
      internalUrl: 'http://10.0.0.1:9222',
      protocol: 'ocpp1.6',
      connectedAt: new Date().toISOString(),
      generation: 1,
    };
    expect(await directory.register(record, 5000)).toEqual({});
    expect(await directory.lookup(chargeBoxId)).toEqual(record);
    expect(await directory.refresh(chargeBoxId, 'gw-a', 5000)).toBe(true);
    expect(await directory.refresh(chargeBoxId, 'gw-b', 5000)).toBe(false);
    // Otro pod toma la conexión: se informa del anterior para que lo desaloje.
    expect(
      await directory.register(
        { ...record, podId: 'gw-b', internalUrl: 'http://10.0.0.2:9222' },
        5000,
      ),
    ).toEqual({ previousPodId: 'gw-a' });
    expect(await directory.unregister(chargeBoxId, 'gw-a')).toBe(false);
    expect((await directory.lookup(chargeBoxId))?.podId).toBe('gw-b');
    expect(await directory.unregister(chargeBoxId, 'gw-b')).toBe(true);
    expect(await directory.lookup(chargeBoxId)).toBeUndefined();
  });
});
