import { describe, expect, it } from 'vitest';
import { Scheduler } from './scheduler.ts';

const silent = { info: () => undefined, error: () => undefined };

describe('scheduler del worker', () => {
  it('ejecuta un trabajo y evita solapamientos', async () => {
    let runs = 0;
    let release: () => void = () => undefined;
    const job = {
      name: 'lento',
      intervalMs: 60_000,
      run: () =>
        new Promise<void>((resolve) => {
          runs += 1;
          release = resolve;
        }),
    };
    const scheduler = new Scheduler([job], silent);
    const first = scheduler.tick(job);
    const overlapped = await scheduler.tick(job);
    expect(overlapped).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(runs).toBe(1);
  });

  it('captura errores sin tumbar el proceso', async () => {
    const errors: string[] = [];
    const scheduler = new Scheduler([], {
      info: () => undefined,
      error: (obj) => errors.push(String(obj.job)),
    });
    const ok = await scheduler.tick({
      name: 'falla',
      intervalMs: 1000,
      run: async () => {
        throw new Error('boom');
      },
    });
    expect(ok).toBe(false);
    expect(errors).toEqual(['falla']);
  });

  it('no ejecuta trabajos después de detenerse', async () => {
    const scheduler = new Scheduler([], silent);
    await scheduler.stop(10);
    const ran = await scheduler.tick({ name: 'x', intervalMs: 1000, run: async () => undefined });
    expect(ran).toBe(false);
  });
});
