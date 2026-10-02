import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomKey } from './random.ts';

describe('claves aleatorias de idempotencia', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('genera 32 caracteres hexadecimales distintos en cada llamada', () => {
    const a = randomKey();
    const b = randomKey();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(randomKey(8)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('funciona sin Web Crypto, como en la app nativa (Hermes)', () => {
    vi.stubGlobal('crypto', undefined);
    expect(randomKey()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('cae en Math.random si getRandomValues falla', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: () => {
        throw new Error('no disponible');
      },
    });
    expect(randomKey()).toMatch(/^[0-9a-f]{32}$/);
  });
});
