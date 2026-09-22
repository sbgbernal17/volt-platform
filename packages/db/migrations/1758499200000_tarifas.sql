-- ============================================================
-- Iteración 4: tarifas, snapshot por sesión y cálculo de costos (TAR §1.5, §2.5, §3; ADR 0017)
-- ============================================================

-- 1. Tarifa lógica (identidad estable) y sus versiones inmutables (TAR §1.5).
CREATE TABLE tariffs.tariff (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES assets.tenant(id),
  code        text NOT NULL,                                -- 'VOLT-BASE'
  name        text NOT NULL,
  currency    char(3) NOT NULL,                             -- ISO 4217
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE tariffs.tariff_version (
  id              uuid PRIMARY KEY,
  tariff_id       uuid NOT NULL REFERENCES tariffs.tariff(id),
  version         integer NOT NULL,
  status          text NOT NULL CHECK (status IN ('DRAFT','SCHEDULED','ACTIVE','RETIRED')),
  valid_from      timestamptz,                              -- obligatorio al programar/publicar
  valid_to        timestamptz,
  tax_included    boolean NOT NULL DEFAULT true,            -- ADR 0017: precios al consumidor con IVA incluido
  definition      jsonb NOT NULL,                           -- objeto OCPI Tariff + x_volt (precios como texto decimal)
  definition_hash char(64) NOT NULL,                        -- sha256 del JSON canónico de definition
  notes           text,
  created_by      text NOT NULL,
  approved_by     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  retired_at      timestamptz,
  CHECK (status = 'DRAFT' OR valid_from IS NOT NULL),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
  UNIQUE (tariff_id, version)
);
-- Solo una versión SCHEDULED/ACTIVE puede estar vigente en un instante por tarifa.
ALTER TABLE tariffs.tariff_version ADD CONSTRAINT tariff_version_no_overlap
  EXCLUDE USING gist (tariff_id WITH =, tstzrange(valid_from, valid_to, '[)') WITH &&)
  WHERE (status IN ('SCHEDULED','ACTIVE'));
CREATE INDEX tariff_version_active_idx ON tariffs.tariff_version (tariff_id, status, valid_from);

-- 2. Asignaciones: qué tarifa aplica a (alcance, segmento) y con qué ajustes (TAR §1.3).
CREATE TABLE tariffs.tariff_assignment (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES assets.tenant(id),
  scope_type  text NOT NULL CHECK (scope_type IN ('PLATFORM','TENANT','SITE','CHARGE_POINT','CONNECTOR','CONNECTOR_TYPE')),
  scope_id    text NOT NULL,                                -- '*' para PLATFORM, uuid o estándar de conector
  segment     text NOT NULL,                                -- PUBLIC | ADHOC | MEMBER:<tier> | FLEET:<id> | EMPLOYEE | ROAMING:<emsp> | INTERNAL
  tariff_id   uuid NOT NULL REFERENCES tariffs.tariff(id),
  adjustments jsonb NOT NULL DEFAULT '[]',
  priority    integer NOT NULL DEFAULT 0,
  valid_from  timestamptz NOT NULL DEFAULT now(),
  valid_to    timestamptz,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX tariff_assignment_lookup_idx ON tariffs.tariff_assignment (tenant_id, scope_type, scope_id, segment);

-- 3. Cotización previa (lo que vio el conductor antes de iniciar) y snapshot inmutable de la sesión.
CREATE TABLE tariffs.price_quote (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  evse_id       uuid NOT NULL REFERENCES assets.evse(id),
  segment       text NOT NULL,
  driver_id     uuid,
  computed_at   timestamptz NOT NULL,
  valid_until   timestamptz NOT NULL,
  snapshot      jsonb NOT NULL,
  snapshot_hash char(64) NOT NULL
);
CREATE INDEX price_quote_evse_idx ON tariffs.price_quote (evse_id, computed_at DESC);

CREATE TABLE tariffs.session_tariff_snapshot (              -- INMUTABLE: nunca UPDATE
  session_id        uuid PRIMARY KEY REFERENCES sessions.charging_session(id),
  quote_id          uuid REFERENCES tariffs.price_quote(id),
  tariff_version_id uuid REFERENCES tariffs.tariff_version(id),   -- NULL para el segmento INTERNAL (costo 0)
  segment           text NOT NULL,
  snapshot          jsonb NOT NULL,                         -- {tariff, policy, adjustments, tax_included, exposure_limit_minor, warn_pct, ...}
  snapshot_hash     char(64) NOT NULL,
  applied_rules     jsonb NOT NULL DEFAULT '[]',
  retro             boolean NOT NULL DEFAULT false,         -- RETRO_SNAPSHOT (sesión no solicitada)
  frozen_at         timestamptz NOT NULL DEFAULT now()
);

-- 4. Cálculos del motor: una fila por ejecución, idempotente por (session_id, input_hash, engine_version).
CREATE TABLE tariffs.session_cost_calc (
  id             uuid PRIMARY KEY,
  session_id     uuid NOT NULL REFERENCES sessions.charging_session(id),
  calc_version   integer NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('RUNNING','FINAL','RECALC')),
  engine_version text NOT NULL,
  input_hash     char(64) NOT NULL,
  output_hash    char(64) NOT NULL,
  currency       char(3) NOT NULL,
  subtotal_minor bigint NOT NULL,
  discount_minor bigint NOT NULL,
  tax_minor      bigint NOT NULL,
  total_minor    bigint NOT NULL,
  capped         boolean NOT NULL DEFAULT false,
  flags          text[] NOT NULL DEFAULT '{}',
  alerts         text[] NOT NULL DEFAULT '{}',
  summary        jsonb NOT NULL,                            -- energía, tiempos, inicio/fin
  reason         text,                                      -- motivo de un RECALC
  computed_by    text NOT NULL,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, calc_version),
  UNIQUE (session_id, input_hash, engine_version)
);

