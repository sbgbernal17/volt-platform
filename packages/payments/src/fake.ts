/**
 * Emulador de pasarela en memoria para pruebas y laboratorio: reproduce los estados de Wompi
 * (fuentes AVAILABLE/PENDING por 3DS, transacciones APPROVED/DECLINED/ERROR, anulación, reembolso,
 * enlaces de pago) y genera eventos de webhook firmados con el mismo checksum que Wompi, de modo que
 * la API y el worker se prueban de punta a punta sin red. Nunca se usa en producción.
 */
import { createHash } from 'node:crypto';
import { webhookChecksum } from './signature.ts';
import {
  type AcceptanceTokens,
  type ChargeInput,
  type CreatePaymentSourceInput,
  type GatewayTransaction,
  type PaymentGateway,
  PaymentGatewayError,
  type PaymentLink,
  type PaymentLinkInput,
  type PaymentSource,
  type RefundInput,
  type RefundResult,
  type TransactionStatus,
  type WebhookEvent,
} from './types.ts';
import { mapSource } from './wompi.ts';

export interface FakeCard {
  number: string;
  expMonth: string;
  expYear: string;
  cvc: string;
  cardHolder: string;
}

/** Tarjetas de prueba (mismas que el sandbox de Wompi para las dos primeras). */
export const FAKE_CARDS = {
  approved: '4242424242424242',
  declined: '4111111111111111',
  error: '4000000000000002',
} as const;

export const FAKE_ACCEPTANCE_TOKENS: AcceptanceTokens = {
  acceptanceToken: 'fake-acceptance-token',
  acceptancePermalink: 'https://fake.wompi/terms',
  personalDataAuthToken: 'fake-personal-data-token',
  personalDataPermalink: 'https://fake.wompi/personal-data',
};

export interface FakeGatewayOptions {
  /** Nombre del proveedor que se guarda en los pagos (permite dos emuladores en una misma base de datos). */
  provider?: string | undefined;
  eventsSecret?: string | undefined;
  /** Con `true` las transacciones nacen PENDING y se resuelven con `finalize()` (simula el webhook). */
  asyncTransactions?: boolean | undefined;
  clock?: (() => Date) | undefined;
}

interface FakeToken {
  kind: 'CARD' | 'NEQUI';
  outcome: TransactionStatus;
  threeDs: boolean;
  publicData: Record<string, string>;
}

interface FakeLink extends PaymentLink {
  amountMinor: bigint;
  currency: string;
  reference: string;
  paid: boolean;
}

export class FakeGateway implements PaymentGateway {
  readonly provider: string;
  readonly environment = 'fake' as const;
  readonly calls: { method: string; input: unknown }[] = [];
  readonly eventsSecret: string;
  private readonly asyncTransactions: boolean;
  private readonly now: () => Date;
  private readonly tokens = new Map<string, FakeToken>();
  private readonly sources = new Map<
    number,
    { source: PaymentSource; outcome: TransactionStatus }
  >();
  private readonly transactions = new Map<
    string,
    GatewayTransaction & { outcome: TransactionStatus }
  >();
  private readonly links = new Map<string, FakeLink>();
  private readonly references = new Set<string>();
  private seq = 0;

  constructor(options: FakeGatewayOptions = {}) {
    this.provider = options.provider ?? 'FAKE';
    this.eventsSecret = options.eventsSecret ?? 'fake-events-secret';
    this.asyncTransactions = options.asyncTransactions ?? false;
    this.now = options.clock ?? (() => new Date());
  }

  /** Lo que haría el widget de Wompi en la app: el número nunca llega al backend, solo el token. */
  tokenizeCard(card: FakeCard): string {
    const digits = card.number.replace(/\s+/g, '');
    const outcome: TransactionStatus =
      digits === FAKE_CARDS.declined
        ? 'DECLINED'
        : digits === FAKE_CARDS.error
          ? 'ERROR'
          : 'APPROVED';
    const token = `tok_fake_${createHash('sha256')
      .update(`${digits}:${++this.seq}`)
      .digest('hex')
      .slice(0, 24)}`;
    this.tokens.set(token, {
      kind: 'CARD',
      outcome,
      threeDs: /3DS/i.test(card.cardHolder),
      publicData: {
        type: 'CARD',
        brand: digits.startsWith('4') ? 'VISA' : digits.startsWith('5') ? 'MASTERCARD' : 'OTHER',
        last_four: digits.slice(-4),
        bin: digits.slice(0, 6),
        exp_month: card.expMonth,
        exp_year: card.expYear,
        card_holder: card.cardHolder,
      },
    });
    return token;
  }

