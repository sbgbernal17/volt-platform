import { randomBytes } from 'node:crypto';

/** Alfabeto Crockford base32 usado por ULID (sin I, L, O, U). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

let lastTime = -1;
let lastRandom = 0n;

function encode(value: bigint, length: number): string {
  let out = '';
  let v = value;
  for (let i = 0; i < length; i++) {
    out = ALPHABET[Number(v & 31n)] + out;
    v >>= 5n;
  }
  return out;
}

/**
 * Genera un ULID (26 caracteres, ordenable por tiempo). Dentro del mismo milisegundo el
 * componente aleatorio se incrementa para conservar el orden de creación.
 */
export function ulid(now: number = Date.now()): string {
  const time = Math.max(now, 0);
  if (time === lastTime) {
    lastRandom += 1n;
  } else {
    lastTime = time;
    lastRandom = BigInt(`0x${randomBytes(10).toString('hex')}`);
  }
  const random = lastRandom & ((1n << 80n) - 1n);
  return encode(BigInt(time), TIME_LENGTH) + encode(random, RANDOM_LENGTH);
}

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
