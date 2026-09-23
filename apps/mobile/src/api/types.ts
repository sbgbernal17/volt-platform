/** Tipos de la API pública `/v1` (apps/api/src/public). */
export interface AppConfig {
  version: string;
  auth: {
    provider: 'identity-platform' | 'dev' | 'none';
    projectId: string | null;
    apiKey: string | null;
    authDomain: string | null;
    tenantId: string | null;
    devLogin: boolean;
  };
  payments: {
    provider: 'wompi' | 'fake' | 'none';
    environment: 'sandbox' | 'production' | 'fake' | 'none';
    publicKey: string | null;
    apiBaseUrl: string | null;
  };
  legal: { termsUrl: string; privacyUrl: string; supportEmail: string | null };
  consentVersion: string;
}

export type ConsentKey = 'terms' | 'data_processing' | 'marketing';

export interface Profile {
  id: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  phone: string | null;
  locale: 'es' | 'en';
  status: 'ACTIVE' | 'BLOCKED' | 'DELETED';
  billingStatus: 'OK' | 'BLOCKED_DEBT' | 'BLOCKED_MANUAL';
  blockedReason: string | null;
  segment: string;
  consents: Partial<
    Record<ConsentKey, { version: string; acceptedAt: string; locale: string } | null>
  >;
  pendingConsents: ConsentKey[];
  consentVersion: string;
  defaultPaymentMethodId: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface LocationEvse {
  evseId: string;
  chargeBoxId: string;
  connectorId: number | null;
  standard: string;
  powerType: string;
  maxPowerKw: number | null;
  status: string;
}

export interface Location {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  accessType: string;
  openingHours: unknown;
  evses: LocationEvse[];
}

export interface TariffPreview {
  quoteId: string;
  validUntil: string;
  currency: string;
  taxIncluded: boolean;
  segment: string;
  tariffCode: string | null;
  tariffVersion: number | null;
  energy: {
    pricePerKwhNow: string | null;
    elements: {
      startTime: string | null;
      endTime: string | null;
      days: string[] | null;
      pricePerKwh: string;
      label: string;
    }[];
  };
  sessionFee: string | null;
  timeFee: { pricePerMinute: string } | null;
  idleFee: {
    pricePerMinute: string;
    gracePeriodMin: number;
    maxIdleMin: number | null;
    startsAt: string;
  } | null;
  maxPrice: string | null;
  minPrice: string | null;
  exposureLimit: string | null;
  adjustments: unknown[];
  text: string | null;
}

export interface EvseDetail extends LocationEvse {
  visibleInApp: boolean;
  tariff: TariffPreview | null;
  tariffError: string | null;
}

export type AppSessionState =
  | 'REQUESTED'
  | 'STARTING'
  | 'ACTIVE'
  | 'STOPPING'
  | 'ENDED'
  | 'SETTLED'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface SessionCost {
  currency: string;
  taxIncluded: boolean;
  total: string;
  subtotal: string;
  tax: string;
  discount: string;
  isFinal: boolean;
  alerts: string[];
  computedAt: string | null;
  tariffCode: string | null;
  tariffVersion: number | null;
}

export interface Session {
  id: string;
  sessionNo: string;
  state: AppSessionState;
  detailedState: string;
  evseId: string;
  chargeBoxId: string;
  connectorId: number | null;
  ocppTransactionId: number | null;
  isTest: boolean;
  requestedAt: string;
  startDeadlineAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  elapsedSeconds: number;
  energyKwh: number | null;
  powerKw: number | null;
  voltageV: number | null;
  currentA: number | null;
  soc: number | null;
  lastSampleAt: string | null;
  idleSince: string | null;
  stopReason: string | null;
  endKind: string | null;
  failureCode: string | null;
  idleEndedAt: string | null;
  exposureLimit: string | null;
  cost: SessionCost | null;
  paymentStatus: string;
  paidAt: string | null;
  receipt: string | null;
  links: { events: string; stop?: string; cost: string };
}

export interface SessionStartError {
  error: { code: string; message: string };
  session: Session;
}

export interface PaymentMethod {
  id: string;
  kind: 'CARD' | 'WALLET';
  brand: string | null;
  last4: string | null;
  expiresMonth: number | null;
  expiresYear: number | null;
  label: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'REMOVED';
  sourceStatus: 'AVAILABLE' | 'PENDING' | 'DECLINED' | 'ERROR' | 'VOIDED' | string;
  threeDs: {
    isThreeDs?: boolean;
    currentStep?: string | null;
    currentStepStatus?: string | null;
    methodData?: string | null;
  } | null;
  isDefault: boolean;
  createdAt: string;
}

export interface Acceptance {
  acceptanceToken: string;
  acceptancePermalink: string;
  personalDataAuthToken: string;
  personalDataPermalink: string;
  provider: string;
  environment: string;
}

export interface Debt {
  id: string;
  sessionId: string | null;
  sessionNo: string | null;
  amount: string;
  currency: string;
  status: 'OPEN' | 'PAID' | 'WAIVED';
  attempts: number;
  nextAttemptAt: string | null;
  paymentLink: { url: string; expiresAt: string } | null;
  createdAt: string;
}

export interface Billing {
  status: 'OK' | 'BLOCKED_DEBT' | 'BLOCKED_MANUAL';
  blockedReason: string | null;
  canCharge: boolean;
  reason: { code: string; message: string } | null;
  defaultPaymentMethodId: string | null;
  paymentsConfigured: boolean;
  debts: Debt[];
}

export interface ReceiptLine {
  seq: number;
  dimension: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  tax: string;
  total: string;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface Receipt {
  number: string;
  issuedAt: string;
  sessionId: string;
  sessionNo: string;
  evseId: string;
  chargeBoxId: string;
  startedAt: string | null;
  endedAt: string | null;
  energyKwh: number | null;
  lines: ReceiptLine[];
  totals: { currency: string; subtotal: string; tax: string; total: string; taxIncluded: boolean };
  taxBreakdown: unknown[];
  payment: { provider: string; reference: string | null; paidAt: string | null } | null;
  paymentStatus: string;
  tariff: { code: string | null; version: number | null };
  html: string;
}

export interface AppNotification {
  id: string;
  kind: string;
  sessionId: string | null;
  locale: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  status: string;
  readAt: string | null;
  createdAt: string;
}

export interface DeviceRegistration {
  id: string;
  platform: string;
  locale: string;
  status: string;
  registeredAt: string;
}
