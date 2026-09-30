/**
 * Adaptadores de correo transaccional (ADR 0032): Resend y Brevo con la biblioteca estándar (fetch).
 * La clave llega por variable de entorno desde Secret Manager (`email-provider-api-key`) y nunca se
 * registra. El remitente es "VOLT <noreply@supercargadores.co>" (dominio verificado en el proveedor).
 */
import {
  EmailError,
  type EmailMessage,
  type EmailReceipt,
  type EmailSender,
  FakeEmailSender,
} from '@volt/csms';
import type { ApiConfig } from '../config.ts';

const TIMEOUT_MS = 10_000;

/** "VOLT <noreply@supercargadores.co>" → nombre y dirección. */
export function parseSender(from: string): { name: string; email: string } {
  const match = /^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(from);
  if (match) return { name: (match[1] ?? '').trim() || 'VOLT', email: (match[2] as string).trim() };
  return { name: 'VOLT', email: from.trim() };
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; name?: string; code?: string };
    return body.message
      ? `${body.message}${(body.code ?? body.name) ? ` (${body.code ?? body.name})` : ''}`
      : `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export class ResendEmailSender implements EmailSender {
  readonly provider = 'resend';
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: {
      apiKey: string;
      from: string;
      fetchImpl?: typeof fetch | undefined;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async send(message: EmailMessage): Promise<EmailReceipt> {
    let response: Response;
    try {
      response = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new EmailError(
        `Resend no respondió: ${(error as Error).message}`,
        this.provider,
        null,
        true,
      );
    }
    if (!response.ok) {
      throw new EmailError(
        `Resend rechazó el correo: ${await readError(response)}`,
        this.provider,
        response.status,
        retryable(response.status),
      );
    }
    const data = (await response.json()) as { id?: string };
    return { id: data.id ?? null };
  }
}

export class BrevoEmailSender implements EmailSender {
  readonly provider = 'brevo';
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: {
      apiKey: string;
      from: string;
      fetchImpl?: typeof fetch | undefined;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async send(message: EmailMessage): Promise<EmailReceipt> {
    const sender = parseSender(this.options.from);
    let response: Response;
    try {
      response = await this.fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.options.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender,
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
          tags: ['volt-identidad'],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new EmailError(
        `Brevo no respondió: ${(error as Error).message}`,
        this.provider,
        null,
        true,
      );
    }
    if (!response.ok) {
      throw new EmailError(
        `Brevo rechazó el correo: ${await readError(response)}`,
        this.provider,
        response.status,
        retryable(response.status),
      );
    }
    const data = (await response.json()) as { messageId?: string };
    return { id: data.messageId ?? null };
  }
}

/** Remitente según la configuración; `undefined` con EMAIL_PROVIDER=none. */
export function buildEmailSender(
  config: Pick<ApiConfig, 'EMAIL_PROVIDER' | 'EMAIL_FROM' | 'EMAIL_PROVIDER_API_KEY'>,
  logger: { info(obj: Record<string, unknown>, msg: string): void },
): EmailSender | undefined {
  switch (config.EMAIL_PROVIDER) {
    case 'fake':
      return new FakeEmailSender(logger);
    case 'resend':
      return new ResendEmailSender({
        apiKey: config.EMAIL_PROVIDER_API_KEY as string,
        from: config.EMAIL_FROM,
      });
    case 'brevo':
      return new BrevoEmailSender({
        apiKey: config.EMAIL_PROVIDER_API_KEY as string,
        from: config.EMAIL_FROM,
      });
    default:
      return undefined;
  }
}
