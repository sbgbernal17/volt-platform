# 0034. Nombre y apellidos separados y datos del comprador para la DIAN

Fecha: 2026-10-01. Estado: aceptada.

## Contexto

El contador respondió (tarea 9h) qué datos del comprador son obligatorios en el documento equivalente o la factura electrónica: nombre y apellidos o razón social; número de documento (cédula de ciudadanía o NIT, con o sin dígito de verificación); y correo electrónico. El dueño pidió además guardar el nombre y los apellidos por separado. Hasta ahora el conductor tenía un solo `display_name` (el nombre que da Identity Platform o el que escribe en el perfil) y el documento de identidad opcional de ADR 0027.

## Decisión

1. **Dos campos en `auth.driver`**: `first_name` y `last_name` (migración `1759363200000_conductores_nombre_y_apellidos.sql`). `display_name` se conserva como nombre completo derivado (`nombre apellidos`) para listas, avisos push y compatibilidad; la migración rellena los dos campos partiendo `display_name` en el primer espacio (aproximación que el conductor corrige en Perfil).
2. **Dónde se piden**: el registro de la app pide Nombre y Apellidos por separado (los dos obligatorios); Perfil los muestra y edita; el alta manual del back-office también. La API acepta `firstName` y `lastName` (1 a 60 caracteres, anulables) en `PATCH /v1/me` y en `POST /admin/v1/drivers`, y los devuelve en el perfil y en el detalle de conductor. La primera entrada con Identity Platform parte el `displayName` del proveedor.
3. **Datos del comprador en el recibo**: `invoice.buyer_snapshot` guarda `firstName`, `lastName`, `displayName`, el documento (tipo y número normalizado; el NIT siempre con su dígito de verificación, calculado si falta, ADR 0027) y el correo: son los datos que pedirá el documento electrónico en la iteración 10. El NIT se acepta con o sin dígito desde ADR 0027.
4. **Razón social**: para personas jurídicas el contador exige la razón social en lugar de nombre y apellidos. Por ahora el perfil no la pide (se usa el nombre de quien registra la cuenta). **Decisión del dueño (02-10-2026)**: cuando el cliente pida facturación a nombre de una empresa, el perfil debe permitir **razón social, NIT y dirección**; el correo del documento es el mismo de la cuenta. Se implementa en la iteración 10 junto con la facturación electrónica: campos `business_name`, `tax_id` (NIT con dígito de verificación) y `billing_address` en `auth.driver`, visibles en Perfil solo cuando el cliente marca "facturar a nombre de una empresa", en el detalle de conductor del back-office y en el documento electrónico (el recibo sigue a nombre del conductor salvo que exista razón social).

## Alternativas consideradas

- Partir el nombre completo al emitir el documento: poco fiable con apellidos compuestos ("de la Rosa", "García Márquez").
- Pedir solo el nombre completo y dejar que el contador lo corrija: traslada trabajo manual a cada cobro.

## Consecuencias

- Campos nuevos en API, app y back-office; `display_name` sigue existiendo y se recalcula al cambiar el nombre o los apellidos.
- La anonimización (`driver.anonymize`) borra también `first_name` y `last_name`.
- Las cuentas creadas antes del cambio pueden tener los apellidos mal partidos hasta que el conductor edite su perfil.
