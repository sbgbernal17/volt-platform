/**
 * Adaptador de Wompi Colombia sobre el puerto `PaymentGateway` (ADR 0002, ADR 0020). Usa `fetch` de
 * Node, llaves por ambiente (sandbox `pub_test_`/`prv_test_`, producción `pub_prod_`/`prv_prod_`) y
 * nunca escribe las llaves ni los secretos en errores ni en logs. Los importes se convierten a
 * centavos (COP en pesos enteros × 100) y se firman con el secreto de integridad.
 *
 * Endpoints (documento `docs/proveedor/wompi.md` y referencia OpenAPI 1.2.0): `GET /merchants/{pub}`,
 * `POST /payment_sources`, `GET /payment_sources/{id}`, `POST /transactions`, `GET /transactions/{id}`,
 * `POST /transactions/{id}/void`, `POST /refunds`, `POST /payment_links`.
 */
import { fromCents, integritySignature, toCents, verifyWebhookChecksum } from './signature.ts';
import {
  type AcceptanceTokens,
  type ChargeInput,
  type CreatePaymentSourceInput,
  type GatewayTransaction,
  type PaymentGateway,
  PaymentGatewayError,
  type PaymentGatewayErrorCode,
  type PaymentLink,
  type PaymentLinkInput,
  type PaymentSource,
  type PaymentSourceStatus,
  type RefundInput,
  type RefundResult,
  type TransactionStatus,
  type WebhookEvent,
} from './types.ts';

export interface WompiGatewayOptions {
  environment: 'sandbox' | 'production';
  publicKey: string;
  privateKey: string;
  integritySecret: string;
  eventsSecret: string;
  fetchImpl?: typeof fetch | undefined;
  /** Solo para pruebas: sustituye la URL base del ambiente. */
  baseUrl?: string | undefined;
  checkoutBaseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  /** Exponente operativo por moneda (COP se opera en pesos enteros, ADR 0017). */
  currencyExponents?: Record<string, number> | undefined;
}

export const WOMPI_BASE_URLS = {
  sandbox: 'https://sandbox.wompi.co/v1',
  production: 'https://production.wompi.co/v1',
} as const;

/** Prefijos de las llaves de Wompi por ambiente; el adaptador rechaza llaves de otro ambiente. */
export const WOMPI_KEY_PREFIXES = {
  sandbox: { public: 'pub_test_', private: 'prv_test_' },
  production: { public: 'pub_prod_', private: 'prv_prod_' },
} as const;

const TRANSACTION_STATUSES: readonly TransactionStatus[] = [
  'PENDING',
  'APPROVED',
  'DECLINED',
  'VOIDED',
  'ERROR',
];
const SOURCE_STATUSES: readonly PaymentSourceStatus[] = [
  'AVAILABLE',
  'PENDING',
  'DECLINED',
  'ERROR',
  'VOIDED',
];

type Json = Record<string, unknown>;

export class WompiGateway implements PaymentGateway {
  readonly provider = 'WOMPI';
  readonly environment: 'sandbox' | 'production';
  private readonly baseUrl: string;
  private readonly checkoutBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly currencyExponents: Record<string, number>;
  private readonly publicKey: string;
  private readonly privateKey: string;
  private readonly integritySecret: string;
  private readonly eventsSecret: string;

