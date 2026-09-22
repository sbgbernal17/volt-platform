import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { constantTimeEquals } from '@volt/security';
import type { Logger } from 'pino';

export interface InternalCallRequest {
  chargeBoxId: string;
  action: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
}

export interface InternalResponse {
  status: number;
  body: unknown;
}

export interface InternalApiHandlers {
  sendCall(request: InternalCallRequest): Promise<InternalResponse>;
  connectionInfo(chargeBoxId: string): InternalResponse;
  disconnect(chargeBoxId: string, code: number, reason: string): Promise<InternalResponse>;
}

const MAX_BODY_BYTES = 256 * 1024;

/**
 * API interna HTTP/JSON del gateway (ADR 0013; equivalente al contrato gRPC de ARQ §6.3):
 *   POST /internal/v1/calls                                   -> CALL a un cargador y su resultado
 *   GET  /internal/v1/connections/{chargeBoxId}               -> estado de la conexión
 *   POST /internal/v1/connections/{chargeBoxId}/disconnect    -> cierre administrativo
 * Protegida con `Authorization: Bearer <OCPP_GATEWAY_INTERNAL_TOKEN>`.
 */
export class InternalApi {
  private server: Server | undefined;

  constructor(
    private readonly handlers: InternalApiHandlers,
    private readonly token: string | undefined,
    private readonly logger: Logger,
  ) {}

  async listen(port: number, host: string): Promise<number> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server?.listen(port, host, resolve));
    const address = this.server.address();
    return typeof address === 'object' && address ? address.port : port;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!this.token) {
        send(res, 503, {
          error: { code: 'INTERNAL', description: 'API interna sin token configurado' },
        });
        return;
      }
      const header = req.headers.authorization ?? '';
      const [scheme, presented] = header.split(' ');
      if (
        scheme?.toLowerCase() !== 'bearer' ||
        !presented ||
        !constantTimeEquals(presented, this.token)
      ) {
        send(res, 401, { error: { code: 'UNAUTHORIZED', description: 'Token interno inválido' } });
        return;
      }
      const url = new URL(req.url ?? '/', 'http://internal');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'internal' || parts[1] !== 'v1') {
        send(res, 404, { error: { code: 'NOT_FOUND', description: 'Ruta desconocida' } });
        return;
      }
      if (parts[2] === 'calls' && parts.length === 3 && req.method === 'POST') {
        const body = await readJson(req);
        if (!body || typeof body !== 'object') {
          send(res, 400, {
            error: { code: 'INVALID_REQUEST', description: 'Cuerpo JSON inválido' },
          });
          return;
        }
        const { chargeBoxId, action, payload, timeoutMs } = body as Record<string, unknown>;
        if (
          typeof chargeBoxId !== 'string' ||
          typeof action !== 'string' ||
          (payload !== undefined && typeof payload !== 'object')
        ) {
          send(res, 400, {
            error: {
              code: 'INVALID_REQUEST',
              description: 'chargeBoxId, action y payload son obligatorios',
            },
          });
          return;
        }
        const result = await this.handlers.sendCall({
          chargeBoxId,
          action,
          payload: (payload ?? {}) as Record<string, unknown>,
          ...(typeof timeoutMs === 'number' ? { timeoutMs } : {}),
        });
        send(res, result.status, result.body);
        return;
      }
      if (parts[2] === 'connections' && parts[3]) {
        const chargeBoxId = decodeURIComponent(parts[3]);
        if (parts.length === 4 && req.method === 'GET') {
          const result = this.handlers.connectionInfo(chargeBoxId);
          send(res, result.status, result.body);
          return;
        }
        if (parts.length === 5 && parts[4] === 'disconnect' && req.method === 'POST') {
          const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
          const code = typeof body.code === 'number' ? body.code : 1008;
          const reason = typeof body.reason === 'string' ? body.reason : 'Administrative close';
          const result = await this.handlers.disconnect(chargeBoxId, code, reason);
          send(res, result.status, result.body);
          return;
        }
      }
      send(res, 404, { error: { code: 'NOT_FOUND', description: 'Ruta desconocida' } });
    } catch (error) {
      this.logger.error({ err: error }, 'error en la API interna');
      send(res, 500, { error: { code: 'INTERNAL', description: 'Error interno del gateway' } });
    }
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (body === undefined || status === 204) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('cuerpo demasiado grande');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}
