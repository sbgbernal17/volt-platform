-- ============================================================
-- Iteración 3: sesiones y transacciones (DAT §3.2, §4.4, §5; OPS §1.2)
-- ============================================================

-- 1. Tokens de prueba para el comisionamiento (OPS §1.2) y marcas de sesión.
ALTER TABLE auth.id_token DROP CONSTRAINT id_token_token_type_check;
ALTER TABLE auth.id_token ADD CONSTRAINT id_token_token_type_check
  CHECK (token_type IN ('RFID','APP','QR','AUTOCHARGE','EMAID','FLEET','OPERATOR','TEST'));

ALTER TABLE sessions.charging_session
  ADD COLUMN is_test                boolean NOT NULL DEFAULT false,   -- token TEST: sin cobro
  ADD COLUMN stop_requested_by      text,                             -- staff:<id> | driver:<id> | system:<job>
  ADD COLUMN remote_stop_command_id uuid,
  ADD COLUMN anomaly_flags          text[] NOT NULL DEFAULT '{}';     -- LATE_START, DUPLICATE_STOP, ...

-- 2. Número de sesión para recibos: 'VO-<año>-<secuencia de 6 dígitos>'.
CREATE SEQUENCE sessions.session_no_seq AS bigint START 1;

-- 3. Partición por defecto de las mediciones hasta que el worker cree las mensuales.
CREATE TABLE sessions.meter_value_default PARTITION OF sessions.meter_value DEFAULT;

-- 4. Índices de apoyo para el worker (timeouts, huérfanas) y el SSE (lectura del outbox por agregado).
CREATE INDEX cs_charge_point_state_idx ON sessions.charging_session (charge_point_id, state);
CREATE INDEX cs_evse_recent_idx ON sessions.charging_session (evse_id, requested_at DESC);
CREATE INDEX outbox_aggregate_idx ON ops.event_outbox (aggregate_type, aggregate_id, id);
CREATE INDEX tx_open_idx ON sessions.ocpp_transaction (charge_point_id, state) WHERE state = 'ACTIVE';
