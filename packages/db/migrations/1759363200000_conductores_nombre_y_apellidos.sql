-- 0014. Nombre y apellidos separados del conductor (tarea 9h: datos del adquiriente de la factura
-- electrónica según el contador). `display_name` se conserva como nombre para mostrar y se arma a
-- partir de los dos campos; los conductores existentes se reparten por el primer espacio.
ALTER TABLE auth.driver
  ADD COLUMN first_name text,
  ADD COLUMN last_name  text;

UPDATE auth.driver SET
  first_name = NULLIF(split_part(btrim(display_name), ' ', 1), ''),
  last_name  = NULLIF(btrim(substr(btrim(display_name), length(split_part(btrim(display_name), ' ', 1)) + 1)), '')
WHERE display_name IS NOT NULL AND anonymized_at IS NULL;
