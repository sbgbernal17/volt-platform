/**
 * Enlaces de acción de Identity Platform generados por la plataforma (ADR 0032): en lugar de que
 * Google envíe su correo genérico, la API pide el enlace (`accounts:sendOobCode` con
 * `returnOobLink`) con la identidad de la cuenta de servicio de Cloud Run (token del servidor de
 * metadatos, sin claves) y lo envía en un correo con la marca. La URL de acción es la configurada en
 * la consola (`/auth/action` de la app web). En local y en pruebas se generan enlaces falsos.
 */
import { randomBytes } from 'node:crypto';

export type OobKind = 'VERIFY_EMAIL' | 'PASSWORD_RESET';

export interface IdentityLinkGenerator {
  readonly source: 'metadata' | 'fake';
  generate(
    kind: OobKind,
    email: string,
    options?: { continueUrl?: string | undefined },
  ): Promise<string>;
}

export class IdentityLinkError extends Error {
  constructor(
    message: string,
    readonly code: 'EMAIL_NOT_FOUND' | 'UNAVAILABLE' | 'REJECTED',
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'IdentityLinkError';
  }
}

export interface AccessTokenSource {
  token(): Promise<string>;
}

const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

/** Token OAuth de la cuenta de servicio del contenedor (Cloud Run), cacheado hasta un minuto antes de vencer. */
export class MetadataTokenSource implements AccessTokenSource {
  private cached: { token: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { fetchImpl?: typeof fetch | undefined; url?: string | undefined } = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.url = options.url ?? METADATA_TOKEN_URL;
  }
  private readonly url: string;

  async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.token;
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        headers: { 'metadata-flavor': 'Google' },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new IdentityLinkError(
        `Sin acceso al servidor de metadatos: ${(error as Error).message}`,
        'UNAVAILABLE',
      );
    }
    if (!response.ok) {
      throw new IdentityLinkError(
        `Servidor de metadatos: HTTP ${response.status}`,
        'UNAVAILABLE',
        response.status,
      );
    }
    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new IdentityLinkError('Token de acceso vacío', 'UNAVAILABLE');
    this.cached = {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 60) * 1000,
    };
    return data.access_token;
  }
}

export class IdentityToolkitLinks implements IdentityLinkGenerator {
  readonly source = 'metadata' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: {
      tokens: AccessTokenSource;
      /** Tenant de Identity Platform de los conductores, si existe. */
      tenantId?: string | undefined;
      fetchImpl?: typeof fetch | undefined;
      endpoint?: string | undefined;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async generate(
    kind: OobKind,
    email: string,
    options: { continueUrl?: string | undefined } = {},
  ): Promise<string> {
    const token = await this.options.tokens.token();
    let response: Response;
    try {
      response = await this.fetchImpl(
        this.options.endpoint ?? 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            requestType: kind,
            email,
            returnOobLink: true,
            ...(this.options.tenantId ? { tenantId: this.options.tenantId } : {}),
            ...(options.continueUrl ? { continueUrl: options.continueUrl } : {}),
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (error) {
      throw new IdentityLinkError(
        `Identity Platform no respondió: ${(error as Error).message}`,
        'UNAVAILABLE',
      );
    }
    if (!response.ok) {
      let reason = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { error?: { message?: string } };
        reason = body.error?.message ?? reason;
      } catch {
        // sin cuerpo
      }
      if (reason.startsWith('EMAIL_NOT_FOUND')) {
        throw new IdentityLinkError('La cuenta no existe', 'EMAIL_NOT_FOUND', response.status);
      }
      throw new IdentityLinkError(
        `Identity Platform rechazó el enlace: ${reason}`,
        'REJECTED',
        response.status,
      );
    }
    const data = (await response.json()) as { oobLink?: string };
    if (!data.oobLink)
      throw new IdentityLinkError('Respuesta sin enlace', 'REJECTED', response.status);
    return data.oobLink;
  }
}

/** Enlaces falsos hacia la página de acción de la app (local y pruebas). */
export class FakeIdentityLinks implements IdentityLinkGenerator {
  readonly source = 'fake' as const;
  readonly generated: { kind: OobKind; email: string; link: string }[] = [];

  constructor(private readonly appWebUrl: string) {}

  async generate(kind: OobKind, email: string): Promise<string> {
    const mode = kind === 'VERIFY_EMAIL' ? 'verifyEmail' : 'resetPassword';
    const link = `${this.appWebUrl.replace(/\/$/, '')}/auth/action?mode=${mode}&oobCode=fake-${randomBytes(8).toString('hex')}`;
    this.generated.push({ kind, email, link });
    return link;
  }
}