  tokenizeNequi(phoneNumber: string): string {
    const token = `nequi_fake_${++this.seq}`;
    this.tokens.set(token, {
      kind: 'NEQUI',
      outcome: phoneNumber.endsWith('0') ? 'DECLINED' : 'APPROVED',
      threeDs: false,
      publicData: { type: 'NEQUI', phone_number: phoneNumber },
    });
    return token;
  }

  async getAcceptanceTokens(): Promise<AcceptanceTokens> {
    this.calls.push({ method: 'getAcceptanceTokens', input: null });
    return FAKE_ACCEPTANCE_TOKENS;
  }

  async createPaymentSource(input: CreatePaymentSourceInput): Promise<PaymentSource> {
    this.calls.push({ method: 'createPaymentSource', input });
    if (
      input.acceptanceToken !== FAKE_ACCEPTANCE_TOKENS.acceptanceToken ||
      input.personalDataAuthToken !== FAKE_ACCEPTANCE_TOKENS.personalDataAuthToken
    ) {
      throw new PaymentGatewayError('Tokens de aceptación inválidos', 'VALIDATION', 422, {
        messages: { acceptance_token: ['inválido'] },
      });
    }
    const token = this.tokens.get(input.token);
    if (!token || token.kind !== input.type) {
      throw new PaymentGatewayError('Token de pago inválido o vencido', 'VALIDATION', 422, {
        messages: { token: ['inválido'] },
      });
    }
    const id = 1000 + ++this.seq;
    const raw = {
      id,
      type: token.kind,
      status: token.threeDs ? 'PENDING' : 'AVAILABLE',
      customer_email: input.customerEmail,
      public_data: token.publicData,
      ...(token.threeDs
        ? {
            extra: {
              is_three_ds: true,
              three_ds_auth: {
                current_step: 'CHALLENGE',
                current_step_status: 'PENDING',
                three_ds_method_data: '&lt;iframe&gt;',
              },
            },
          }
        : {}),
    };
    const source = mapSource(raw);
    this.sources.set(id, { source, outcome: token.outcome });
    this.tokens.delete(input.token);
    return source;
  }

  /** El titular termina (o abandona) la autenticación 3DS. */
  completeThreeDs(sourceId: number, approved = true): PaymentSource {
    const entry = this.sources.get(sourceId);
    if (!entry) throw new PaymentGatewayError('Fuente de pago desconocida', 'NOT_FOUND', 404);
    const raw = {
      ...(entry.source.raw as Record<string, unknown>),
      status: approved ? 'AVAILABLE' : 'DECLINED',
      extra: {
        is_three_ds: true,
        three_ds_auth: {
          current_step: 'AUTHENTICATION',
          current_step_status: approved ? 'COMPLETED' : 'ERROR',
          three_ds_method_data: null,
        },
      },
    };
    entry.source = mapSource(raw);
    return entry.source;
  }

  async getPaymentSource(id: number): Promise<PaymentSource> {
    this.calls.push({ method: 'getPaymentSource', input: id });
    const entry = this.sources.get(id);
    if (!entry) throw new PaymentGatewayError('Fuente de pago desconocida', 'NOT_FOUND', 404);
    return entry.source;
  }

