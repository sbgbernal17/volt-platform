/**
 * Puerto de envío de correo transaccional (ADR 0032): verificación de correo y contraseña nueva con
 * el cuerpo de la marca (botón), y más adelante recibos. Los adaptadores reales (Resend, Brevo) viven
 * en la API; el emulador guarda los mensajes y sirve en pruebas.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailReceipt {
  id: string | null;
}

export interface EmailSender {
  /** `fake` para el emulador; en producción es obligatorio un proveedor real. */
  readonly provider: string;
  send(message: EmailMessage): Promise<EmailReceipt>;
}

export class EmailError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status: number | null = null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'EmailError';
  }
}

export interface EmailLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

/** Emulador: guarda los correos en memoria y registra destinatario y asunto (nunca el cuerpo). */
export class FakeEmailSender implements EmailSender {
  readonly provider = 'fake';
  readonly sent: EmailMessage[] = [];
  constructor(private readonly logger?: EmailLogger | undefined) {}

  async send(message: EmailMessage): Promise<EmailReceipt> {
    this.sent.push(message);
    this.logger?.info({ to: message.to, subject: message.subject }, 'correo emulado');
    return { id: `fake-email-${this.sent.length}` };
  }
}

export type EmailTemplateKind = 'verify-email' | 'reset-password';

export interface EmailTemplate {
  subject: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sustituye los marcadores de las plantillas de `infra/identity/templates` (`%LINK%`, `%EMAIL%`,
 * `{{APP_HOST}}`) y produce la versión de texto plano.
 */
export function renderEmail(
  template: EmailTemplate,
  values: { link: string; email: string; appHost: string },
): Omit<EmailMessage, 'to'> {
  const html = template.html
    .replace(/%LINK%/g, escapeHtml(values.link))
    .replace(/%EMAIL%/g, escapeHtml(values.email))
    .replace(/\{\{APP_HOST\}\}/g, escapeHtml(values.appHost));
  const text = `${template.subject}\n\n${values.link}\n\nVOLT · Supercargadores Vehiculares S.A.S.`;
  return { subject: template.subject, html, text };
}