CREATE TABLE tariffs.session_cost_line (
  id            uuid PRIMARY KEY,
  calc_id       uuid NOT NULL REFERENCES tariffs.session_cost_calc(id) ON DELETE CASCADE,
  seq           integer NOT NULL,
  dimension     text NOT NULL CHECK (dimension IN ('FLAT','ENERGY','TIME','PARKING_TIME','RESERVATION','ADJUSTMENT','CAP')),
  element_ref   text,
  period_start  timestamptz,
  period_end    timestamptz,
  quantity      numeric(18,6) NOT NULL,
  quantity_raw  bigint,
  unit          text NOT NULL,
  unit_price    numeric(18,6) NOT NULL,
  amount_minor  bigint NOT NULL,
  tax_rate      numeric(6,3) NOT NULL DEFAULT 0,
  tax_minor     bigint NOT NULL DEFAULT 0,
  UNIQUE (calc_id, seq)
);

-- 5. Auditoría de tarifas (append-only).
CREATE TABLE tariffs.tariff_audit (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  entity     text NOT NULL,                                 -- tariff | tariff_version | tariff_assignment | parameter
  entity_id  text NOT NULL,
  action     text NOT NULL,                                 -- CREATE | PUBLISH | RETIRE | END | SET
  actor      text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  before     jsonb,
  after      jsonb
);
CREATE INDEX tariff_audit_entity_idx ON tariffs.tariff_audit (entity, entity_id, at DESC);

-- 6. Sesión: fin de ocupación, límite de exposición y costo en curso.
ALTER TABLE sessions.charging_session
  ADD COLUMN tariff_segment        text,                    -- segmento con el que se congeló el snapshot
  ADD COLUMN idle_ended_at         timestamptz,             -- conector libre tras la transacción (fin de la ocupación)
  ADD COLUMN exposure_limit_minor  bigint,                  -- tope de exposición aplicado (parámetro o preautorización)
  ADD COLUMN exposure_warned_at    timestamptz,
  ADD COLUMN exposure_exhausted_at timestamptz,
  ADD COLUMN running_cost          jsonb,                   -- último cálculo RUNNING: {total_minor, subtotal_minor, tax_minor, currency, alerts, computed_at}
  ADD COLUMN pricing_error         text;                    -- último error de liquidación (NO_TARIFF, ...)