  async charge(input: ChargeInput): Promise<GatewayTransaction> {
    this.calls.push({ method: 'charge', input });
    const entry = this.sources.get(input.paymentSourceId);
    if (!entry)
      throw new PaymentGatewayError('Fuente de pago desconocida', 'VALIDATION', 422, {
        messages: { payment_source_id: ['no existe'] },
      });
    if (entry.source.status !== 'AVAILABLE') {
      throw new PaymentGatewayError(
        `La fuente de pago está ${entry.source.status}`,
        'VALIDATION',
        422,
      );
    }
    if (this.references.has(input.reference)) {
      throw new PaymentGatewayError('Referencia repetida', 'VALIDATION', 422, {
        messages: { reference: ['ya existe'] },
      });
    }
    this.references.add(input.reference);
    if (input.amountMinor <= 0n)
      throw new PaymentGatewayError('Importe inválido', 'VALIDATION', 422);
    const id = `fake-${this.now().getTime()}-${++this.seq}`;
    const pending = this.asyncTransactions;
    const transaction = {
      id,
      status: (pending ? 'PENDING' : entry.outcome) as TransactionStatus,
      statusMessage: pending
        ? null
        : entry.outcome === 'DECLINED'
          ? 'Transacción rechazada por el emisor'
          : null,
      reference: input.reference,
      amountMinor: input.amountMinor,
      currency: input.currency,
      paymentSourceId: input.paymentSourceId,
      paymentLinkId: null,
      paymentMethodType: entry.source.type,
      customerEmail: input.customerEmail,
      createdAt: this.now().toISOString(),
      finalizedAt: pending ? null : this.now().toISOString(),
      raw: null as unknown,
      outcome: entry.outcome,
    };
    transaction.raw = this.rawOf(transaction);
    this.transactions.set(id, transaction);
    return this.snapshot(transaction);
  }

