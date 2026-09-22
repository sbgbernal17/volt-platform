-- ============================================================
-- Entregas del dueño del 22-09-2026 (ADR 0018): la ocupación se cobra mientras el vehículo siga
-- conectado, sin tope de tiempo. La liquidación espera el fin de la ocupación hasta 24 horas
-- (antes 4 h); después cierra administrativamente con la bandera IDLE_TIMEOUT.
-- ============================================================
UPDATE config.param_definition
SET default_value = '86400',
    description = 'Tiempo máximo que la liquidación espera el fin de la ocupación tras la transacción (24 h; la ocupación se cobra mientras el vehículo siga conectado, ADR 0018)'
WHERE key = 'session.idle_settle_timeout_s';
