/**
 * Emulador de pasarela para pruebas, laboratorio y el ambiente dev: reproduce los estados de Wompi
 * (fuentes AVAILABLE/PENDING por 3DS, transacciones APPROVED/DECLINED/ERROR, anulación, reembolso,
 * enlaces de pago) y genera eventos de webhook firmados con el mismo checksum que Wompi, de modo que
 * la API y el worker se prueban de punta a punta sin red. Nunca se usa en producción.
 *
 * Es determinista por identificador: en la nube la API y el worker son procesos distintos (y la API
 * puede reiniciarse o escalar), así que el resultado de una tarjeta viaja dentro del token, de la
 * fuente de pago y de la transacción. Un emulador que no creó una fuente la cobra igual con el
 * resultado que su identificador declara; los identificadores antiguos (sin resultado) se tratan
 * como tarjeta aprobada.
 */
import { randomInt } from 'node:crypto';
import { webhookChecksum } from './signature.ts';
import {
  type AcceptanceTokens,
  type ChargeInput,
  type CreatePaymentSourceInput,
  type GatewayHealth,
  type GatewayTransaction,
  type PaymentGateway,
  PaymentGatewayError,
  type PaymentLink,
  type PaymentLinkInput,
  type PaymentSource,
  type PaymentSourceType,
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

type Outcome = Exclude<TransactionStatus, 'PENDING' | 'VOIDED'>;
type OutcomeLetter = 'A' | 'D' | 'E';

const OUTCOME_LETTER: Record<Outcome, OutcomeLetter> = { APPROVED: 'A', DECLINED: 'D', ERROR: 'E' };
const LETTER_OUTCOME: Record<OutcomeLetter, Outcome> = {
  A: 'APPROVED',
  D: 'DECLINED',
  E: 'ERROR',
};

/** Lo que viaja dentro de un token del emulador (`tok_fake_…` o `nequi_fake_…`). */
interface TokenPayload {
  k: PaymentSourceType;
  o: OutcomeLetter;
  /** Reto 3DS pendiente al crear la fuente (titular con "3DS" en el nombre). */
  t?: 1;
  b?: string;
  l4?: string;
  bin?: string;
  m?: string;
  y?: string;
  h?: string;
  p?: string;
}

interface SourceEntry {
  source: PaymentSource;
  outcome: Outcome;
}

interface FakeLink extends PaymentLink {
  amountMinor: bigint;
  currency: string;
  reference: string;
  paid: boolean;
}

type FakeTransaction = GatewayTransaction & { outcome: Outcome };

/**
 * Identificadores de fuente: a partir de SOURCE_BASE el último dígito declara tipo y resultado. Los
 * menores (emulador anterior, que numeraba desde 1001) no declaran nada y valen como tarjeta aprobada.
 */
const SOURCE_BASE = 10_000_000;
const SOURCE_CODES = {
  1: { kind: 'CARD', outcome: 'APPROVED', threeDs: false },
  2: { kind: 'CARD', outcome: 'DECLINED', threeDs: false },
  3: { kind: 'CARD', outcome: 'ERROR', threeDs: false },
  4: { kind: 'NEQUI', outcome: 'APPROVED', threeDs: false },
  5: { kind: 'NEQUI', outcome: 'DECLINED', threeDs: false },
  6: { kind: 'CARD', outcome: 'APPROVED', threeDs: true },
} as const satisfies Record<
  number,
  { kind: PaymentSourceType; outcome: Outcome; threeDs: boolean }
>;
type SourceCode = keyof typeof SOURCE_CODES;

function sourceCodeOf(kind: PaymentSourceType, outcome: Outcome, threeDs: boolean): SourceCode {
  if (kind === 'NEQUI') return outcome === 'APPROVED' ? 4 : 5;
  if (threeDs) return 6;
  return outcome === 'APPROVED' ? 1 : outcome === 'DECLINED' ? 2 : 3;
}

/** Tipo y resultado declarados por un identificador de fuente (los antiguos: tarjeta aprobada). */
export function decodeFakeSourceId(id: number): {
  kind: PaymentSourceType;
  outcome: Outcome;
  threeDs: boolean;
} {
  if (!Number.isInteger(id) || id < SOURCE_BASE) {
    return { kind: 'CARD', outcome: 'APPROVED', threeDs: false };
  }
  const code = SOURCE_CODES[(id % 10) as SourceCode];
  return code ?? { kind: 'CARD', outcome: 'APPROVED', threeDs: false };
}

function encodeToken(prefix: 'tok' | 'nequi', payload: TokenPayload): string {
  return `${prefix}_fake_${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

function decodeToken(token: string): TokenPayload | null {
  const match = /^(?:tok|nequi)_fake_([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(match[1] as string, 'base64url').toString('utf8'),
    ) as Partial<TokenPayload> | null;
    if (!parsed || (parsed.k !== 'CARD' && parsed.k !== 'NEQUI')) return null;
    if (parsed.o !== 'A' && parsed.o !== 'D' && parsed.o !== 'E') return null;
    return parsed as TokenPayload;
  } catch {
    return null;
  }
}

/** Estado final que declara un identificador de transacción del emulador (`fake-A-…`). */
export function decodeFakeTransactionId(id: string): TransactionStatus | null {
  if (!id.startsWith('fake-')) return null;
  const letter = id.slice(5, 6);
  if (id.charAt(6) !== '-') return 'APPROVED'; // formato antiguo `fake-<ts>-<n>`
  if (letter === 'P') return 'PENDING';
  return LETTER_OUTCOME[letter as OutcomeLetter] ?? null;
}

export class FakeGateway implements PaymentGateway {
  readonly provider: string;
  readonly environment = 'fake' as const;
  readonly calls: { method: string; input: unknown }[] = [];
  readonly eventsSecret: string;
  private readonly asyncTransactions: boolean;
  private readonly now: () => Date;
  private readonly sources = new Map<number, SourceEntry>();
  private readonly transactions = new Map<string, FakeTransaction>();
  private readonly links = new Map<string, FakeLink>();
  private readonly references = new Set<string>();
  /** Tokens ya consumidos en este proceso (Wompi los acepta una sola vez). */
  private readonly usedTokens = new Set<string>();
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
    const outcome: Outcome =
      digits === FAKE_CARDS.declined
        ? 'DECLINED'
        : digits === FAKE_CARDS.error
          ? 'ERROR'
          : 'APPROVED';
    return encodeToken('tok', {
      k: 'CARD',
      o: OUTCOME_LETTER[outcome],
      ...(/3DS/i.test(card.cardHolder) ? { t: 1 as const } : {}),
      b: digits.startsWith('4') ? 'VISA' : digits.startsWith('5') ? 'MASTERCARD' : 'OTHER',
      l4: digits.slice(-4),
      bin: digits.slice(0, 6),
      m: card.expMonth,
      y: card.expYear,
      h: card.cardHolder.trim(),
    });
  }

  tokenizeNequi(phoneNumber: string): string {
    return encodeToken('nequi', {
      k: 'NEQUI',
      o: phoneNumber.endsWith('0') ? 'D' : 'A',
      p: phoneNumber,
    });
  }

  async health(): Promise<GatewayHealth> {
    return { ok: true, latencyMs: 0, merchant: 'Emulador VOLT', error: null };
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
    const token = decodeToken(input.token);
    if (!token || token.k !== input.type || this.usedTokens.has(input.token)) {
      throw new PaymentGatewayError('Token de pago inválido o vencido', 'VALIDATION', 422, {
        messages: { token: ['inválido'] },
      });
    }
    this.usedTokens.add(input.token);
    const outcome = LETTER_OUTCOME[token.o];
    const threeDs = token.t === 1;
    const id = SOURCE_BASE + randomInt(1, 1e11) * 10 + sourceCodeOf(token.k, outcome, threeDs);
    const publicData =
      token.k === 'NEQUI'
        ? { type: 'NEQUI', phone_number: token.p ?? '' }
        : {
            type: 'CARD',
            brand: token.b ?? 'VISA',
            last_four: token.l4 ?? '0000',
            bin: token.bin ?? '',
            exp_month: token.m ?? '',
            exp_year: token.y ?? '',
            card_holder: token.h ?? '',
          };
    const source = mapSource(
      this.rawSource(id, token.k, threeDs ? 'PENDING' : 'AVAILABLE', input.customerEmail, {
        publicData,
        threeDsPending: threeDs,
      }),
    );
    this.sources.set(id, { source, outcome });
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
    return this.sourceEntry(id).source;
  }

  async charge(input: ChargeInput): Promise<GatewayTransaction> {
    this.calls.push({ method: 'charge', input });
    const entry = this.sourceEntry(input.paymentSourceId);
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
    const pending = this.asyncTransactions;
    const id = this.transactionId(pending ? 'P' : OUTCOME_LETTER[entry.outcome]);
    const transaction: FakeTransaction = {
      id,
      status: pending ? 'PENDING' : entry.outcome,
      statusMessage:
        !pending && entry.outcome === 'DECLINED' ? 'Transacción rechazada por el emisor' : null,
      reference: input.reference,
      amountMinor: input.amountMinor,
      currency: input.currency,
      paymentSourceId: input.paymentSourceId,
      paymentLinkId: null,
      paymentMethodType: entry.source.type,
      customerEmail: input.customerEmail,
      createdAt: this.now().toISOString(),
      finalizedAt: pending ? null : this.now().toISOString(),
      raw: null,
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
    return this.snapshot(this.transactionEntry(id));
  }

  async voidTransaction(id: string): Promise<GatewayTransaction> {
    this.calls.push({ method: 'voidTransaction', input: id });
    const transaction = this.transactionEntry(id);
    if (transaction.status !== 'APPROVED')
      throw new PaymentGatewayError('Solo se anula una transacción aprobada', 'VALIDATION', 422);
    transaction.status = 'VOIDED';
    transaction.raw = this.rawOf(transaction);
    return this.snapshot(transaction);
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    this.calls.push({ method: 'refund', input });
    const transaction = this.transactionEntry(input.transactionId);
    if (transaction.status !== 'APPROVED')
      throw new PaymentGatewayError(
        'Solo se reembolsa una transacción aprobada',
        'VALIDATION',
        422,
      );
    if (transaction.amountMinor > 0n && input.amountMinor > transaction.amountMinor)
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
    const outcome: Outcome = status === 'PENDING' || status === 'VOIDED' ? 'APPROVED' : status;
    const id = this.transactionId(status === 'PENDING' ? 'P' : OUTCOME_LETTER[outcome]);
    const transaction: FakeTransaction = {
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
      raw: null,
      outcome,
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
      environment: typeof event.environment === 'string' ? event.environment : null,
      timestamp,
      sentAt: typeof event.sent_at === 'string' ? event.sent_at : null,
      checksumValid,
      dedupeKey: `${transaction?.id ?? 'unknown'}:${transaction?.status ?? ''}:${timestamp ?? ''}`,
      transaction,
      raw: body,
    };
  }

  private transactionId(letter: OutcomeLetter | 'P'): string {
    return `fake-${letter}-${this.now().getTime()}-${++this.seq}`;
  }

  /** Fuente conocida en este proceso o reconstruida a partir de su identificador. */
  private sourceEntry(id: number): SourceEntry {
    const known = this.sources.get(id);
    if (known) return known;
    if (!Number.isInteger(id) || id <= 0) {
      throw new PaymentGatewayError('Fuente de pago desconocida', 'VALIDATION', 422, {
        messages: { payment_source_id: ['no existe'] },
      });
    }
    const decoded = decodeFakeSourceId(id);
    const publicData =
      decoded.kind === 'NEQUI'
        ? { type: 'NEQUI', phone_number: '3000000000' }
        : { type: 'CARD', brand: 'VISA', last_four: '4242' };
    const entry: SourceEntry = {
      source: mapSource(
        this.rawSource(id, decoded.kind, decoded.threeDs ? 'PENDING' : 'AVAILABLE', null, {
          publicData,
          threeDsPending: decoded.threeDs,
        }),
      ),
      outcome: decoded.outcome,
    };
    this.sources.set(id, entry);
    return entry;
  }

  /** Transacción conocida en este proceso o reconstruida a partir de su identificador. */
  private transactionEntry(id: string): FakeTransaction {
    const known = this.transactions.get(id);
    if (known) return known;
    const status = decodeFakeTransactionId(id);
    if (!status) throw new PaymentGatewayError('Transacción desconocida', 'NOT_FOUND', 404);
    const outcome: Outcome = status === 'PENDING' || status === 'VOIDED' ? 'APPROVED' : status;
    const transaction: FakeTransaction = {
      id,
      status,
      statusMessage: status === 'DECLINED' ? 'Transacción rechazada por el emisor' : null,
      reference: '',
      amountMinor: 0n,
      currency: 'COP',
      paymentSourceId: null,
      paymentLinkId: null,
      paymentMethodType: null,
      customerEmail: null,
      createdAt: null,
      finalizedAt: status === 'PENDING' ? null : this.now().toISOString(),
      raw: null,
      outcome,
    };
    transaction.raw = this.rawOf(transaction);
    this.transactions.set(id, transaction);
    return transaction;
  }

  private rawSource(
    id: number,
    kind: PaymentSourceType,
    status: 'AVAILABLE' | 'PENDING',
    customerEmail: string | null,
    options: { publicData: Record<string, string>; threeDsPending: boolean },
  ): Record<string, unknown> {
    return {
      id,
      type: kind,
      status,
      customer_email: customerEmail,
      public_data: options.publicData,
      ...(options.threeDsPending
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
  }

  private snapshot(transaction: FakeTransaction): GatewayTransaction {
    const { outcome: _outcome, ...rest } = transaction;
    return { ...rest, raw: this.rawOf(transaction) };
  }

  private rawOf(transaction: FakeTransaction): Record<string, unknown> {
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
}
