/**
 * Adaptadores de SMS para la verificación del celular (ADR 0031): Twilio (Programmable Messaging) y
 * Brevo (SMS transaccional), con la biblioteca estándar (fetch). Las credenciales llegan por
 * variables de entorno desde Secret Manager; nunca se registran.
 */
import {
  FakeSmsSender,
  SmsError,
  type SmsMessage,
  type SmsReceipt,
  type SmsSender,
} from '@volt/csms';
import type { ApiConfig } from '../config.ts';

const TIMEOUT_MS = 10_000;

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; code?: string | number };
    return body.message
      ? `${body.message}${body.code ? ` (${body.code})` : ''}`
      : `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export class TwilioSmsSender implements SmsSender {
  readonly provider = 'twilio';
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: {
      accountSid: string;
      authToken: string;
      /** Número E.164 del remitente o SID de un Messaging Service (MG…). */
      from: string;
      fetchImpl?: typeof fetch | undefined;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async send(message: SmsMessage): Promise<SmsReceipt> {
    const form = new URLSearchParams({ To: message.to, Body: message.body });
    form.set(
      this.options.from.startsWith('MG') ? 'MessagingServiceSid' : 'From',
      this.options.from,
    );
    const credentials = Buffer.from(
      `${this.options.accountSid}:${this.options.authToken}`,
    ).toString('base64');
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.options.accountSid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${credentials}`,
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
          },
          body: form.toString(),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
    } catch (error) {
      throw new SmsError(
        `Twilio no respondió: ${(error as Error).message}`,
        this.provider,
        null,
        true,
      );
    }
    if (!response.ok) {
      throw new SmsError(
        `Twilio rechazó el SMS: ${await readError(response)}`,
        this.provider,
        response.status,
        retryable(response.status),
      );
    }
    const data = (await response.json()) as { sid?: string };
    return { id: data.sid ?? null };
  }
}

export class BrevoSmsSender implements SmsSender {
  readonly provider = 'brevo';
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: {
      apiKey: string;
      /** Nombre alfanumérico (hasta 11 caracteres) o número autorizado en Brevo. */
      sender: string;
      fetchImpl?: typeof fetch | undefined;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async send(message: SmsMessage): Promise<SmsReceipt> {
    let response: Response;
    try {
      response = await this.fetchImpl('https://api.brevo.com/v3/transactionalSMS/send', {
        method: 'POST',
        headers: {
          'api-key': this.options.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: this.options.sender,
          recipient: message.to.replace(/^\+/, ''),
          content: message.body,
          type: 'transactional',
          tag: 'volt-celular',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new SmsError(
        `Brevo no respondió: ${(error as Error).message}`,
        this.provider,
        null,
        true,
      );
    }
    if (!response.ok) {
      throw new SmsError(
        `Brevo rechazó el SMS: ${await readError(response)}`,
        this.provider,
        response.status,
        retryable(response.status),
      );
    }
    const data = (await response.json()) as { messageId?: number | string; reference?: string };
    return { id: data.messageId !== undefined ? String(data.messageId) : (data.reference ?? null) };
  }
}

/** Remitente según la configuración; `undefined` con SMS_PROVIDER=none. */
export function buildSmsSender(
  config: Pick<
    ApiConfig,
    'SMS_PROVIDER' | 'SMS_SENDER' | 'SMS_PROVIDER_API_KEY' | 'TWILIO_ACCOUNT_SID'
  >,
  logger: { info(obj: Record<string, unknown>, msg: string): void },
): SmsSender | undefined {
  switch (config.SMS_PROVIDER) {
    case 'fake':
      return new FakeSmsSender(logger);
    case 'twilio':
      return new TwilioSmsSender({
        accountSid: config.TWILIO_ACCOUNT_SID as string,
        authToken: config.SMS_PROVIDER_API_KEY as string,
        from: config.SMS_SENDER as string,
      });
    case 'brevo':
      return new BrevoSmsSender({
        apiKey: config.SMS_PROVIDER_API_KEY as string,
        sender: config.SMS_SENDER as string,
      });
    default:
      return undefined;
  }
}
