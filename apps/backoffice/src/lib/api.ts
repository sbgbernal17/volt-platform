/**
 * Cliente de /admin/v1: añade el token de la identidad actual, convierte errores de la API en
 * `ApiError` (código y detalles de la respuesta) y parsea JSON.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type TokenProvider = () => Promise<string | null>;

export interface ApiClientOptions {
  baseUrl: string;
  token: TokenProvider;
  /** Cabeceras adicionales por petición (p. ej. `x-actor` en modo laboratorio). */
  headers?: (() => Record<string, string>) | undefined;
  fetchImpl?: typeof fetch | undefined;
  /** Se invoca en 401 para cerrar la sesión local. */
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

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', withQuery(path, query));
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
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

  /** URL absoluta de un recurso (para abrirlo en otra pestaña, p. ej. el recibo HTML). */
  url(path: string): string {
    return `${this.options.baseUrl}/admin/v1${path}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(this.options.headers?.() ?? {}),
    };
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
      );
      if (response.status === 401) this.options.onUnauthorized?.(error);
      throw error;
    }
    return data as T;
  }
}
