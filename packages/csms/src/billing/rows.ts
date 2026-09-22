/** Filas del esquema `billing` (DAT §3.4, migración 0006). */
export type PaymentMethodKind = 'CARD' | 'WALLET' | 'FLEET_ACCOUNT' | 'INVOICE';
export type PaymentSourceStatus = 'AVAILABLE' | 'PENDING' | 'DECLINED' | 'ERROR' | 'VOIDED';

export interface PaymentMethodRow {
  id: string;
  tenant_id: string;
  driver_id: string;
  psp: string;
  psp_customer_id: string | null;
  /** Identificador de la fuente de pago en el PSP (nunca el número de tarjeta). */
  psp_method_id: string;
  kind: PaymentMethodKind;
  brand: string | null;
  last4: string | null;
  expires_month: number | null;
  expires_year: number | null;
  status: 'ACTIVE' | 'EXPIRED' | 'REMOVED';
  created_at: Date;
  psp_environment: string;
  psp_source_status: PaymentSourceStatus;
  three_ds: Record<string, unknown> | null;
  customer_email: string | null;
  label: string | null;
  acceptance: Record<string, unknown> | null;
  removed_at: Date | null;
  updated_at: Date;
}

export type PaymentKind = 'PREAUTH' | 'CAPTURE' | 'REFUND' | 'VOID' | 'WALLET_TOPUP' | 'DEBT';
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface PaymentRow {
  id: string;
  tenant_id: string;
  session_id: string | null;
  driver_id: string | null;
  payment_method_id: string | null;
  kind: PaymentKind;
  amount_minor: bigint;
  currency: string;
  status: PaymentStatus;
  psp: string;
  psp_reference: string | null;
  idempotency_key: string;
  parent_payment_id: string | null;
  raw: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  reference: string | null;
  attempt: number;
  psp_status: string | null;
  status_message: string | null;
  psp_environment: string | null;
  payment_link_id: string | null;
  debt_id: string | null;
  requested_by: string | null;
  finalized_at: Date | null;
}

export interface DebtRow {
  id: string;
  tenant_id: string;
  driver_id: string;
  session_id: string | null;
  amount_minor: bigint;
  currency: string;
  status: 'OPEN' | 'PAID' | 'WAIVED';
  attempts: number;
  next_attempt_at: Date | null;
  last_error: string | null;
  payment_link_id: string | null;
  payment_link_url: string | null;
  payment_link_expires_at: Date | null;
  paid_payment_id: string | null;
  waived_by: string | null;
  waived_reason: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

export interface WebhookInboxRow {
  id: string;
  psp: string;
  dedupe_key: string;
  event: string;
  psp_environment: string | null;
  checksum_valid: boolean;
  received_at: Date;
  payload: unknown;
  transaction_id: string | null;
  processed_at: Date | null;
  outcome: string | null;
  error: string | null;
}

export interface InvoiceRow {
  id: string;
  tenant_id: string;
  driver_id: string | null;
  series: string;
  number: string;
  kind: 'RECEIPT' | 'INVOICE' | 'CREDIT_NOTE';
  currency: string;
  subtotal_minor: bigint;
  tax_minor: bigint;
  total_minor: bigint;
  tax_breakdown: unknown[];
  buyer_snapshot: Record<string, unknown> | null;
  session_ids: string[];
  issued_at: Date;
  pdf_uri: string | null;
  einvoice_status: string | null;
  einvoice_ref: string | null;
}

export type DriverBillingStatus = 'OK' | 'BLOCKED_DEBT' | 'BLOCKED_MANUAL';