  constructor(options: WompiGatewayOptions) {
    this.environment = options.environment;
    const prefixes = WOMPI_KEY_PREFIXES[options.environment];
    if (
      !options.publicKey.startsWith(prefixes.public) ||
      !options.privateKey.startsWith(prefixes.private)
    ) {
      throw new Error(`Las llaves de Wompi no corresponden al ambiente ${options.environment}`);
    }
    if (!options.integritySecret || !options.eventsSecret) {
      throw new Error('Faltan el secreto de integridad o el secreto de eventos de Wompi');
    }
    this.publicKey = options.publicKey;
    this.privateKey = options.privateKey;
    this.integritySecret = options.integritySecret;
    this.eventsSecret = options.eventsSecret;
    this.baseUrl = (options.baseUrl ?? WOMPI_BASE_URLS[options.environment]).replace(/\/$/, '');
    this.checkoutBaseUrl = (options.checkoutBaseUrl ?? 'https://checkout.wompi.co').replace(
      /\/$/,
      '',
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.currencyExponents = options.currencyExponents ?? { COP: 0, USD: 2 };
  }

  /**
   * Tokeniza una tarjeta con la llave pública. Solo para pruebas contra el sandbox: en la app lo
   * hace el widget de Wompi y el número de tarjeta nunca pasa por Volt.
   */
  async tokenizeCardForTesting(card: {
    number: string;
    cvc: string;
    expMonth: string;
    expYear: string;
    cardHolder: string;
  }): Promise<string> {
    if (this.environment !== 'sandbox')
      throw new Error('La tokenización directa solo está permitida en sandbox');
    const json = await this.request<{ data?: Json }>('POST', '/tokens/cards', {
      auth: 'public',
      body: {
        number: card.number,
        cvc: card.cvc,
        exp_month: card.expMonth,
        exp_year: card.expYear,
        card_holder: card.cardHolder,
      },
    });
    const token = str(json.data?.id);
    if (!token)
      throw new PaymentGatewayError(
        'Wompi no devolvió el token de la tarjeta',
        'PROVIDER',
        undefined,
        json.data,
      );
    return token;
  }

  async getAcceptanceTokens(): Promise<AcceptanceTokens> {
    const json = await this.request<{ data?: Json }>('GET', `/merchants/${this.publicKey}`, {
      auth: 'none',
    });
    const data = json.data ?? {};
    const acceptance = (data.presigned_acceptance ?? {}) as Json;
    const personal = (data.presigned_personal_data_auth ?? {}) as Json;
    const acceptanceToken = str(acceptance.acceptance_token);
    const personalToken = str(personal.acceptance_token);
    if (!acceptanceToken || !personalToken) {
      throw new PaymentGatewayError(
        'Wompi no devolvió los tokens de aceptación',
        'PROVIDER',
        undefined,
        data,
      );
    }
    return {
      acceptanceToken,
      acceptancePermalink: str(acceptance.permalink) || null,
      personalDataAuthToken: personalToken,
      personalDataPermalink: str(personal.permalink) || null,
    };
  }

  async createPaymentSource(input: CreatePaymentSourceInput): Promise<PaymentSource> {
    const json = await this.request<{ data?: Json }>('POST', '/payment_sources', {
      auth: 'private',
      body: {
        type: input.type,
        token: input.token,
        customer_email: input.customerEmail,
        acceptance_token: input.acceptanceToken,
        accept_personal_auth: input.personalDataAuthToken,
      },
    });
    return mapSource(json.data ?? {});
  }

  async getPaymentSource(id: number): Promise<PaymentSource> {
    const json = await this.request<{ data?: Json }>('GET', `/payment_sources/${id}`, {
      auth: 'private',
    });
    return mapSource(json.data ?? {});
  }

  async charge(input: ChargeInput): Promise<GatewayTransaction> {
    const amountInCents = toCents(input.amountMinor, input.currencyExponent);
    const signature = integritySignature({
      reference: input.reference,
      amountInCents,
      currency: input.currency,
      secret: this.integritySecret,
    });
    const body: Json = {
      amount_in_cents: Number(amountInCents),
      currency: input.currency,
      signature,
      customer_email: input.customerEmail,
      reference: input.reference,
      payment_source_id: input.paymentSourceId,
      recurrent: input.recurrent ?? false,
    };
    if (input.installments !== undefined)
      body.payment_method = { installments: input.installments };
    const json = await this.request<{ data?: Json }>('POST', '/transactions', {
      auth: 'private',
      body,
    });
    return this.mapTransaction(json.data ?? {});
  }

  async getTransaction(id: string): Promise<GatewayTransaction> {
    const json = await this.request<{ data?: Json }>(
      'GET',
      `/transactions/${encodeURIComponent(id)}`,
      {
        auth: 'private',
      },
    );
    return this.mapTransaction(json.data ?? {});
  }

  async voidTransaction(id: string): Promise<GatewayTransaction> {
    const json = await this.request<{ data?: Json }>(
      'POST',
      `/transactions/${encodeURIComponent(id)}/void`,
      {
        auth: 'private',
        body: {},
      },
    );
    return this.mapTransaction(json.data ?? {});
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const json = await this.request<{ data?: Json }>('POST', '/refunds', {
      auth: 'private',
      body: {
        transaction_id: input.transactionId,
        amount_in_cents: Number(toCents(input.amountMinor, input.currencyExponent)),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.reference ? { reference: input.reference } : {}),
      },
    });
    const data = json.data ?? {};
    const status = str(data.status).toUpperCase();
    return {
      id: str(data.v2_refund_id) || str(data.id) || null,
      status:
        (['PENDING', 'APPROVED', 'DECLINED', 'ERROR', 'CANCELLED'] as const).find(
          (s) => s === status,
        ) ?? 'PENDING',
      raw: data,
    };
  }

  async createPaymentLink(input: PaymentLinkInput): Promise<PaymentLink> {
    const json = await this.request<{ data?: Json }>('POST', '/payment_links', {
      auth: 'private',
      body: {
        name: input.name,
        description: input.description,
        single_use: input.singleUse ?? true,
        collect_shipping: false,
        currency: input.currency,
        amount_in_cents: Number(toCents(input.amountMinor, input.currencyExponent)),
        sku: input.reference,
        ...(input.redirectUrl ? { redirect_url: input.redirectUrl } : {}),
        ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
      },
    });
    const data = json.data ?? {};
    const id = str(data.id);
    if (!id)
      throw new PaymentGatewayError(
        'Wompi no devolvió el id del enlace de pago',
        'PROVIDER',
        undefined,
        data,
      );
    return { id, url: `${this.checkoutBaseUrl}/l/${id}`, raw: data };
  }

