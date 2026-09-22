import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_KEY_BYTES,
  constantTimeEquals,
  generateAuthorizationKey,
  hashSecret,
  verifySecret,
} from './index.ts';

const fastParams = { cost: 2 ** 10, blockSize: 8, parallelization: 1, keyLength: 32 };

describe('AuthorizationKey', () => {
  it('genera 20 bytes aleatorios en hexadecimal de 40 caracteres, distintos cada vez', () => {
    const a = generateAuthorizationKey();
    const b = generateAuthorizationKey();
    expect(a).toMatch(/^[0-9A-F]{40}$/);
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'hex')).toHaveLength(AUTHORIZATION_KEY_BYTES);
  });
});

describe('hash de secretos con scrypt', () => {
  it('produce un hash PHC verificable que no contiene el secreto', async () => {
    const hash = await hashSecret('clave-secreta', fastParams);
    expect(hash).toMatch(/^\$scrypt\$ln=10,r=8,p=1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(hash).not.toContain('clave-secreta');
    await expect(verifySecret('clave-secreta', hash)).resolves.toBe(true);
    await expect(verifySecret('clave-secretA', hash)).resolves.toBe(false);
    await expect(verifySecret(Buffer.from('clave-secreta'), hash)).resolves.toBe(true);
  });

  it('usa una sal distinta por hash', async () => {
    const first = await hashSecret('x', fastParams);
    const second = await hashSecret('x', fastParams);
    expect(first).not.toBe(second);
  });

  it('rechaza hashes malformados sin lanzar', async () => {
    await expect(verifySecret('x', '')).resolves.toBe(false);
    await expect(verifySecret('x', '$argon2id$v=19$m=65536$abc$def')).resolves.toBe(false);
    await expect(verifySecret('x', '$scrypt$ln=99,r=8,p=1$c2FsdA==$aGFzaA==')).resolves.toBe(false);
    await expect(verifySecret('x', '$scrypt$ln=10,r=8,p=1$$aGFzaA==')).resolves.toBe(false);
  });

  it('usa los parámetros por defecto (ln=15) cuando no se indican', async () => {
    const hash = await hashSecret('y');
    expect(hash.startsWith('$scrypt$ln=15,r=8,p=1$')).toBe(true);
    await expect(verifySecret('y', hash)).resolves.toBe(true);
  });
});

describe('constantTimeEquals', () => {
  it('compara sin lanzar aunque las longitudes difieran', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
    expect(constantTimeEquals(Buffer.from('ab'), 'ab')).toBe(true);
  });
});
