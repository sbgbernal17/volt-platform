import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit.ts';

describe('límite de peticiones en memoria', () => {
  it('aplica la ventana corta y la larga y libera al pasar el tiempo', () => {
    let now = 0;
    const limiter = new RateLimiter(
      [
        { limit: 1, windowMs: 60_000 },
        { limit: 3, windowMs: 3_600_000 },
      ],
      () => now,
    );
    expect(limiter.hit('a')).toBe(0);
    expect(limiter.hit('a')).toBe(60);
    now = 61_000;
    expect(limiter.hit('a')).toBe(0);
    now = 122_000;
    expect(limiter.hit('a')).toBe(0);
    now = 183_000;
    expect(limiter.hit('a')).toBeGreaterThan(3000);
    expect(limiter.hit('b')).toBe(0);
    now = 3_600_001;
    expect(limiter.hit('a')).toBe(0);
  });
});
