-- Potencia máxima del gabinete (ADR 0026). Un cargador de 180 kW entrega hasta 180 kW a un solo
-- conector; si dos vehículos cargan a la vez, el gabinete reparte la potencia entre ellos. La
-- potencia por conector (assets.connector.max_power_w) sigue siendo la que recibe un conector solo.
ALTER TABLE assets.charge_point
  ADD COLUMN max_power_w integer CHECK (max_power_w > 0);
COMMENT ON COLUMN assets.charge_point.max_power_w IS
  'Potencia máxima del gabinete en W; se reparte entre los conectores que cargan a la vez';

-- Relleno de los cargadores existentes: el gabinete entrega al menos lo que entrega su conector mayor.
UPDATE assets.charge_point cp
SET max_power_w = sub.max_w
FROM (
  SELECT charge_point_id, MAX(max_power_w) AS max_w
  FROM assets.connector
  GROUP BY charge_point_id
) sub
WHERE sub.charge_point_id = cp.id AND sub.max_w IS NOT NULL AND cp.max_power_w IS NULL;
