-- ============================================================
-- 0. Extensiones, esquemas y tipos
-- ============================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;     -- exclusiones con rangos (tariff_version, TAR)

CREATE SCHEMA IF NOT EXISTS assets;   CREATE SCHEMA IF NOT EXISTS auth;     CREATE SCHEMA IF NOT EXISTS sessions;
CREATE SCHEMA IF NOT EXISTS tariffs;  CREATE SCHEMA IF NOT EXISTS billing;  CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS config;   CREATE SCHEMA IF NOT EXISTS audit;    CREATE SCHEMA IF NOT EXISTS archive;

CREATE TYPE assets.ocpp_status AS ENUM ('Available','Preparing','Charging','SuspendedEVSE','SuspendedEV',
  'Finishing','Reserved','Unavailable','Faulted');                  -- ChargePointStatus 1.6 (9 valores, verificado)
CREATE TYPE assets.error_code AS ENUM ('ConnectorLockFailure','EVCommunicationError','GroundFailure','HighTemperature',
  'InternalError','LocalListConflict','NoError','OtherError','OverCurrentFailure','OverVoltage','PowerMeterFailure',
  'PowerSwitchFailure','ReaderFailure','ResetFailure','UnderVoltage','WeakSignal');   -- ChargePointErrorCode (16, verificado)
CREATE TYPE assets.connector_standard AS ENUM ('IEC_62196_T1','IEC_62196_T1_COMBO','IEC_62196_T2','IEC_62196_T2_COMBO',
  'CHADEMO','GBT_AC','GBT_DC','NACS','DOMESTIC_A','DOMESTIC_F','DOMESTIC_G','OTHER');  -- subconjunto de OCPI ConnectorType
CREATE TYPE assets.power_type AS ENUM ('AC_1_PHASE','AC_2_PHASE','AC_3_PHASE','DC');
CREATE TYPE sessions.session_state AS ENUM ('REQUESTED','AUTHORIZED','STARTING','CHARGING','SUSPENDED_EV','SUSPENDED_EVSE',
  'STOPPING','ENDED','SETTLED','PAID','FAILED','CANCELLED','EXPIRED');
CREATE TYPE sessions.tx_state AS ENUM ('ACTIVE','STOPPED','CLOSED_ESTIMATED','ORPHAN','RECONCILED');
CREATE TYPE sessions.stop_reason AS ENUM ('EmergencyStop','EVDisconnected','HardReset','Local','Other','PowerLoss','Reboot',
  'Remote','SoftReset','UnlockCommand','DeAuthorized');            -- Reason 1.6 (11 valores, verificado)
CREATE TYPE sessions.measurand AS ENUM ('Current.Export','Current.Import','Current.Offered',
  'Energy.Active.Export.Register','Energy.Active.Import.Register','Energy.Reactive.Export.Register',
  'Energy.Reactive.Import.Register','Energy.Active.Export.Interval','Energy.Active.Import.Interval',
  'Energy.Reactive.Export.Interval','Energy.Reactive.Import.Interval','Frequency','Power.Active.Export',
  'Power.Active.Import','Power.Factor','Power.Offered','Power.Reactive.Export','Power.Reactive.Import',
  'RPM','SoC','Temperature','Voltage');                            -- 22 measurands 1.6 (verificado)
CREATE TYPE sessions.reading_context AS ENUM ('Interruption.Begin','Interruption.End','Other','Sample.Clock',
  'Sample.Periodic','Transaction.Begin','Transaction.End','Trigger');
CREATE TYPE sessions.phase AS ENUM ('NONE','L1','L2','L3','N','L1-N','L2-N','L3-N','L1-L2','L2-L3','L3-L1'); -- NONE = sin fase (propio)
CREATE TYPE sessions.mv_location AS ENUM ('Body','Cable','EV','Inlet','Outlet');
CREATE TYPE sessions.unit AS ENUM ('Wh','kWh','varh','kvarh','W','kW','VA','kVA','var','kvar','A','V','Celsius','Fahrenheit','K','Percent');
CREATE TYPE ops.command_state AS ENUM ('PENDING','SENT','ACCEPTED','REJECTED','ERROR','TIMEOUT','CANCELLED');
CREATE TYPE ops.alarm_status AS ENUM ('OPEN','ACKED','RESOLVED');

