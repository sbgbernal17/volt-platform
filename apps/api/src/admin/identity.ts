/**
 * Verificación de ID tokens de Identity Platform (SEG §3.1) sin dependencias: RS256 con las claves
 * públicas publicadas por Google (JWKS), emisor `https://securetoken.google.com/<proyecto>` y
 * audiencia igual al id del proyecto. Las claves se cachean según `Cache-Control: max-age`.
 */
import {
  createPublicKey,
  type JsonWebKey,
  type KeyObject,
  verify as verifySignature,
} from 'node:crypto';
import { CsmsError, UnauthorizedError } from '@volt/csms';

export const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export interface IdTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  firebase?: {
    sign_in_provider?: string;
    sign_in_second_factor?: string;
    second_factor_identifier?: string;
    tenant?: string;
  };
}

export interface IdentityVerifierOptions {
  projectId: string;
  jwksUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  clock?: (() => Date) | undefined;
  /** Tolerancia de reloj en segundos (por defecto 60). */
  leewayS?: number | undefined;
}

function decodeSegment(segment: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('no objeto');
    return parsed as Record<string, unknown>;
  } catch {
    throw new UnauthorizedError('Token mal formado', 'TOKEN_INVALID');
  }
}

export class IdentityPlatformVerifier {
  private keys = new Map<string, KeyObject>();
  private keysExpireAt = 0;
  private lastFetchAt = 0;
  private loading: Promise<void> | undefined;
  private readonly jwksUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;
  private readonly leewayS: number;
  readonly projectId: string;

  constructor(options: IdentityVerifierOptions) {
    this.projectId = options.projectId;
    this.jwksUrl = options.jwksUrl ?? GOOGLE_JWKS_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
    this.leewayS = options.leewayS ?? 60;
  }

  get issuer(): string {
    return `https://securetoken.google.com/${this.projectId}`;
  }

  async verify(token: string): Promise<IdTokenClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedError('Token mal formado', 'TOKEN_INVALID');
    const [head, body, signature] = parts as [string, string, string];
    const header = decodeSegment(head);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
      throw new UnauthorizedError('Algoritmo o clave del token no admitidos', 'TOKEN_INVALID');
    }
    const key = await this.keyFor(header.kid);
    const valid = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${head}.${body}`, 'utf8'),
      key,
      Buffer.from(signature, 'base64url'),
    );
    if (!valid) throw new UnauthorizedError('Firma del token inválida', 'TOKEN_INVALID');
    const claims = decodeSegment(body) as Partial<IdTokenClaims>;
    const now = Math.floor(this.clock().getTime() / 1000);
    if (claims.iss !== this.issuer || claims.aud !== this.projectId) {
      throw new UnauthorizedError('El token no es de este proyecto', 'TOKEN_INVALID');
    }
    if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 128) {
      throw new UnauthorizedError('Token sin sujeto', 'TOKEN_INVALID');
    }
    if (typeof claims.exp !== 'number' || claims.exp + this.leewayS <= now) {
      throw new UnauthorizedError('Token vencido', 'TOKEN_EXPIRED');
    }
    if (typeof claims.iat !== 'number' || claims.iat - this.leewayS > now) {
      throw new UnauthorizedError('Token emitido en el futuro', 'TOKEN_INVALID');
    }
    if (typeof claims.auth_time === 'number' && claims.auth_time - this.leewayS > now) {
      throw new UnauthorizedError('Token con inicio de sesión en el futuro', 'TOKEN_INVALID');
    }
    return claims as IdTokenClaims;
  }

  private async keyFor(kid: string): Promise<KeyObject> {
    const now = Date.now();
    const stale = now > this.keysExpireAt;
    // Una clave desconocida obliga a recargar, pero no más de una vez por minuto (tokens basura).
    if (stale || (!this.keys.has(kid) && now - this.lastFetchAt > 60_000)) await this.load();
    const key = this.keys.get(kid);
    if (!key) throw new UnauthorizedError('Clave de firma desconocida', 'TOKEN_INVALID');
    return key;
  }

  private load(): Promise<void> {
    if (!this.loading) {
      this.loading = this.fetchKeys().finally(() => {
        this.loading = undefined;
      });
    }
    return this.loading;
  }

  private async fetchKeys(): Promise<void> {
    this.lastFetchAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(this.jwksUrl, { signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      throw new CsmsError(
        'No se pudieron obtener las claves de Identity Platform',
        503,
        'IDP_UNAVAILABLE',
        { cause: (error as Error).message },
      );
    }
    if (!response.ok) {
      throw new CsmsError('Identity Platform no entregó sus claves', 503, 'IDP_UNAVAILABLE', {
        status: response.status,
      });
    }
    const body = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    const keys = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kty === 'RSA' && typeof jwk.kid === 'string') {
        keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
      }
    }
    if (keys.size === 0) {
      throw new CsmsError('Identity Platform no entregó claves RSA', 503, 'IDP_UNAVAILABLE');
    }
    this.keys = keys;
    const cacheControl = response.headers.get('cache-control') ?? '';
    const maxAge = /max-age=(\d+)/.exec(cacheControl);
    const ttlS = maxAge ? Number(maxAge[1]) : 3600;
    this.keysExpireAt = Date.now() + Math.min(Math.max(ttlS, 60), 86_400) * 1000;
  }
}
