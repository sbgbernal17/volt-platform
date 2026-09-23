-- ============================================================
-- Iteración 6: personal del back-office con RBAC y auditoría inmutable
-- (FUN M13 y M19, SEG §2.8, §3.1 y §3.2, ADR 0021).
-- ============================================================

-- 1. Personal. La identidad la emite Identity Platform (idp_subject = uid); el rol, el alcance y el
--    estado viven aquí y se resuelven en la API en cada petición (nunca desde el cliente).
CREATE TABLE auth.staff_user (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES assets.tenant(id),
  email           text NOT NULL,
  display_name    text,
  role            text NOT NULL CHECK (role IN ('ADMIN','OPERATIONS','SUPPORT','READ_ONLY','SITE_OWNER')),
  site_ids        uuid[] NOT NULL DEFAULT '{}',        -- alcance de SITE_OWNER (ADR 0004); vacío = ninguna sede
  status          text NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED','ACTIVE','DISABLED')),
  idp_subject     text UNIQUE,                         -- se vincula en el primer inicio de sesión con correo verificado
  idp_provider    text,
  mfa_enrolled    boolean NOT NULL DEFAULT false,      -- el último inicio de sesión traía segundo factor
  locale          text NOT NULL DEFAULT 'es' CHECK (locale IN ('es','en')),
  invited_by      text NOT NULL,                       -- staff:<id> | staff:admin-token | system:bootstrap
  invited_at      timestamptz NOT NULL DEFAULT now(),
  activated_at    timestamptz,
  last_login_at   timestamptz,
  disabled_at     timestamptz,
  disabled_reason text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_user_email_uq ON auth.staff_user (tenant_id, lower(email));

-- 2. Auditoría inmutable con cadena de hashes (SEG §2.8): solo INSERT. El hash de cada fila cubre el
--    hash anterior y el contenido canónico de la fila; un trigger rechaza UPDATE, DELETE y TRUNCATE
--    para cualquier rol (el rol de aplicación además no tendrá esos privilegios en producción).
CREATE TABLE audit.audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts            timestamptz NOT NULL,
  tenant_id     uuid,
  actor_type    text NOT NULL CHECK (actor_type IN ('staff','driver','system','charge_point')),
  actor_id      text NOT NULL,
  action        text NOT NULL,                        -- 'command.send', 'tariff.publish', 'staff.update', ...
  entity_type   text NOT NULL,
  entity_id     text NOT NULL,
  before        jsonb,
  after         jsonb,
  request_id    text,
  remote_ip     text,
  user_agent    text,
  outcome       text NOT NULL DEFAULT 'OK',           -- OK | DENIED | ERROR
  prev_hash     bytea NOT NULL,
  hash          bytea NOT NULL
);
CREATE INDEX audit_log_ts_idx     ON audit.audit_log (ts DESC);
CREATE INDEX audit_log_entity_idx ON audit.audit_log (entity_type, entity_id, ts DESC);
CREATE INDEX audit_log_actor_idx  ON audit.audit_log (actor_id, ts DESC);

CREATE FUNCTION audit.reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.audit_log es inmutable: solo se permite INSERT';
END $$;
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON audit.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();

-- 3. Parámetros de identidad del personal (SEG §3.1).
INSERT INTO config.param_definition (key, value_schema, allowed_scopes, default_value, description) VALUES
  ('auth.staff_mfa_roles', '{"type":"array","items":{"type":"string"}}', '{PLATFORM,TENANT}',
   '["ADMIN","OPERATIONS"]',
   'Roles del back-office que solo pueden operar con segundo factor (TOTP) en el inicio de sesión'),
  ('auth.staff_session_max_h', '{"type":"integer","minimum":1,"maximum":24}', '{PLATFORM,TENANT}', '12',
   'Antigüedad máxima del inicio de sesión del personal en horas; después la API exige volver a autenticarse'),
  ('billing.support_refund_limit_minor', '{"type":"integer","minimum":0}', '{PLATFORM,TENANT}', '200000',
   'Importe máximo (unidad mínima, COP) que el rol SUPPORT puede anular o reembolsar sin un administrador')
ON CONFLICT (key) DO NOTHING;
