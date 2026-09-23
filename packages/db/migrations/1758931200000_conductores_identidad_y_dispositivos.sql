-- 0009. Iteración 7 (ADR 0022): identidad del conductor con Identity Platform, dispositivos para
-- notificaciones push (Expo) y registro de las notificaciones enviadas al conductor.

-- 1. Conductor: rastro de la identidad (proveedor, correo verificado) y del último acceso.
ALTER TABLE auth.driver
  ADD COLUMN email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN idp_provider   text,
  ADD COLUMN last_login_at  timestamptz;

-- 2. Dispositivos del conductor: un token de Expo Push por dispositivo, reasignable si otra cuenta
--    entra en el mismo teléfono (el token es único).
CREATE TABLE auth.driver_device (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES assets.tenant(id),
  driver_id      uuid NOT NULL REFERENCES auth.driver(id),
  push_token     text NOT NULL,
  platform       text NOT NULL CHECK (platform IN ('ios','android','web')),
  locale         text NOT NULL DEFAULT 'es' CHECK (locale IN ('es','en')),
  app_version    text,
  device_name    text,
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INVALID','REMOVED')),
  invalid_reason text,
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (push_token)
);
CREATE INDEX driver_device_driver_idx ON auth.driver_device (driver_id) WHERE status = 'ACTIVE';

-- 3. Notificaciones al conductor: lo que se envió (o no se pudo enviar) por cada evento de dominio;
--    también es la bandeja de avisos de la app. Idempotente por (conductor, evento, clase).
CREATE TABLE auth.driver_notification (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES assets.tenant(id),
  driver_id   uuid NOT NULL REFERENCES auth.driver(id),
  event_id    text NOT NULL,
  kind        text NOT NULL,
  session_id  uuid REFERENCES sessions.charging_session(id),
  locale      text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  devices     integer NOT NULL DEFAULT 0,               -- dispositivos activos a los que se envió
  status      text NOT NULL CHECK (status IN ('PENDING','SENT','NO_DEVICE','FAILED')),
  error       text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, event_id, kind)
);
CREATE INDEX driver_notification_driver_idx ON auth.driver_notification (driver_id, created_at DESC);
CREATE INDEX driver_notification_session_idx ON auth.driver_notification (session_id, kind) WHERE session_id IS NOT NULL;

-- 4. Parámetros de la app y de las notificaciones.
INSERT INTO config.param_definition (key, value_schema, allowed_scopes, default_value, description) VALUES
  ('auth.driver_require_verified_email', '{"type":"boolean"}', '{PLATFORM,TENANT}', 'true',
   'Exige el correo verificado en Identity Platform para registrar medios de pago e iniciar cargas desde la app'),
  ('auth.driver_consent_version', '{"type":"string","minLength":1}', '{PLATFORM,TENANT}', '"2026-09"',
   'Versión vigente de los términos y de la autorización de datos (Ley 1581); al cambiarla la app vuelve a pedir la aceptación'),
  ('notifications.push_kinds', '{"type":"array","items":{"type":"string"}}', '{PLATFORM,TENANT}',
   '["SESSION_STARTED","IDLE_STARTED","EXPOSURE_WARNING","EXPOSURE_EXHAUSTED","SESSION_EXPIRED","SESSION_SETTLED","PAYMENT_CAPTURED","PAYMENT_FAILED"]',
   'Clases de notificación push que se envían al conductor (lista vacía = ninguna)')
ON CONFLICT (key) DO NOTHING;
