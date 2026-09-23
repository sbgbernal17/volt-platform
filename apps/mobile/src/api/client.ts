/**
 * Cliente de la API pública `/v1`: añade el token de la identidad actual, convierte los errores en
 * `ApiError` (código, mensaje y detalles de la respuesta) y parsea JSON. La URL base viene de
 * `EXPO_PUBLIC_API_URL`; en Expo Go sin esa variable se usa la máquina que sirve el bundle.
 */
import Constants from 'expo-constants';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type TokenProvider = () => Promise<string | null>;

export function defaultApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:8080`;
  return 'http://localhost:8080';
}

export interface ApiClientOptions {
  baseUrl: string;
  token: TokenProvider;
  fetchImpl?: typeof fetch | undefined;
  onUnauthorized?: ((error: ApiError) => void) | undefined;
}

export type Query = Record<string, string | number | boolean | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export class ApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', withQuery(path, query));
  }

  post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, body, headers);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  /** URL absoluta de un recurso de /v1 (p. ej. el recibo HTML para abrirlo en el navegador). */
  url(path: string): string {
    return `${this.options.baseUrl}/v1${path.startsWith('/v1/') ? path.slice(3) : path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extra?: Record<string, string>,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', ...(extra ?? {}) };
    const token = await this.options.token();
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new ApiError(0, 'NETWORK', (error as Error).message);
    }
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const payload = (data ?? {}) as {
        error?: { code?: string; message?: string; details?: unknown };
      };
      const error = new ApiError(
        response.status,
        payload.error?.code ?? `HTTP_${response.status}`,
        payload.error?.message ?? `Error ${response.status}`,
        payload.error?.details ?? null,
        data,
      );
      if (response.status === 401) this.options.onUnauthorized?.(error);
      throw error;
    }
    return data as T;
  }
}

export function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : 'UNKNOWN';
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError)
    return error.code === 'NETWORK' ? fallback : error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}
