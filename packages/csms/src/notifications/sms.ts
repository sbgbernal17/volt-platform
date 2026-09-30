/**
 * Puerto de envío de SMS (ADR 0031): lo que el dominio necesita de un proveedor de mensajes sin
 * conocer su API. Los adaptadores reales (Twilio, Brevo) viven en la API; el emulador registra el
 * mensaje y sirve en pruebas y en los ambientes sin proveedor.
 */
export interface SmsMessage {
  /** Destino en formato E.164 (+573001234567). */
  to: string;
  body: string;
}

export interface SmsReceipt {
  /** Identificador del mensaje en el proveedor, si lo da. */
  id: string | null;
}

export interface SmsSender {
  /** `fake` para el emulador; en producción es obligatorio un proveedor real. */
  readonly provider: string;
  send(message: SmsMessage): Promise<SmsReceipt>;
}

export class SmsError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status: number | null = null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'SmsError';
  }
}

export interface SmsLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

/** Emulador: guarda los mensajes en memoria y los registra (con el texto) en el log. */
export class FakeSmsSender implements SmsSender {
  readonly provider = 'fake';
  readonly sent: SmsMessage[] = [];
  constructor(private readonly logger?: SmsLogger | undefined) {}

  async send(message: SmsMessage): Promise<SmsReceipt> {
    this.sent.push(message);
    this.logger?.info({ to: message.to, body: message.body }, 'SMS emulado');
    return { id: `fake-sms-${this.sent.length}` };
  }
}
