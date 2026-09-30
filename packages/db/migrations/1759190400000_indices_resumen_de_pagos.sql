-- Resumen de ingresos y estado del proveedor (ADR 0029): consultas por fecha de cobro y de webhook.
CREATE INDEX IF NOT EXISTS payment_tenant_finalized_idx ON billing.payment (tenant_id, finalized_at DESC);
CREATE INDEX IF NOT EXISTS payment_tenant_created_idx ON billing.payment (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_inbox_received_idx ON billing.webhook_inbox (received_at DESC);
