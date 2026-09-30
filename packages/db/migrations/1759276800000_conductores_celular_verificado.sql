-- 0013. Celular verificado del conductor (ADR 0031): la app pide el número y lo confirma con un
-- código de un solo uso por SMS; es obligatorio para registrar medios de pago e iniciar cargas
-- (parámetro auth.driver_require_verified_phone). El número se guarda en formato E.164 (+57…).

-- 1. Conductor: cuándo se verificó el celular (NULL = sin verificar o cambiado después).
ALTER TABLE auth.driver ADD COLUMN phone_verified_at timestamptz;

-- Un celular verificado pertenece a una sola cuenta activa del operador.
CREATE UNIQUE INDEX driver_phone_verified_uq ON auth.driver (tenant_id, phone)
  WHERE phone IS NOT NULL AND phone_verified_at IS NOT NULL AND anonymized_at IS NULL;

-- 2. Códigos enviados: solo el hash (con sal) y los intentos; caducan a los pocos minutos.
CREATE TABLE auth.driver_phone_code (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES assets.tenant(id),
  driver_id    uuid NOT NULL REFERENCES auth.driver(id),
  phone        text NOT NULL,
  code_hash    text NOT NULL,
  salt         text NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_phone_code_driver_idx ON auth.driver_phone_code (driver_id, created_at DESC);
CREATE INDEX driver_phone_code_phone_idx ON auth.driver_phone_code (phone, created_at DESC);

-- 3. Parámetro: exigir el celular verificado (se puede apagar por tenant mientras no haya proveedor de SMS).
INSERT INTO config.param_definition (key, value_schema, allowed_scopes, default_value, description) VALUES
  ('auth.driver_require_verified_phone', '{"type":"boolean"}', '{PLATFORM,TENANT}', 'true',
   'Exige un celular verificado por SMS para registrar medios de pago e iniciar cargas desde la app')
ON CONFLICT (key) DO NOTHING;
