# 0035. IP fija de salida para los servicios de Cloud Run (Cloud NAT)

Fecha: 2026-10-01. Estado: aceptada (aplicada en staging; prod la hereda).

## Contexto

ADR 0023 decidió no usar Cloud NAT: los servicios que salen a internet (Wompi, Brevo, Expo, JWKS) corren en Cloud Run y salían por la salida propia de Google, con direcciones que cambian y se comparten con otros clientes. Dos proveedores lo convirtieron en un problema el 01-10-2026:

- **Wompi**: el sandbox respondió a la plataforma de staging con una página (no JSON) y después con un `403` explícito, solo para las peticiones que salían de Cloud Run; desde fuera el sandbox respondía bien con las mismas llaves. Identificar al cliente con un `User-Agent` propio ayudó un rato; el bloqueo volvió con otra dirección de salida. Es la causa más probable de los cobros "rechazados" de staging del 30-09.
- **Brevo**: la cuenta tiene la restricción *IP autorizadas*, que rechaza las llamadas (`401 unauthorised IP`) desde direcciones que no estén en su lista; sin IP fija el dueño tuvo que desactivarla.

Prod necesitará lo mismo: Wompi y Brevo (y cualquier proveedor con lista de IP, como el de facturación electrónica) deben ver siempre la misma dirección.

## Decisión

1. **Cloud NAT con una dirección reservada, opcional por ambiente** (`static_egress_ip = true` en el `tfvars`): `google_compute_address` regional, `google_compute_router` y `google_compute_router_nat` en modo `MANUAL_ONLY` sobre la subred de salida directa a la VPC de Cloud Run, con registro solo de errores. Cuando está activo, los cuatro servicios de Cloud Run (`api`, `worker`, `backoffice`, `app-web`) pasan a `vpc_access.egress = ALL_TRAFFIC`, de modo que todo su tráfico a internet sale por esa dirección; cuando no, siguen con `PRIVATE_RANGES_ONLY` como en ADR 0023.
2. **Dónde se ve la IP**: salida `egress_ip` de Terraform, impresa por el flujo *Infraestructura (Terraform)* al aplicar ("IP fija de salida (Cloud NAT)") y anotada en `docs/tareas-del-dueno.md` para darla a Wompi, Brevo y otros proveedores. No es un secreto.
3. **Ambientes**: activada en staging desde el 01-10-2026 (`34.42.100.85`); prod la activará desde su creación; dev sigue sin ella (usa el emulador de pagos y no necesita listas de IP; si Brevo vuelve a activar la restricción de IP, dev dejaría de enviar correos por Brevo y usaría el respaldo de Identity Platform de ADR 0032).
4. El gateway en GKE sigue sin NAT: no sale a internet (ADR 0023, decisión 6).

## Alternativas consideradas

- **Seguir sin IP fija y pedir a Wompi que no bloquee** las direcciones de Google: no es controlable (las direcciones cambian) y Brevo seguiría sin lista de IP.
- **Proxy propio de salida** (una VM pequeña con IP fija): más barato en lista (unos 10 USD/mes) pero añade un punto único de fallo y mantenimiento de sistema operativo; Cloud NAT es gestionado y escala solo.
- **Conector de acceso a VPC sin servidor** en lugar de la salida directa: más caro (instancias siempre encendidas) y es la opción antigua; la salida directa ya estaba en uso.

## Consecuencias

- Costo con precios de lista: unos 35 USD/mes por ambiente con NAT (puerta de enlace ≈ 32 USD, dirección reservada ≈ 3 USD; el tráfico procesado es despreciable a este volumen). Staging pasa de ≈ 370 a ≈ 405 USD/mes; se refleja en la sección de costos de `docs/tareas-del-dueno.md`.
- Toda la salida a internet de Cloud Run (incluidas Identity Platform, Expo Push y JWKS) pasa por la NAT: hay que vigilar el agotamiento de puertos si el tráfico crece (`min_ports_per_vm` por defecto; los registros de errores de la NAT avisan).
- Si Wompi bloquea también la IP fija, la solicitud de desbloqueo es por escrito al proveedor, con la dirección exacta; lo mismo para incluirla en la lista de Brevo.
- Se actualiza la deuda de ADR 0023: "Cloud NAT si algún pod necesita internet" pasa a estar resuelto para Cloud Run; el gateway sigue sin salida.