  /** Resuelve una transacción PENDING (o fuerza otro estado) y devuelve el evento de webhook firmado. */
  finalize(transactionId: string, status?: TransactionStatus): Record<string, unknown> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) throw new PaymentGatewayError('Transacción desconocida', 'NOT_FOUND', 404);
    transaction.status = status ?? transaction.outcome;
    transaction.finalizedAt = this.now().toISOString();
    transaction.statusMessage =
      transaction.status === 'DECLINED' ? 'Transacción rechazada por el emisor' : null;
    transaction.raw = this.rawOf(transaction);
    return this.buildWebhookEvent(transactionId);
  }

  /** Evento `transaction.updated` con el mismo formato y checksum que Wompi. */
  buildWebhookEvent(
    transactionId: string,
    timestamp = Math.floor(this.now().getTime() / 1000),
  ): Record<string, unknown> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) throw new PaymentGatewayError('Transacción desconocida', 'NOT_FOUND', 404);
    const event = {
      event: 'transaction.updated',
      data: { transaction: this.rawOf(transaction) },
      environment: 'test',
      signature: {
        properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
        checksum: '',
      },
      timestamp,
      sent_at: new Date(timestamp * 1000).toISOString(),
    };
    event.signature.checksum = webhookChecksum(event, this.eventsSecret) ?? '';
    return event;
  }

  async getTransaction(id: string): Promise<GatewayTransaction> {
    this.calls.push({ method: 'getTransaction', input: id });
    const transaction = this.transactions.get(id);
    if (!transaction) throw new PaymentGatewayError('Transacción desconocida', 'NOT_FOUND', 404);
    return this.snapshot(transaction);
  }

  async voidTransaction(id: string): Promise<GatewayTransaction> {
    this.calls.push({ method: 'voidTransaction', input: id });
    const transaction = this.transactions.get(id);
    if (!transaction) throw new PaymentGatewayError('Transacción desconocida', 'NOT_FOUND', 404);
    if (transaction.status !== 'APPROVED')
      throw new PaymentGatewayError('Solo se anula una transacción aprobada', 'VALIDATION', 422);
    transaction.status = 'VOIDED';
    transaction.raw = this.rawOf(transaction);
    return this.snapshot(transaction);
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    this.calls.push({ method: 'refund', input });
    const transaction = this.transactions.get(input.transactionId);
    if (!transaction) throw new PaymentGatewayError('Transacción desconocida', 'NOT_FOUND', 404);
    if (transaction.status !== 'APPROVED')
      throw new PaymentGatewayError(
        'Solo se reembolsa una transacción aprobada',
        'VALIDATION',
        422,
      );
    if (input.amountMinor > transaction.amountMinor)
      throw new PaymentGatewayError('El reembolso supera el importe', 'VALIDATION', 422);
    return {
      id: `refund-${++this.seq}`,
      status: 'APPROVED',
      raw: { transaction_id: input.transactionId },
    };
  }

  async createPaymentLink(input: PaymentLinkInput): Promise<PaymentLink> {
    this.calls.push({ method: 'createPaymentLink', input });
    const id = `link_${++this.seq}`;
    const link: FakeLink = {
      id,
      url: `https://checkout.fake/l/${id}`,
      raw: { id },
      amountMinor: input.amountMinor,
      currency: input.currency,
      reference: input.reference,
      paid: false,
    };
    this.links.set(id, link);
    return { id: link.id, url: link.url, raw: link.raw };
  }

  /** El conductor paga el enlace (tarjeta, PSE o Nequi): transacción con `payment_link_id` y su webhook. */
  payLink(
    linkId: string,
    status: TransactionStatus = 'APPROVED',
    customerEmail = 'pagador@example.com',
  ): Record<string, unknown> {
    const link = this.links.get(linkId);
    if (!link) throw new PaymentGatewayError('Enlace desconocido', 'NOT_FOUND', 404);
    const id = `fake-link-${this.now().getTime()}-${++this.seq}`;
    const transaction = {
      id,
      status,
      statusMessage: null,
      reference: `${link.reference}-LINK`,
      amountMinor: link.amountMinor,
      currency: link.currency,
      paymentSourceId: null,
      paymentLinkId: linkId,
      paymentMethodType: 'PSE',
      customerEmail,
      createdAt: this.now().toISOString(),
      finalizedAt: this.now().toISOString(),
      raw: null as unknown,
      outcome: status,
    };
    transaction.raw = this.rawOf(transaction);
    this.transactions.set(id, transaction);
    if (status === 'APPROVED') link.paid = true;
    return this.buildWebhookEvent(id);
  }

  parseWebhook(body: unknown): WebhookEvent {
    const event = (body ?? {}) as Record<string, unknown> & {
      signature?: { properties?: unknown; checksum?: unknown };
      timestamp?: unknown;
    };
    const expected = webhookChecksum(event, this.eventsSecret);
    const presented = event.signature?.checksum;
    const checksumValid =
      !!expected && typeof presented === 'string' && presented.toUpperCase() === expected;
    const data = (event.data ?? {}) as Record<string, unknown>;
    const raw = data.transaction as Record<string, unknown> | undefined;
    const known = raw ? this.transactions.get(String(raw.id)) : undefined;
    const transaction: GatewayTransaction | null = raw
      ? {
          id: String(raw.id),
          status: (String(raw.status) as TransactionStatus) ?? 'ERROR',
          statusMessage:
            raw.status_message === undefined || raw.status_message === null
              ? null
              : String(raw.status_message),
          reference: String(raw.reference ?? ''),
          amountMinor:
            known?.amountMinor ?? BigInt(Math.round(Number(raw.amount_in_cents ?? 0) / 100)),
          currency: String(raw.currency ?? 'COP'),
          paymentSourceId: typeof raw.payment_source_id === 'number' ? raw.payment_source_id : null,
          paymentLinkId: raw.payment_link_id ? String(raw.payment_link_id) : null,
          paymentMethodType: raw.payment_method_type ? String(raw.payment_method_type) : null,
          customerEmail: raw.customer_email ? String(raw.customer_email) : null,
          createdAt: raw.created_at ? String(raw.created_at) : null,
          finalizedAt: raw.finalized_at ? String(raw.finalized_at) : null,
          raw,
        }
      : null;
    const timestamp = typeof event.timestamp === 'number' ? event.timestamp : null;
    return {
      event: String(event.event ?? 'unknown'),
      environment: event.environment ? String(event.environment) : null,
      timestamp,
      sentAt: event.sent_at ? String(event.sent_at) : null,
      checksumValid,
      dedupeKey: `${transaction?.id ?? 'unknown'}:${transaction?.status ?? ''}:${timestamp ?? ''}`,
      transaction,
      raw: body,
    };
  }

  private rawOf(transaction: GatewayTransaction): Record<string, unknown> {
    return {
      id: transaction.id,
      created_at: transaction.createdAt,
      finalized_at: transaction.finalizedAt,
      amount_in_cents: Number(transaction.amountMinor * 100n),
      reference: transaction.reference,
      customer_email: transaction.customerEmail,
      currency: transaction.currency,
      payment_method_type: transaction.paymentMethodType,
      payment_method: { type: transaction.paymentMethodType, installments: 1 },
      status: transaction.status,
      status_message: transaction.statusMessage,
      payment_source_id: transaction.paymentSourceId,
      payment_link_id: transaction.paymentLinkId,
    };
  }

  private snapshot(
    transaction: GatewayTransaction & { outcome?: TransactionStatus },
  ): GatewayTransaction {
    const { outcome: _ignored, ...rest } = transaction;
    return { ...rest, raw: this.rawOf(transaction) };
  }
}