ALTER TABLE sessions.charging_session
  ADD CONSTRAINT charging_session_snapshot_fk
  FOREIGN KEY (tariff_snapshot_id) REFERENCES tariffs.session_tariff_snapshot(session_id);
ALTER TABLE sessions.charging_session
  ADD CONSTRAINT charging_session_final_calc_fk
  FOREIGN KEY (final_calc_id) REFERENCES tariffs.session_cost_calc(id);
CREATE INDEX cs_settlement_idx ON sessions.charging_session (state, ended_at) WHERE state = 'ENDED';
CREATE INDEX cs_exposure_idx ON sessions.charging_session (exposure_exhausted_at)
  WHERE exposure_exhausted_at IS NOT NULL AND state IN ('CHARGING','SUSPENDED_EV','SUSPENDED_EVSE');

-- 7. Parámetros de precios y sesión (FUN M20; los valores por defecto son los acordados con el dueño).
INSERT INTO config.param_definition (key, value_schema, allowed_scopes, default_value, description) VALUES
  ('pricing.exposure_limit_minor', '{"type":"integer","minimum":0}',
   '{PLATFORM,TENANT,SITE,CHARGE_POINT,CONNECTOR}', '200000',
   'Tope de exposición por sesión en unidad mínima (COP): al proyectarse el motor pide RemoteStopTransaction'),
  ('pricing.warn_pct', '{"type":"integer","minimum":1,"maximum":100}',
   '{PLATFORM,TENANT}', '80',
   'Porcentaje del tope de exposición a partir del cual se avisa al conductor'),
  ('pricing.tax_included', '{"type":"boolean"}',
   '{PLATFORM,TENANT}', 'true',
   'Los precios de las tarifas incluyen el IVA (precio al consumidor); el motor lo desglosa'),
  ('pricing.tax_rounding', '{"type":"string","enum":["PER_LINE","PER_TAX_GROUP"]}',
   '{PLATFORM,TENANT}', '"PER_LINE"',
   'Redondeo del impuesto: por línea (DIAN) o por grupo de tasa'),
  ('pricing.rounding', '{"type":"string","enum":["HALF_UP","HALF_EVEN","DOWN","UP"]}',
   '{PLATFORM,TENANT}', '"HALF_UP"',
   'Modo de redondeo de importes'),
  ('pricing.quote_validity_min', '{"type":"integer","minimum":1,"maximum":120}',
   '{PLATFORM,TENANT}', '10',
   'Minutos de validez de una cotización mostrada en la app'),
  ('pricing.require_four_eyes', '{"type":"boolean"}',
   '{PLATFORM,TENANT}', 'false',
   'Exige que quien publica una versión de tarifa sea distinto de quien la creó'),
  ('session.max_duration_min', '{"type":"integer","minimum":1,"maximum":1440}',
   '{PLATFORM,TENANT,SITE,CHARGE_POINT,CONNECTOR}', '240',
   'Duración máxima de una sesión antes de detenerla remotamente'),
  ('session.idle_settle_timeout_s', '{"type":"integer","minimum":60,"maximum":172800}',
   '{PLATFORM,TENANT,SITE}', '14400',
   'Tiempo máximo que la liquidación espera el fin de la ocupación tras la transacción'),
  ('session.settle_delay_s', '{"type":"integer","minimum":0,"maximum":3600}',
   '{PLATFORM,TENANT}', '5',
   'Espera mínima tras el fin de la ocupación antes de liquidar (mensajes rezagados del cargador)')
ON CONFLICT (key) DO NOTHING;