-- ============================================================
-- 1. assets
-- ============================================================
CREATE TABLE assets.tenant (
  id            uuid PRIMARY KEY,
  code          text NOT NULL UNIQUE,                    -- 'VOLT'
  name          text NOT NULL,
  country_code  char(2),                                 -- pendiente (no se asume país)
  currency      char(3),                                 -- ISO 4217, pendiente
  timezone      text NOT NULL DEFAULT 'UTC',
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assets.site (                               -- OCPI Location; PDF stationResponse
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES assets.tenant(id),
  code             text NOT NULL,                        -- 'SEDE-A'
  name             text NOT NULL,                        -- PDF stationName
  address          text NOT NULL, city text, postal_code text, country_code char(2),
  latitude         numeric(10,7) NOT NULL, longitude numeric(10,7) NOT NULL,   -- PDF latitude/longitude (10,7)
  timezone         text NOT NULL,                        -- IANA; franjas de tarifa (TAR) en esta zona
  access_type      text NOT NULL DEFAULT 'PUBLIC' CHECK (access_type IN ('PUBLIC','PRIVATE','SEMI_PUBLIC')),
  opening_hours    jsonb NOT NULL DEFAULT '{"twentyfourseven": true}',   -- OCPI Hours; PDF businessHours
  grid_max_power_w integer,                              -- límite de acometida (FUN M09)
  owner_party_id   uuid,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PLANNED','ACTIVE','MAINTENANCE','RETIRED')),
  created_at       timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE assets.charge_point (                        -- ChargingStation / ChargePoint
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES assets.tenant(id),
  site_id               uuid NOT NULL REFERENCES assets.site(id),
  charge_box_id         text NOT NULL UNIQUE CHECK (char_length(charge_box_id) BETWEEN 3 AND 48),  -- path WSS (global)
  serial_number         text,                             -- BootNotification.chargePointSerialNumber; PDF chargePointSerialNumber
  vendor text, model text, firmware_version text, iccid text, imsi text, meter_type text, meter_serial text,
  ocpp_version          text NOT NULL DEFAULT 'ocpp1.6' CHECK (ocpp_version IN ('ocpp1.6','ocpp2.0.1','ocpp2.1')),
  security_profile      smallint NOT NULL DEFAULT 2 CHECK (security_profile BETWEEN 1 AND 3),
  registration_status   text NOT NULL DEFAULT 'Pending' CHECK (registration_status IN ('Accepted','Pending','Rejected')),
  lifecycle_status      text NOT NULL DEFAULT 'provisioned'
                        CHECK (lifecycle_status IN ('provisioned','pending_approval','accepted','rejected','revoked','retired')), -- SEG
  config_template_id    uuid,                             -- config.ocpp_config_template
  supported_profiles    text[] NOT NULL DEFAULT '{}',     -- SupportedFeatureProfiles
  number_of_connectors  smallint,                         -- NumberOfConnectors
  heartbeat_interval_s  integer NOT NULL DEFAULT 300,     -- devuelto en BootNotification.conf.interval
  cp_status             assets.ocpp_status NOT NULL DEFAULT 'Unavailable',   -- StatusNotification connectorId=0
  cp_error_code         assets.error_code NOT NULL DEFAULT 'NoError',
  connected             boolean NOT NULL DEFAULT false,
  connection_generation bigint NOT NULL DEFAULT 0,        -- fencing token (§5.11)
  last_seen_at          timestamptz, last_boot_at timestamptz, last_disconnect_at timestamptz,
  clock_offset_s        integer,                          -- received_at - timestamp del cargador (último Boot/Heartbeat)
  created_at            timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX charge_point_site_idx ON assets.charge_point (site_id);
CREATE INDEX charge_point_stale_idx ON assets.charge_point (last_seen_at) WHERE connected;

CREATE TABLE assets.evse (                                -- OCPI EVSE; 1.6: 1 EVSE por connectorId
  id                 uuid PRIMARY KEY,
  charge_point_id    uuid NOT NULL REFERENCES assets.charge_point(id) ON DELETE CASCADE,
  ocpp_evse_id       smallint NOT NULL CHECK (ocpp_evse_id >= 1),    -- 1.6: = connectorId; 2.0.1: evse.id
  evse_id            text NOT NULL UNIQUE,                 -- público (QR/roaming); PDF connectorCode '6234002911'
  physical_reference text,
  max_power_w        integer,
  visible_in_app     boolean NOT NULL DEFAULT true,
  reservable         boolean NOT NULL DEFAULT false,
  admin_status       text NOT NULL DEFAULT 'IN_SERVICE' CHECK (admin_status IN ('IN_SERVICE','MAINTENANCE','RETIRED')),
  UNIQUE (charge_point_id, ocpp_evse_id)
);

CREATE TABLE assets.connector (                           -- toma física; PDF connectorResponse
  id                     uuid PRIMARY KEY,
  evse_id                uuid NOT NULL REFERENCES assets.evse(id) ON DELETE CASCADE,
  charge_point_id        uuid NOT NULL REFERENCES assets.charge_point(id) ON DELETE CASCADE,
  ocpp_connector_id      smallint NOT NULL CHECK (ocpp_connector_id >= 1),   -- StatusNotification.connectorId
  standard               assets.connector_standard NOT NULL,   -- PDF connectorType TYPE_2 -> IEC_62196_T2, CCS -> IEC_62196_T2_COMBO
  power_type             assets.power_type NOT NULL,
  max_voltage_v integer, min_voltage_v integer, max_current_a integer, max_power_w integer,   -- PDF límites eléctricos
  ocpp_status            assets.ocpp_status NOT NULL DEFAULT 'Unavailable',  -- último StatusNotification.status (crudo)
  error_code             assets.error_code NOT NULL DEFAULT 'NoError',
  vendor_error_code      text, status_info text,
  status_at_cp           timestamptz, status_received_at timestamptz,
  status_seq             bigint NOT NULL DEFAULT 0,       -- descarta notificaciones reordenadas
  current_transaction_id uuid,                            -- sessions.ocpp_transaction ACTIVE
  UNIQUE (charge_point_id, ocpp_connector_id)
);

CREATE TABLE assets.charge_point_config (                 -- ConfigurationKey: deseado vs observado
  charge_point_id uuid NOT NULL REFERENCES assets.charge_point(id) ON DELETE CASCADE,
  key             text NOT NULL CHECK (char_length(key) <= 50),          -- CiString50
  desired_value   text CHECK (char_length(desired_value) <= 500),
  observed_value  text CHECK (char_length(observed_value) <= 500),       -- GetConfiguration.conf (CiString500)
  readonly        boolean,
  source          text NOT NULL DEFAULT 'TEMPLATE' CHECK (source IN ('TEMPLATE','OVERRIDE','DEVICE')),
  last_result     text CHECK (last_result IN ('Accepted','Rejected','RebootRequired','NotSupported')),  -- ChangeConfiguration.conf
  last_synced_at  timestamptz, last_changed_at timestamptz,
  drift           boolean GENERATED ALWAYS AS (desired_value IS NOT NULL AND observed_value IS DISTINCT FROM desired_value) STORED,
  PRIMARY KEY (charge_point_id, key)
);
CREATE INDEX cp_config_drift_idx ON assets.charge_point_config (charge_point_id) WHERE drift;

-- Estado efectivo para app y back-office: los 9 estados OCPP + Offline derivado (PDF connectorStatus)
CREATE VIEW assets.v_connector_live AS
SELECT c.id AS connector_id, c.evse_id, e.evse_id AS evse_code, cp.id AS charge_point_id, cp.charge_box_id,
       cp.site_id, cp.tenant_id, c.ocpp_connector_id, c.standard, c.power_type, c.max_power_w,
       CASE WHEN NOT cp.connected
              OR cp.last_seen_at < now() - make_interval(secs => 2 * cp.heartbeat_interval_s)
            THEN 'Offline' ELSE c.ocpp_status::text END AS status,
       c.ocpp_status AS last_ocpp_status, c.error_code, c.vendor_error_code, c.status_info,
       c.status_at_cp, cp.last_seen_at, c.current_transaction_id
FROM assets.connector c
JOIN assets.evse e ON e.id = c.evse_id
JOIN assets.charge_point cp ON cp.id = c.charge_point_id;

-- ============================================================
-- 2. auth
-- ============================================================
CREATE TABLE auth.driver (
  id                        uuid PRIMARY KEY,
  tenant_id                 uuid NOT NULL REFERENCES assets.tenant(id),
  idp_subject               text UNIQUE,                  -- uid de Identity Platform
  email text, phone text, display_name text, locale text NOT NULL DEFAULT 'es',
  segment                   text NOT NULL DEFAULT 'PUBLIC',   -- TAR tariff_assignment.segment
  status                    text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED','DELETED')),
  default_payment_method_id uuid,
  consents                  jsonb NOT NULL DEFAULT '{}',
  anonymized_at             timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX driver_email_uq ON auth.driver (tenant_id, lower(email)) WHERE email IS NOT NULL AND anonymized_at IS NULL;

CREATE TABLE auth.id_token (                              -- idTag 1.6 (CiString20)
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES assets.tenant(id),
  driver_id       uuid REFERENCES auth.driver(id),
  token           text NOT NULL CHECK (char_length(token) <= 20),
  token_type      text NOT NULL CHECK (token_type IN ('RFID','APP','QR','AUTOCHARGE','EMAID','FLEET','OPERATOR')),
  parent_token    text CHECK (char_length(parent_token) <= 20),   -- parentIdTag
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED','EXPIRED','INVALID')),
  valid_from      timestamptz NOT NULL DEFAULT now(), valid_until timestamptz,
  in_local_list   boolean NOT NULL DEFAULT false, local_list_version integer,
  last_used_at    timestamptz, last_charge_point_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX id_token_uq ON auth.id_token (tenant_id, upper(token));   -- CiString: case-insensitive

-- ============================================================
-- 3. sessions
-- ============================================================
CREATE SEQUENCE sessions.ocpp_transaction_id_seq AS integer START 1000 MINVALUE 1 MAXVALUE 2147483647;

CREATE TABLE sessions.charging_session (                  -- sesión de negocio (FUN charging_order; PDF order)
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES assets.tenant(id),
  session_no              text NOT NULL,                  -- 'VO-2026-000123' (recibos); PDF orderNo
  driver_id               uuid REFERENCES auth.driver(id),
  id_token_id             uuid REFERENCES auth.id_token(id),
  id_tag                  text NOT NULL,                  -- valor presentado al cargador
  site_id                 uuid NOT NULL REFERENCES assets.site(id),
  charge_point_id         uuid NOT NULL REFERENCES assets.charge_point(id),
  evse_id                 uuid NOT NULL REFERENCES assets.evse(id),
  connector_id            uuid REFERENCES assets.connector(id),
  start_channel           text NOT NULL CHECK (start_channel IN ('APP','QR','RFID','AUTOCHARGE','ROAMING','OPERATOR','UNSOLICITED')),
  auth_method             text NOT NULL CHECK (auth_method IN ('AUTH_REQUEST','COMMAND','WHITELIST')),   -- OCPI AuthMethod
  state                   sessions.session_state NOT NULL DEFAULT 'REQUESTED',
  state_changed_at        timestamptz NOT NULL DEFAULT now(),
  idempotency_key         text,                           -- Idempotency-Key de POST /v1/sessions
  remote_start_command_id uuid,
  ocpp_transaction_id     uuid,                           -- FK diferida (abajo)
  reservation_id          uuid,
  requested_at            timestamptz NOT NULL DEFAULT now(),
  authorized_at timestamptz, start_deadline_at timestamptz,   -- RemoteStart.conf + ConnectionTimeOut + margen
  started_at timestamptz, ended_at timestamptz, settled_at timestamptz, paid_at timestamptz,
  interrupted_at          timestamptz,                    -- BootNotification con transacción activa
  idle_since              timestamptz,                    -- carga completa / ocupación (FUN M07)
  energy_wh bigint, charging_time_s integer, idle_time_s integer,   -- CDR total_energy / total_time / total_parking_time
  stop_reason             sessions.stop_reason,           -- PDF endReason 'Remote'
  end_kind                text CHECK (end_kind IN ('NORMAL','TIMEOUT','ESTIMATED','ORPHAN','FAILED')),
  failure_code            text,                           -- REMOTE_START_REJECTED | CHARGER_OFFLINE | CONNECTION_TIMEOUT | PSP_DECLINED ...
  tariff_snapshot_id      uuid,                           -- tariffs.session_tariff_snapshot.session_id (TAR)
  final_calc_id           uuid,                           -- tariffs.session_cost_calc (kind FINAL)
  currency                char(3),
  subtotal_minor bigint, discount_minor bigint, tax_minor bigint, total_minor bigint,   -- PDF totalAmount/reduceAmount/actualAmount
  preauth_minor           bigint,                         -- PDF startAmount
  payment_status          text NOT NULL DEFAULT 'NONE'
                          CHECK (payment_status IN ('NONE','AUTHORIZED','CAPTURED','FAILED','REFUNDED','WAIVED','WALLET')),
  last_sample             jsonb,                          -- {at, power_w, voltage_v, current_a, soc, energy_wh}: PDF lastProcessData
  app_seq                 bigint NOT NULL DEFAULT 0,      -- id: de SSE (Last-Event-ID)
  created_at              timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, session_no),
  UNIQUE (idempotency_key)
);
CREATE UNIQUE INDEX one_live_session_per_evse ON sessions.charging_session (evse_id)
  WHERE state IN ('AUTHORIZED','STARTING','CHARGING','SUSPENDED_EV','SUSPENDED_EVSE','STOPPING');
CREATE INDEX cs_driver_idx   ON sessions.charging_session (driver_id, requested_at DESC);
CREATE INDEX cs_live_idx     ON sessions.charging_session (tenant_id, state)
  WHERE state NOT IN ('SETTLED','PAID','FAILED','CANCELLED','EXPIRED');
CREATE INDEX cs_deadline_idx ON sessions.charging_session (start_deadline_at) WHERE state = 'STARTING';
CREATE INDEX cs_ended_idx    ON sessions.charging_session (tenant_id, ended_at DESC) WHERE ended_at IS NOT NULL;

CREATE TABLE sessions.ocpp_transaction (                  -- transacción de protocolo: 1 por StartTransaction aceptado
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL,
  charge_point_id      uuid NOT NULL REFERENCES assets.charge_point(id),
  evse_id              uuid NOT NULL REFERENCES assets.evse(id),
  ocpp_connector_id    smallint NOT NULL,
  ocpp_transaction_id  integer NOT NULL,                  -- 1.6: entero asignado por el CSMS (StartTransaction.conf)
  ocpp_transaction_ref text NOT NULL,                     -- 1.6: el entero como texto; 2.0.1/2.1: transactionId string(36)
  session_id           uuid REFERENCES sessions.charging_session(id),   -- NULL = no solicitada
  id_tag               text NOT NULL,
  id_tag_status        text NOT NULL CHECK (id_tag_status IN ('Accepted','Blocked','Expired','Invalid','ConcurrentTx')),
  reservation_ocpp_id  integer,                           -- StartTransaction.reservationId
  meter_start_wh       bigint NOT NULL CHECK (meter_start_wh >= 0),
  meter_stop_wh        bigint CHECK (meter_stop_wh >= 0),
  started_at_cp        timestamptz NOT NULL,              -- StartTransaction.req.timestamp (reloj del cargador)
  started_received_at  timestamptz NOT NULL DEFAULT now(),
  stopped_at_cp        timestamptz, stopped_received_at timestamptz,
  stop_reason          sessions.stop_reason,
  stop_id_tag          text,
  state                sessions.tx_state NOT NULL DEFAULT 'ACTIVE',
  offline_start        boolean NOT NULL DEFAULT false,
  offline_stop         boolean NOT NULL DEFAULT false,
  clock_offset_s       integer,                           -- offset aplicado al recibir
  start_unique_id text, stop_unique_id text,              -- uniqueId de los CALL (trazabilidad / dedupe)
  transaction_data     jsonb,                             -- StopTransaction.transactionData crudo
  last_seq_no          integer,                           -- 2.0.1 TransactionEvent.seqNo (huecos)
  charging_state       text CHECK (charging_state IN ('Charging','EVConnected','SuspendedEV','SuspendedEVSE','Idle')), -- 2.0.1
  anomaly_flags        text[] NOT NULL DEFAULT '{}',      -- DUPLICATE_STOP, METER_DECREASING, JUMP, GAP, CLOCK_SKEW, LATE_START, UNMAPPED_TX
  created_at           timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (charge_point_id, ocpp_transaction_id),                        -- clave natural + propiedad (SteVe #1296)
  UNIQUE (charge_point_id, ocpp_transaction_ref),
  UNIQUE (charge_point_id, ocpp_connector_id, started_at_cp, meter_start_wh, id_tag),   -- idempotencia de StartTransaction
  CHECK (meter_stop_wh IS NULL OR meter_stop_wh >= meter_start_wh OR 'METER_DECREASING' = ANY (anomaly_flags))
);
CREATE UNIQUE INDEX one_active_tx_per_connector ON sessions.ocpp_transaction (charge_point_id, ocpp_connector_id)
  WHERE state = 'ACTIVE';
CREATE INDEX tx_active_by_tag_idx ON sessions.ocpp_transaction (tenant_id, upper(id_tag)) WHERE state = 'ACTIVE';  -- ConcurrentTx
CREATE INDEX tx_session_idx ON sessions.ocpp_transaction (session_id);
ALTER TABLE sessions.charging_session ADD CONSTRAINT cs_tx_fk
  FOREIGN KEY (ocpp_transaction_id) REFERENCES sessions.ocpp_transaction(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE sessions.meter_value (                       -- serie temporal: 1 fila por sampledValue
  tenant_id          uuid NOT NULL,
  charge_point_id    uuid NOT NULL,
  ocpp_connector_id  smallint NOT NULL,                   -- 0 = medidor principal del cargador
  transaction_id     uuid,                                -- sessions.ocpp_transaction.id (NULL fuera de transacción)
  sampled_at         timestamptz NOT NULL,                -- MeterValue.timestamp (reloj del cargador) — clave de partición
  received_at        timestamptz NOT NULL DEFAULT now(),
  measurand          sessions.measurand NOT NULL DEFAULT 'Energy.Active.Import.Register',   -- defaults OCPP 1.6
  context            sessions.reading_context NOT NULL DEFAULT 'Sample.Periodic',
  phase              sessions.phase NOT NULL DEFAULT 'NONE',
  location           sessions.mv_location NOT NULL DEFAULT 'Outlet',
  unit               sessions.unit NOT NULL DEFAULT 'Wh',
  value              numeric(16,4) NOT NULL,
  value_wh           bigint GENERATED ALWAYS AS (CASE WHEN unit = 'Wh'  THEN round(value)::bigint
                                                      WHEN unit = 'kWh' THEN round(value * 1000)::bigint END) STORED,
  signed_data        text,                                -- format = SignedData (OCMF) si el medidor lo soporta
  source             text NOT NULL DEFAULT 'MeterValues'
                     CHECK (source IN ('MeterValues','StartTransaction','StopTransaction','Trigger')),
  PRIMARY KEY (charge_point_id, ocpp_connector_id, sampled_at, measurand, context, location, phase)  -- dedupe natural
) PARTITION BY RANGE (sampled_at);
CREATE INDEX meter_value_tx_idx ON sessions.meter_value (transaction_id, sampled_at) WHERE transaction_id IS NOT NULL;

-- Particiones mensuales automáticas (pg_partman 5.x) y mantenimiento diario con pg_cron

CREATE TABLE sessions.reservation (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL,
  driver_id           uuid, id_tag text NOT NULL, parent_id_tag text,
  charge_point_id     uuid NOT NULL REFERENCES assets.charge_point(id),
  evse_id             uuid REFERENCES assets.evse(id),
  ocpp_connector_id   smallint NOT NULL,                  -- 0 si ReserveConnectorZeroSupported
  ocpp_reservation_id integer NOT NULL,                   -- ReserveNow.reservationId
  expiry_at           timestamptz NOT NULL,               -- ReserveNow.expiryDate
  status              text NOT NULL CHECK (status IN ('REQUESTED','ACCEPTED','REJECTED','FAULTED','OCCUPIED','UNAVAILABLE',
                                                       'CANCELLED','EXPIRED','USED')),
  command_id          uuid, session_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (charge_point_id, ocpp_reservation_id)
);

CREATE TABLE sessions.charging_profile (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL,
  charge_point_id   uuid NOT NULL REFERENCES assets.charge_point(id),
  ocpp_connector_id smallint NOT NULL DEFAULT 0,          -- 0 = todo el cargador (ChargePointMaxProfile)
  ocpp_profile_id   integer NOT NULL,                     -- csChargingProfiles.chargingProfileId
  stack_level       integer NOT NULL,
  purpose           text NOT NULL CHECK (purpose IN ('ChargePointMaxProfile','TxDefaultProfile','TxProfile')),
  kind              text NOT NULL CHECK (kind IN ('Absolute','Recurring','Relative')),
  recurrency        text CHECK (recurrency IN ('Daily','Weekly')),
  valid_from timestamptz, valid_to timestamptz,
  transaction_id    uuid REFERENCES sessions.ocpp_transaction(id),   -- obligatorio si TxProfile
  schedule          jsonb NOT NULL,                       -- chargingSchedule {duration, startSchedule, chargingRateUnit, chargingSchedulePeriod[], minChargingRate}
  origin            text NOT NULL CHECK (origin IN ('SITE_LIMIT','LOAD_BALANCER','TARIFF','OPERATOR','DRIVER')),
  status            text NOT NULL DEFAULT 'DESIRED' CHECK (status IN ('DESIRED','ACCEPTED','REJECTED','NOT_SUPPORTED','CLEARED')),
  set_command_id uuid, applied_at timestamptz, cleared_at timestamptz,
  UNIQUE (charge_point_id, ocpp_profile_id),
  CHECK (purpose <> 'TxProfile' OR transaction_id IS NOT NULL)
);

-- Proyección a los estados de la app (ARQ §1.4)
CREATE FUNCTION sessions.app_state(s sessions.session_state) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s
    WHEN 'REQUESTED' THEN 'REQUESTED'  WHEN 'AUTHORIZED' THEN 'REQUESTED'
    WHEN 'STARTING'  THEN 'STARTING'
    WHEN 'CHARGING'  THEN 'ACTIVE'     WHEN 'SUSPENDED_EV' THEN 'ACTIVE'  WHEN 'SUSPENDED_EVSE' THEN 'ACTIVE'
    WHEN 'STOPPING'  THEN 'STOPPING'   WHEN 'ENDED' THEN 'ENDED'
    WHEN 'SETTLED'   THEN 'SETTLED'    WHEN 'PAID' THEN 'SETTLED'
    WHEN 'FAILED'    THEN 'FAILED'     WHEN 'EXPIRED' THEN 'FAILED'
    WHEN 'CANCELLED' THEN 'CANCELLED' END
$$;

-- ============================================================
-- 4. billing (extracto; tariffs.* según TAR §1.5)
-- ============================================================
CREATE TABLE billing.payment_method (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, driver_id uuid NOT NULL REFERENCES auth.driver(id),
  psp text NOT NULL, psp_customer_id text, psp_method_id text NOT NULL,   -- token del PSP; nunca PAN
  kind text NOT NULL CHECK (kind IN ('CARD','WALLET','FLEET_ACCOUNT','INVOICE')),
  brand text, last4 char(4), expires_month smallint, expires_year smallint,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REMOVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (psp, psp_method_id)
);

CREATE TABLE billing.payment (                            -- una fila por operación con el PSP
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  session_id uuid REFERENCES sessions.charging_session(id),
  driver_id uuid, payment_method_id uuid REFERENCES billing.payment_method(id),
  kind text NOT NULL CHECK (kind IN ('PREAUTH','CAPTURE','REFUND','VOID','WALLET_TOPUP')),
  amount_minor bigint NOT NULL, currency char(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED','CANCELLED')),
  psp text NOT NULL, psp_reference text,                  -- 'pi_…' (PDF thirdPartyTransactionId)
  idempotency_key text NOT NULL UNIQUE,
  parent_payment_id uuid REFERENCES billing.payment(id),  -- CAPTURE/VOID -> PREAUTH; REFUND -> CAPTURE
  raw jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_session_idx ON billing.payment (session_id);

CREATE TABLE billing.wallet (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, driver_id uuid NOT NULL UNIQUE REFERENCES auth.driver(id),
  currency char(3) NOT NULL, balance_minor bigint NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),   -- caché del ledger
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing.ledger_entry (                       -- append-only
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wallet_id uuid NOT NULL REFERENCES billing.wallet(id),
  kind text NOT NULL CHECK (kind IN ('TOPUP','SESSION_CHARGE','REFUND','ADJUSTMENT','EXPIRY')),
  amount_minor bigint NOT NULL,                           -- + abono, - cargo
  balance_after_minor bigint NOT NULL,
  session_id uuid, payment_id uuid, idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE billing.invoice (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, driver_id uuid,
  series text NOT NULL DEFAULT 'A', number text NOT NULL,   -- numeración legal: pendiente por país
  kind text NOT NULL CHECK (kind IN ('RECEIPT','INVOICE','CREDIT_NOTE')),
  currency char(3) NOT NULL, subtotal_minor bigint NOT NULL, tax_minor bigint NOT NULL, total_minor bigint NOT NULL,
  tax_breakdown jsonb NOT NULL DEFAULT '[]', buyer_snapshot jsonb,   -- datos del comprador congelados (base legal tributaria)
  session_ids uuid[] NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(), pdf_uri text,
  einvoice_status text, einvoice_ref text,                -- DIAN/SII/SAT/…: pendiente
  UNIQUE (tenant_id, series, number)
);
CREATE TABLE billing.refund (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, payment_id uuid NOT NULL REFERENCES billing.payment(id),
  amount_minor bigint NOT NULL, currency char(3) NOT NULL, reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('REQUESTED','APPROVED','SUCCEEDED','FAILED')),
  requested_by text NOT NULL, approved_by text, credit_note_id uuid REFERENCES billing.invoice(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. ops
-- ============================================================
CREATE TABLE ops.command (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL,
  charge_point_id  uuid NOT NULL REFERENCES assets.charge_point(id),
  action           text NOT NULL,                         -- RemoteStartTransaction, Reset, UnlockConnector, ...
  payload          jsonb NOT NULL,
  unique_id        text NOT NULL CHECK (char_length(unique_id) <= 36),   -- ULID = uniqueId del CALL
  state            ops.command_state NOT NULL DEFAULT 'PENDING',
  priority         smallint NOT NULL DEFAULT 5,           -- 1 = RemoteStop/Reset; 9 = masivos
  attempts         smallint NOT NULL DEFAULT 0, max_attempts smallint NOT NULL DEFAULT 1,
  timeout_ms       integer NOT NULL DEFAULT 10000,
  expected_generation bigint,                             -- fencing: el gateway responde NOT_OWNER si no coincide
  requested_by     text NOT NULL,                         -- staff:<id> | driver:<id> | system:<job>
  session_id       uuid, correlation_id text,
  requested_at     timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, responded_at timestamptz, timeout_at timestamptz,
  response         jsonb, result_status text,             -- CALLRESULT y su .status
  error_code text, error_description text,                -- CALLERROR
  late_response_at timestamptz,                           -- CALLRESULT tras TIMEOUT: se registra, no se aplica
  UNIQUE (charge_point_id, unique_id)
);
CREATE INDEX command_cp_idx   ON ops.command (charge_point_id, requested_at DESC);
CREATE INDEX command_open_idx ON ops.command (state, timeout_at) WHERE state IN ('PENDING','SENT');

CREATE TABLE ops.ocpp_message_log (                       -- particionada por día; retención 30 días
  ts                    timestamptz NOT NULL,             -- hora del servidor
  tenant_id             uuid,
  charge_box_id         text NOT NULL,
  direction             text NOT NULL CHECK (direction IN ('CP2CS','CS2CP')),
  message_type          smallint NOT NULL CHECK (message_type IN (2,3,4)),   -- CALL, CALLRESULT, CALLERROR
  unique_id             text NOT NULL,
  action                text,                             -- en CALLRESULT/CALLERROR se copia del CALL correlacionado
  payload               jsonb,                            -- idTag enmascarado; truncado si > ocpp.log_max_bytes
  error_code text, error_description text,
  size_bytes integer, latency_ms integer,
  pod text, connection_generation bigint
) PARTITION BY RANGE (ts);
CREATE INDEX oml_cb_ts_idx ON ops.ocpp_message_log (charge_box_id, ts DESC);
CREATE INDEX oml_uid_idx   ON ops.ocpp_message_log (charge_box_id, unique_id);

CREATE TABLE ops.charge_point_connection (                -- historial de conexiones WebSocket (SLA, forense)
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  charge_point_id uuid NOT NULL REFERENCES assets.charge_point(id),
  generation      bigint NOT NULL,
  pod text NOT NULL, remote_ip inet, subprotocol text, security_profile smallint,
  connected_at    timestamptz NOT NULL, disconnected_at timestamptz,
  close_code smallint, close_reason text,
  msgs_in bigint NOT NULL DEFAULT 0, msgs_out bigint NOT NULL DEFAULT 0,
  UNIQUE (charge_point_id, generation)
);

CREATE TABLE ops.alarm (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  site_id uuid, charge_point_id uuid, evse_id uuid,
  kind          text NOT NULL,                            -- CONNECTOR_FAULTED | CHARGER_OFFLINE | STUCK_PREPARING | STUCK_FINISHING | METER_ANOMALY |
                                                          -- ORPHAN_TRANSACTION | CLOCK_SKEW | CONFIG_DRIFT | SECURITY_EVENT | FIRMWARE_FAILED | UNKNOWN_CHARGER_BOOT | PAYMENT_FAILED
  severity      text NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  fingerprint   text NOT NULL,                            -- kind|charge_box_id|connector|errorCode
  status        ops.alarm_status NOT NULL DEFAULT 'OPEN',
  occurrences   integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  acked_by text, acked_at timestamptz, resolved_at timestamptz, resolution text,
  details       jsonb NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX alarm_open_uq  ON ops.alarm (fingerprint) WHERE status <> 'RESOLVED';
CREATE INDEX        alarm_open_idx ON ops.alarm (tenant_id, severity, last_seen_at DESC) WHERE status <> 'RESOLVED';

CREATE TABLE ops.event_outbox (                           -- outbox transaccional (§4.4)
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- orden de publicación
  event_id       text NOT NULL UNIQUE,                    -- 'evt_' || ULID; clave de idempotencia downstream
  type           text NOT NULL,
  version        smallint NOT NULL DEFAULT 1,
  tenant_id      uuid NOT NULL,
  aggregate_type text NOT NULL, aggregate_id text NOT NULL,
  ordering_key   text NOT NULL,                           -- chargeBoxId o sessionId
  occurred_at    timestamptz NOT NULL,
  payload        jsonb NOT NULL,                          -- sobre completo (ARQ §2.2)
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz, attempts smallint NOT NULL DEFAULT 0, last_error text
);
CREATE INDEX outbox_pending_idx ON ops.event_outbox (id) WHERE published_at IS NULL;

CREATE TABLE ops.consumer_inbox (                         -- idempotencia de consumidores (§4.5)
  consumer     text NOT NULL,
  event_id     text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  outcome      text,
  PRIMARY KEY (consumer, event_id)
);

CREATE TABLE ops.firmware_update (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, charge_point_id uuid NOT NULL REFERENCES assets.charge_point(id),
  location text NOT NULL, retrieve_at timestamptz NOT NULL, retries smallint, retry_interval_s integer,
  target_version text, signed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'SCHEDULED',               -- + valores de FirmwareStatusNotification
  command_id uuid, booted_version text, finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. config (FUN M20: 5 niveles con herencia)
-- ============================================================
CREATE TABLE config.param_definition (
  key              text PRIMARY KEY,                      -- 'session.orphan_timeout_h'
  value_schema     jsonb NOT NULL,                        -- JSON Schema del valor
  allowed_scopes   text[] NOT NULL,                       -- {'PLATFORM','TENANT','SITE','CHARGE_POINT','CONNECTOR'}
  default_value    jsonb NOT NULL,
  description      text, requires_restart boolean NOT NULL DEFAULT false
);
CREATE TABLE config.config_param (
  id          uuid PRIMARY KEY,
  key         text NOT NULL REFERENCES config.param_definition(key),
  scope_type  text NOT NULL CHECK (scope_type IN ('PLATFORM','TENANT','SITE','CHARGE_POINT','CONNECTOR')),
  scope_id    uuid,                                       -- NULL para PLATFORM
  value       jsonb NOT NULL,
  valid_from  timestamptz NOT NULL DEFAULT now(), valid_to timestamptz,
  updated_by  text NOT NULL, reason text,
  UNIQUE (key, scope_type, scope_id, valid_from)
);
CREATE TABLE config.ocpp_config_template (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, name text NOT NULL, version integer NOT NULL DEFAULT 1,
  applies_to jsonb NOT NULL DEFAULT '{}',                 -- {vendor, model, power_type}
  keys jsonb NOT NULL,                                    -- {"HeartbeatInterval":"300","MeterValueSampleInterval":"60",...}
  read_only_expected text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, version)
);

-- Valor efectivo: CONNECTOR -> CHARGE_POINT -> SITE -> TENANT -> PLATFORM -> default
CREATE FUNCTION config.resolve(p_key text, p_connector uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH s AS (
    SELECT c.id AS connector_id, cp.id AS charge_point_id, cp.site_id, cp.tenant_id
    FROM assets.connector c JOIN assets.charge_point cp ON cp.id = c.charge_point_id WHERE c.id = p_connector),
  v AS (
    SELECT p.value, CASE p.scope_type WHEN 'CONNECTOR' THEN 1 WHEN 'CHARGE_POINT' THEN 2 WHEN 'SITE' THEN 3
                                      WHEN 'TENANT' THEN 4 ELSE 5 END AS rank, p.valid_from
    FROM config.config_param p, s
    WHERE p.key = p_key AND now() >= p.valid_from AND (p.valid_to IS NULL OR now() < p.valid_to)
      AND ((p.scope_type = 'CONNECTOR'    AND p.scope_id = s.connector_id)
        OR (p.scope_type = 'CHARGE_POINT' AND p.scope_id = s.charge_point_id)
        OR (p.scope_type = 'SITE'         AND p.scope_id = s.site_id)
        OR (p.scope_type = 'TENANT'       AND p.scope_id = s.tenant_id)
        OR (p.scope_type = 'PLATFORM')))
  SELECT COALESCE((SELECT value FROM v ORDER BY rank, valid_from DESC LIMIT 1),
                  (SELECT default_value FROM config.param_definition WHERE key = p_key));
$$;

-- ============================================================
-- 7. Multi-tenant y roles (SEG): RLS por tenant en las tablas con tenant_id; el gateway escribe con un rol
--    limitado (meter_value, ocpp_message_log, charge_point_connection, columnas de conectividad).
-- ============================================================
ALTER TABLE sessions.charging_session ENABLE ROW LEVEL SECURITY;
CREATE POLICY cs_tenant ON sessions.charging_session USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- (misma política en assets.*, auth.*, billing.*, ops.command/alarm, sessions.ocpp_transaction/meter_value)
