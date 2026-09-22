import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

function scrypt(
  secret: Buffer,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(secret, salt, keyLength, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/**
 * Longitud de la AuthorizationKey (SEG §2.2): 20 bytes aleatorios que viajan al cargador en
 * hexadecimal (40 caracteres) mediante ChangeConfiguration y que él usa como contraseña Basic Auth.
 */
export const AUTHORIZATION_KEY_BYTES = 20;

/** Genera una AuthorizationKey nueva con el CSPRNG de Node; se devuelve en hexadecimal en mayúsculas. */
export function generateAuthorizationKey(bytes = AUTHORIZATION_KEY_BYTES): string {
  return randomBytes(bytes).toString('hex').toUpperCase();
}

/** Parámetros de scrypt (ADR 0014): N = 2^15, r = 8, p = 1, 32 bytes de salida. */
export interface ScryptParams {
  readonly cost: number;
  readonly blockSize: number;
  readonly parallelization: number;
  readonly keyLength: number;
}

export const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  cost: 2 ** 15,
  blockSize: 8,
  parallelization: 1,
  keyLength: 32,
};

const SALT_BYTES = 16;

function encodeParams(params: ScryptParams): string {
  return `ln=${Math.log2(params.cost)},r=${params.blockSize},p=${params.parallelization}`;
}

function parseParams(encoded: string): ScryptParams | undefined {
  const values = new Map<string, number>();
  for (const part of encoded.split(',')) {
    const [name, raw] = part.split('=');
    const value = Number(raw);
    if (!name || !Number.isInteger(value)) return undefined;
    values.set(name, value);
  }
  const ln = values.get('ln');
  const r = values.get('r');
  const p = values.get('p');
  if (ln === undefined || r === undefined || p === undefined) return undefined;
  if (ln < 10 || ln > 20 || r < 1 || r > 32 || p < 1 || p > 16) return undefined;
  return { cost: 2 ** ln, blockSize: r, parallelization: p, keyLength: 32 };
}

async function derive(secret: Buffer, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return scrypt(secret, salt, params.keyLength, {
    N: params.cost,
    r: params.blockSize,
    p: params.parallelization,
    maxmem: 128 * params.cost * params.blockSize * 2,
  });
}

/**
 * Hash de un secreto en formato PHC: `$scrypt$ln=15,r=8,p=1$<salt b64>$<hash b64>`.
 * El resultado es lo único que se guarda en la base de datos.
 */
export async function hashSecret(
  secret: string | Buffer,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(Buffer.from(secret), salt, params);
  return `$scrypt$${encodeParams(params)}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Verdadero si el secreto corresponde al hash. Con un hash malformado devuelve falso. */
export async function verifySecret(secret: string | Buffer, hash: string): Promise<boolean> {
  const parts = hash.split('$');
  if (parts.length !== 5 || parts[1] !== 'scrypt') return false;
  const params = parseParams(parts[2] ?? '');
  if (!params) return false;
  const salt = Buffer.from(parts[3] ?? '', 'base64');
  const expected = Buffer.from(parts[4] ?? '', 'base64');
  if (salt.length === 0 || expected.length !== params.keyLength) return false;
  const actual = await derive(Buffer.from(secret), salt, params);
  return timingSafeEqual(actual, expected);
}

/**
 * Comparación en tiempo constante de dos valores de longitud potencialmente distinta:
 * el tiempo no depende del contenido y solo revela si las longitudes difieren.
 */
export function constantTimeEquals(a: Buffer | string, b: Buffer | string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
