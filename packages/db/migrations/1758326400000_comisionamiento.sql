-- ============================================================
-- Iteración 2: inventario y comisionamiento (OPS §1.2, §1.5; SEG §2.3, §2.8)
-- ============================================================

-- 1. Ciclo de vida del cargador alineado con packages/domain (charge-point-lifecycle.ts).
ALTER TABLE assets.charge_point DROP CONSTRAINT charge_point_lifecycle_status_check;
UPDATE assets.charge_point SET lifecycle_status = CASE lifecycle_status
  WHEN 'provisioned'      THEN 'PROVISIONED'
  WHEN 'pending_approval' THEN 'CONNECTED_PENDING'
  WHEN 'accepted'         THEN 'OPERATIONAL'
  WHEN 'rejected'         THEN 'REJECTED'
  WHEN 'revoked'          THEN 'DECOMMISSIONED'
  WHEN 'retired'          THEN 'DECOMMISSIONED'
  ELSE lifecycle_status END;
ALTER TABLE assets.charge_point ALTER COLUMN lifecycle_status SET DEFAULT 'INVENTORIED';
ALTER TABLE assets.charge_point ADD CONSTRAINT charge_point_lifecycle_status_check
  CHECK (lifecycle_status IN ('INVENTORIED','PROVISIONED','CONNECTED_PENDING','CONFIGURED','TESTED',
                              'OPERATIONAL','MAINTENANCE','REJECTED','DECOMMISSIONED'));

ALTER TABLE assets.charge_point
  ADD COLUMN visible_in_app   boolean NOT NULL DEFAULT false,   -- se activa al pasar a OPERATIONAL
  ADD COLUMN boot_vendor      text,                             -- lo que dijo BootNotification (vs inventario)
  ADD COLUMN boot_model       text,
  ADD COLUMN config_synced_at timestamptz,                      -- último GetConfiguration completo persistido
  ADD COLUMN approved_by      text,
  ADD COLUMN approved_at      timestamptz,
  ADD CONSTRAINT charge_point_config_template_fk
    FOREIGN KEY (config_template_id) REFERENCES config.ocpp_config_template(id);

-- 2. Historial de transiciones de ciclo de vida (quién, cuándo, con qué evidencia OCPP).
CREATE TABLE assets.charge_point_lifecycle_event (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  charge_point_id uuid NOT NULL REFERENCES assets.charge_point(id) ON DELETE CASCADE,
  from_state      text,
  to_state        text NOT NULL,
  actor           text NOT NULL,                       -- staff:<id> | system:ocpp-gateway | system:commissioning
  reason          text,
  evidence        jsonb NOT NULL DEFAULT '{}',         -- {"uniqueId":"…","action":"BootNotification","commandId":"…"}
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cp_lifecycle_event_idx ON assets.charge_point_lifecycle_event (charge_point_id, at DESC);

-- 3. Credencial Basic Auth del cargador (perfil 1/2). Solo el hash (scrypt, ADR 0014); la clave en
--    claro se muestra una única vez al emitirla. La clave de bootstrap caduca a las 24 h sin conexión.
CREATE TABLE assets.charge_point_credential (
  charge_point_id     uuid PRIMARY KEY REFERENCES assets.charge_point(id) ON DELETE CASCADE,
  key_hash            text NOT NULL,
  next_key_hash       text,                            -- durante la rotación (SEG §2.3)
  rotation_started_at timestamptz,
  issued_at           timestamptz NOT NULL DEFAULT now(),
  issued_by           text NOT NULL,
  expires_at          timestamptz NOT NULL,
  bootstrap           boolean NOT NULL DEFAULT true,   -- true hasta la primera conexión correcta
  first_used_at       timestamptz,
  last_used_at        timestamptz,
  failed_attempts     integer NOT NULL DEFAULT 0,
  last_failed_at      timestamptz,
  locked_until        timestamptz                      -- 5 fallos en 10 min => 15 min de bloqueo (SEG §2.5)
);

-- 4. Plantillas de configuración: keys opcionales cuya respuesta Rejected/NotSupported no bloquea.
ALTER TABLE config.ocpp_config_template
  ADD COLUMN optional_keys text[] NOT NULL DEFAULT '{}',
  ADD COLUMN description   text;

-- 5. Log OCPP: partición por defecto hasta que el worker gestione particiones diarias.
CREATE TABLE ops.ocpp_message_log_default PARTITION OF ops.ocpp_message_log DEFAULT;

-- 6. Tenant único de la plataforma (ADR 0001, 0004, 0005).
INSERT INTO assets.tenant (id, code, name, country_code, currency, timezone)
VALUES ('a0000000-0000-4000-8000-000000000001', 'VOLT', 'Volt', 'CO', 'COP', 'America/Bogota')
ON CONFLICT (code) DO NOTHING;
