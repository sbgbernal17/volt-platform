-- 0015. Avisos de progreso de la carga (petición del dueño del 02-10-2026, ADR 0037): el worker
-- envía un push cada tantos kWh entregados con la energía, la potencia y el costo acumulado. La clase
-- CHARGING_PROGRESS entra en la lista por defecto de `notifications.push_kinds` (si un tenant la
-- sobrescribió, conserva su lista) y el paso en kWh es parámetro.
INSERT INTO config.param_definition (key, value_schema, allowed_scopes, default_value, description) VALUES
  ('notifications.progress_step_kwh', '{"type":"number","minimum":0.5,"maximum":100}', '{PLATFORM,TENANT}', '5',
   'Cada cuántos kWh entregados se avisa el progreso de la carga por push (clase CHARGING_PROGRESS); entre avisos pasan al menos 5 minutos')
ON CONFLICT (key) DO NOTHING;

UPDATE config.param_definition
SET default_value = default_value || '["CHARGING_PROGRESS"]'::jsonb
WHERE key = 'notifications.push_kinds' AND NOT (default_value ? 'CHARGING_PROGRESS');