  parseWebhook(body: unknown): WebhookEvent {
    const event = (body ?? {}) as Json & {
      signature?: { properties?: unknown; checksum?: unknown };
      timestamp?: unknown;
    };
    const checksumValid = verifyWebhookChecksum(event, this.eventsSecret);
    const data = (event.data ?? {}) as Json;
    const rawTransaction = data.transaction as Json | undefined;
    const transaction = rawTransaction ? this.mapTransaction(rawTransaction) : null;
    const timestamp = typeof event.timestamp === 'number' ? event.timestamp : null;
    return {
      event: str(event.event) || 'unknown',
      environment: str(event.environment) || null,
      timestamp,
      sentAt: str(event.sent_at) || null,
      checksumValid,
      dedupeKey: `${transaction?.id ?? 'unknown'}:${transaction?.status ?? ''}:${timestamp ?? ''}`,
      transaction,
      raw: body,
    };
  }

  private mapTransaction(data: Json): GatewayTransaction {
    const currency = str(data.currency) || 'COP';
    const cents = BigInt(Math.round(Number(data.amount_in_cents ?? 0)));
    const status = str(data.status).toUpperCase();
    return {
      id: str(data.id),
      status: TRANSACTION_STATUSES.find((s) => s === status) ?? 'ERROR',
      statusMessage: str(data.status_message) || null,
      reference: str(data.reference),
      amountMinor: fromCents(cents, this.currencyExponents[currency] ?? 2),
      currency,
      paymentSourceId: typeof data.payment_source_id === 'number' ? data.payment_source_id : null,
      paymentLinkId: str(data.payment_link_id) || null,
      paymentMethodType: str(data.payment_method_type) || null,
      customerEmail: str(data.customer_email) || null,
      createdAt: str(data.created_at) || null,
      finalizedAt: str(data.finalized_at) || null,
      raw: data,
    };
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { auth: 'none' | 'public' | 'private'; body?: unknown },
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.auth === 'private') headers.authorization = `Bearer ${this.privateKey}`;
    if (options.auth === 'public') headers.authorization = `Bearer ${this.publicKey}`;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = (error as { name?: string }).name === 'AbortError';
      throw new PaymentGatewayError(
        aborted ? `Wompi no respondió en ${this.timeoutMs} ms` : 'No se pudo conectar con Wompi',
        aborted ? 'TIMEOUT' : 'NETWORK',
        undefined,
        { path, cause: (error as Error).message },
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let json: Json = {};
    if (text) {
      try {
        json = JSON.parse(text) as Json;
      } catch {
        // La API de Wompi siempre responde JSON: un cuerpo distinto viene de un intermediario
        // (proxy, CDN, WAF), así que se trata como fallo de red reintentable.
        throw new PaymentGatewayError(
          'Wompi devolvió una respuesta que no es JSON (¿intermediario de red?)',
          'NETWORK',
          response.status,
          {
            path,
            snippet: text.slice(0, 200),
          },
        );
      }
    }
    if (!response.ok) {
      const error = (json.error ?? {}) as Json;
      const code: PaymentGatewayErrorCode =
        response.status === 401 || response.status === 403
          ? 'AUTH'
          : response.status === 404
            ? 'NOT_FOUND'
            : response.status === 422 || response.status === 400
              ? 'VALIDATION'
              : response.status === 429
                ? 'RATE_LIMIT'
                : 'PROVIDER';
      const reason = str(error.reason) || str(error.type) || `HTTP ${response.status}`;
      throw new PaymentGatewayError(
        `Wompi rechazó la operación: ${reason}`,
        code,
        response.status,
        {
          path,
          type: error.type ?? null,
          messages: error.messages ?? null,
        },
      );
    }
    return json as T;
  }
}

function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

export function mapSource(data: Json): PaymentSource {
  const extra = (data.extra ?? {}) as Json;
  const threeDs = (extra.three_ds_auth ?? {}) as Json;
  const publicData = (data.public_data ?? {}) as Json;
  const status = str(data.status).toUpperCase();
  const idValue = Number(data.id);
  return {
    id: Number.isFinite(idValue) ? idValue : 0,
    type: str(data.type).toUpperCase() === 'NEQUI' ? 'NEQUI' : 'CARD',
    status: SOURCE_STATUSES.find((s) => s === status) ?? 'ERROR',
    customerEmail: str(data.customer_email) || null,
    publicData: {
      type: str(publicData.type) || str(data.type),
      ...(publicData.brand ? { brand: str(publicData.brand) } : {}),
      ...(publicData.last_four ? { last_four: str(publicData.last_four) } : {}),
      ...(publicData.bin ? { bin: str(publicData.bin) } : {}),
      ...(publicData.exp_month ? { exp_month: str(publicData.exp_month) } : {}),
      ...(publicData.exp_year ? { exp_year: str(publicData.exp_year) } : {}),
      ...(publicData.card_holder ? { card_holder: str(publicData.card_holder) } : {}),
      ...(publicData.phone_number ? { phone_number: str(publicData.phone_number) } : {}),
    },
    threeDs:
      extra.is_three_ds === true || Object.keys(threeDs).length > 0
        ? {
            isThreeDs: extra.is_three_ds === true,
            currentStep: str(threeDs.current_step) || null,
            currentStepStatus: str(threeDs.current_step_status) || null,
            methodData: str(threeDs.three_ds_method_data) || null,
          }
        : null,
    raw: data,
  };
}
