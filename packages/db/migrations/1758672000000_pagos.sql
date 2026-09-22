-- ============================================================
-- Iteración 5: pagos con Wompi (ADR 0002, ADR 0020): fuentes de pago, cobros con reintentos,
-- deudas con enlace de pago, bandeja idempotente de webhooks, bloqueo del conductor y recibos.
-- ============================================================

-- 1. Medios de pago: la fuente de pago de Wompi (token del PSP; nunca el número de tarjeta).
ALTER TABLE billing.payment_method
  ADD COLUMN psp_environment   text NOT NULL DEFAULT 'sandbox',
  ADD COLUMN psp_source_status text NOT NULL DEFAULT 'AVAILABLE'
             CHECK (psp_source_status IN ('AVAILABLE','PENDING','DECLINED','ERROR','VOIDED')),
  ADD COLUMN three_ds          jsonb,                       -- estado del flujo 3DS (paso, estado, html para la app)
  ADD COLUMN customer_email    text,
  ADD COLUMN label             text,                        -- "Visa terminada en 4242"
  ADD COLUMN acceptance        jsonb,                       -- evidencia: tokens de aceptación y momento de aceptación
  ADD COLUMN removed_at        timestamptz,
  ADD COLUMN updated_at        timestamptz NOT NULL DEFAULT now();
CREATE INDEX payment_method_driver_idx ON billing.payment_method (driver_id) WHERE status = 'ACTIVE';

-- 2. Cobros: una fila por intento contra el PSP.
ALTER TABLE billing.payment DROP CONSTRAINT payment_kind_check;
ALTER TABLE billing.payment ADD CONSTRAINT payment_kind_check
  CHECK (kind IN ('PREAUTH','CAPTURE','REFUND','VOID','WALLET_TOPUP','DEBT'));
ALTER TABLE billing.payment
  ADD COLUMN reference        text,                         -- referencia enviada al PSP (única por intento)
  ADD COLUMN attempt          integer NOT NULL DEFAULT 1,
  ADD COLUMN psp_status       text,                         -- PENDING | APPROVED | DECLINED | VOIDED | ERROR
  ADD COLUMN status_message   text,
  ADD COLUMN psp_environment  text,
  ADD COLUMN payment_link_id  text,
  ADD COLUMN debt_id          uuid,
  ADD COLUMN requested_by     text,
  ADD COLUMN finalized_at     timestamptz;
CREATE UNIQUE INDEX payment_reference_uq ON billing.payment (psp, reference) WHERE reference IS NOT NULL;
CREATE UNIQUE INDEX payment_psp_reference_uq ON billing.payment (psp, psp_reference) WHERE psp_reference IS NOT NULL;
CREATE INDEX payment_pending_idx ON billing.payment (created_at) WHERE status = 'PENDING';
CREATE INDEX payment_driver_idx ON billing.payment (driver_id, created_at DESC);

-- 3. Deudas: cobro rechazado pendiente de reintento o de pago por enlace.
CREATE TABLE billing.debt (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES assets.tenant(id),
  driver_id               uuid NOT NULL REFERENCES auth.driver(id),
  session_id              uuid REFERENCES sessions.charging_session(id),
  amount_minor            bigint NOT NULL,
  currency                char(3) NOT NULL,
  status                  text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PAID','WAIVED')),
  attempts                integer NOT NULL DEFAULT 0,       -- cobros automáticos rechazados
  next_attempt_at         timestamptz,
  last_error              text,
  payment_link_id         text,
  payment_link_url        text,
  payment_link_expires_at timestamptz,
  paid_payment_id         uuid REFERENCES billing.payment(id),
  waived_by               text,
  waived_reason           text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  closed_at               timestamptz
);
CREATE UNIQUE INDEX debt_session_uq ON billing.debt (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX debt_driver_open_idx ON billing.debt (driver_id) WHERE status = 'OPEN';
CREATE INDEX debt_retry_idx ON billing.debt (next_attempt_at) WHERE status = 'OPEN' AND next_attempt_at IS NOT NULL;
ALTER TABLE billing.payment ADD CONSTRAINT payment_debt_fk FOREIGN KEY (debt_id) REFERENCES billing.debt(id);

-- 4. Bandeja idempotente de eventos del PSP (DAT §4.5).
CREATE TABLE billing.webhook_inbox (
  id              uuid PRIMARY KEY,
  psp             text NOT NULL,
  dedupe_key      text NOT NULL,                            -- id de transacción + estado + marca de tiempo del evento
  event           text NOT NULL,
  psp_environment text,
  checksum_valid  boolean NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  payload         jsonb NOT NULL,
  transaction_id  text,
  processed_at    timestamptz,
  outcome         text,                                     -- APPLIED | DUPLICATE | UNKNOWN_TRANSACTION | INVALID_CHECKSUM | ERROR
  error           text,
  UNIQUE (psp, dedupe_key)
);

-- 5. Conductor: bloqueo por deuda o manual (ADR 0002, punto 6).
ALTER TABLE auth.driver
  ADD COLUMN billing_status text NOT NULL DEFAULT 'OK' CHECK (billing_status IN ('OK','BLOCKED_DEBT','BLOCKED_MANUAL')),
  ADD COLUMN blocked_reason text,
  ADD COLUMN blocked_at     timestamptz;

-- 6. Sesión: rastro del cobro y del recibo.
ALTER TABLE sessions.charging_session
  ADD COLUMN payment_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN last_payment_id  uuid REFERENCES billing.payment(id),
  ADD COLUMN receipt_id       uuid REFERENCES billing.invoice(id);
CREATE INDEX cs_to_charge_idx ON sessions.charging_session (settled_at)
  WHERE state = 'SETTLED' AND payment_status IN ('NONE','FAILED');

-- 7. Parámetros de cobro.
INSERT INTO config.param_definition (key, value_schema, allowed_scopes, default_value, description) VALUES
  ('billing.retry_schedule_h', '{"type":"array","items":{"type":"number"}}', '{PLATFORM,TENANT}', '[2,24,72]',
   'Horas de espera tras cada cobro rechazado antes de reintentar (una entrada por reintento)'),
  ('billing.block_on_debt', '{"type":"boolean"}', '{PLATFORM,TENANT}', 'true',
   'Bloquea nuevas cargas del conductor mientras tenga deuda abierta'),
  ('billing.min_charge_minor', '{"type":"integer","minimum":0}', '{PLATFORM,TENANT}', '0',
   'Importe mínimo que se cobra; por debajo la sesión se condona (WAIVED)'),
  ('billing.payment_link_validity_h', '{"type":"integer","minimum":1,"maximum":720}', '{PLATFORM,TENANT}', '72',
   'Horas de validez del enlace de pago de una deuda'),
  ('billing.pending_poll_after_s', '{"type":"integer","minimum":30,"maximum":86400}', '{PLATFORM,TENANT}', '120',
   'Segundos tras los que el worker consulta al PSP una transacción PENDING sin webhook'),
  ('billing.charge_delay_s', '{"type":"integer","minimum":0,"maximum":86400}', '{PLATFORM,TENANT}', '0',
   'Espera entre la liquidación y el cobro (por ejemplo para permitir un ajuste manual)'),
  ('pricing.exposure_limit_first_session_minor', '{"type":"integer","minimum":0}', '{PLATFORM,TENANT}', '100000',
   'Tope de exposición para la primera carga de una cuenta nueva (ADR 0002)')
ON CONFLICT (key) DO NOTHING;
