/**
 * Puerto `PaymentGateway` (ARQ §2.1, ADR 0002): lo que el dominio necesita de una pasarela de pago
 * sin conocer su API. Los importes viajan en la unidad mínima operativa de la moneda (COP en pesos
 * enteros, `currencyExponent` 0); cada adaptador convierte a la unidad de la pasarela.
 */
export type PaymentSourceType = 'CARD' | 'NEQUI';
export type PaymentSourceStatus = 'AVAILABLE' | 'PENDING' | 'DECLINED' | 'ERROR' | 'VOIDED';

export interface PaymentSourcePublicData {
  type: string;
  brand?: string | undefined;
  last_four?: string | undefined;
  bin?: string | undefined;
  exp_month?: string | undefined;
  exp_year?: string | undefined;
  card_holder?: string | undefined;
  phone_number?: string | undefined;
}

export interface ThreeDsInfo {
  isThreeDs: boolean;
  currentStep: string | null;
  currentStepStatus: string | null;
  /** HTML que la app debe renderizar (viene escapado en la respuesta de Wompi). */
  methodData: string | null;
}

export interface PaymentSource {
  id: number;
  type: PaymentSourceType;
  status: PaymentSourceStatus;
  customerEmail: string | null;
  publicData: PaymentSourcePublicData;
  threeDs: ThreeDsInfo | null;
  raw: unknown;
}

export type TransactionStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';

export interface GatewayTransaction {
  id: string;
  status: TransactionStatus;
  statusMessage: string | null;
  reference: string;
  amountMinor: bigint;
  currency: string;
  paymentSourceId: number | null;
  paymentLinkId: string | null;
  paymentMethodType: string | null;
  customerEmail: string | null;
  createdAt: string | null;
  finalizedAt: string | null;
  raw: unknown;
}

export interface AcceptanceTokens {
  acceptanceToken: string;
  acceptancePermalink: string | null;
  personalDataAuthToken: string;
  personalDataPermalink: string | null;
}

export interface CreatePaymentSourceInput {
  type: PaymentSourceType;
  /** Token de tarjeta o de Nequi generado en la app con la llave pública (los datos de tarjeta no pasan por Volt). */
  token: string;
  customerEmail: string;
  acceptanceToken: string;
  personalDataAuthToken: string;
}

export interface ChargeInput {
  /** Referencia única por intento (número de sesión + intento). */
  reference: string;
  amountMinor: bigint;
  currency: string;
  currencyExponent: number;
  customerEmail: string;
  paymentSourceId: number;
  /** Solo para tarjetas. */
  installments?: number | undefined;
  /** Credential on File: `false` para cobros de monto variable sin periodicidad (consumo por carga). */
  recurrent?: boolean | undefined;
}

export interface RefundInput {
  transactionId: string;
  amountMinor: bigint;
  currency: string;
  currencyExponent: number;
  reason?: string | undefined;
  reference?: string | undefined;
}

export interface RefundResult {
  id: string | null;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'ERROR' | 'CANCELLED';
  raw: unknown;
}

export interface PaymentLinkInput {
  name: string;
  description: string;
  amountMinor: bigint;
  currency: string;
  currencyExponent: number;
  /** Se envía como `sku` para reconocer el pago; la transacción trae `payment_link_id`. */
  reference: string;
  singleUse?: boolean | undefined;
  redirectUrl?: string | undefined;
  expiresAt?: string | undefined;
}

export interface PaymentLink {
  id: string;
  url: string;
  raw: unknown;
}

export interface WebhookEvent {
  event: string;
  environment: string | null;
  timestamp: number | null;
  sentAt: string | null;
  checksumValid: boolean;
  /** Clave de idempotencia derivada del evento (id, estado y marca de tiempo). */
  dedupeKey: string;
  transaction: GatewayTransaction | null;
  raw: unknown;
}

export interface PaymentGateway {
  readonly provider: string;
  readonly environment: 'sandbox' | 'production' | 'fake';
  getAcceptanceTokens(): Promise<AcceptanceTokens>;
  createPaymentSource(input: CreatePaymentSourceInput): Promise<PaymentSource>;
  getPaymentSource(id: number): Promise<PaymentSource>;
  charge(input: ChargeInput): Promise<GatewayTransaction>;
  getTransaction(id: string): Promise<GatewayTransaction>;
  voidTransaction(id: string): Promise<GatewayTransaction>;
  refund(input: RefundInput): Promise<RefundResult>;
  createPaymentLink(input: PaymentLinkInput): Promise<PaymentLink>;
  /** Verifica el checksum con el secreto de eventos y normaliza el evento. Nunca lanza por un checksum inválido. */
  parseWebhook(body: unknown): WebhookEvent;
}

export type PaymentGatewayErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'AUTH'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'RATE_LIMIT'
  | 'PROVIDER';

export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    readonly code: PaymentGatewayErrorCode,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
  }

  /** Un error de red, de tiempo o del proveedor puede reintentarse; uno de validación o de autenticación no. */
  get retryable(): boolean {
    return (
      this.code === 'NETWORK' ||
      this.code === 'TIMEOUT' ||
      this.code === 'RATE_LIMIT' ||
      this.code === 'PROVIDER'
    );
  }
}
