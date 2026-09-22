# 0016. Transacciones OCPP resueltas por el gateway con el núcleo compartido, SSE sobre el outbox y Pub/Sub diferido

Fecha: 2026-09-22. Estado: aceptada.

## Contexto

ARQ §2.4 y DAT §3.2 describen el flujo de sesiones: la `api` crea la sesión y envía `RemoteStartTransaction`; el cargador responde con `StartTransaction`, `MeterValues` y `StopTransaction`, que el gateway entrega al dominio; los eventos salen por el outbox a Pub/Sub y de ahí al fan-out SSE de la app. La iteración 3 tiene que funcionar de punta a punta en local y en CI, sin proyecto de Google Cloud, y sin Identity Platform ni Wompi (iteraciones 5 y 7).

## Decisión

1. **El gateway resuelve las transacciones invocando al núcleo compartido (`@volt/csms`, `TransactionService`) contra PostgreSQL**, en el mismo proceso, en lugar de una llamada gRPC a la `api`. La lógica (idempotencia, propiedad por cargador, huérfanas, offline, transiciones de sesión) vive en el paquete y es la misma que usan la `api` y el `worker`. `StartTransaction` se acepta siempre y el `transactionId` sale de la secuencia de PostgreSQL; el `idTagInfo` solo es `Accepted` para tokens emitidos por la plataforma (SEG S4), con `ConcurrentTx`, `Blocked` y `Expired` según DAT §5.
2. **Outbox transaccional y relay con puerto de publicación.** Todo cambio de estado escribe su evento en `ops.event_outbox` en la misma transacción. El `worker` publica los lotes (SKIP LOCKED, *at-least-once*) a través de `EventPublisher`; en local y laboratorio el adaptador es un canal de Redis y, sin Redis, el log. El adaptador de Pub/Sub se añade con la infraestructura (iteración 8), cuando exista el topic y las credenciales por Workload Identity.
3. **El flujo SSE de la app lee el outbox directamente** (`GET /v1/sessions/{id}/events`): sondea los eventos del agregado cada segundo, usa el `id` del outbox como `id:` de SSE para reanudar con `Last-Event-ID` y cierra al terminar la sesión. No depende del broker; a la escala del MVP (decenas de sesiones simultáneas) el sondeo es despreciable y se puede sustituir por suscripción Redis o Pub/Sub sin cambiar el contrato.
4. **Puertos para lo que aún no existe:** identidad del conductor (`DriverVerifier`; en desarrollo `Bearer dev:<driverId>`, activable solo con `API_DEV_DRIVER_AUTH=true` y prohibido en producción) e autorización de pago (`PaymentAuthorizer`; sin adaptador, toda sesión queda autorizada sin cobro). La iteración 5 aporta Wompi y la 7 Identity Platform.
5. **Tokens de prueba y paso a TESTED.** Los tokens `TEST` permiten sesiones sin cobro en cargadores `CONFIGURED`/`TESTED`; una sesión de prueba terminada en un cargador `CONFIGURED` lo pasa a `TESTED` automáticamente (OPS §1.3, paso 7).
6. **Cierre por el worker:** sesiones `STARTING` vencidas → `EXPIRED`; transacciones activas de cargadores desconectados más de `orphan_timeout_h` (12 h) → `CLOSED_ESTIMATED` con la última lectura y sesión `ENDED` estimada; particiones mensuales de `meter_value` y del log OCPP creadas por el worker (sin pg_partman).

## Alternativas consideradas

- **Gateway → api por gRPC/HTTP para cada mensaje de transacción.** Un salto de red y otro punto de fallo en el camino crítico; la misma lógica tendría que exponerse como API. Se descarta mientras `api` y `gateway` compartan el paquete de dominio.
- **Fan-out SSE por Pub/Sub o Redis desde el principio.** Más piezas para un beneficio marginal a esta escala; queda como evolución.
- **`@google-cloud/pubsub` ya en esta iteración.** Sin proyecto ni emulador en CI no se puede verificar; se pospone a la iteración 8.

## Consecuencias

- El rol de base de datos del gateway necesita escritura en `sessions`, `auth.id_token` (uso) y `ops.event_outbox`; el rol limitado de DAT §7 se define en la iteración 8 con Terraform.
- Las sesiones `UNSOLICITED` (arranques locales o durante cortes) existen desde ya; su cobro depende de la política `billing.unsolicited_tx_policy` que llega con las iteraciones 4 y 5.
- `MeterValues` no se acumula en Pub/Sub uno a uno: cada `MeterValues` genera un evento `session.metered` en el outbox (una fila por mensaje, no por medición), suficiente para la app; la serie completa vive en `sessions.meter_value`.
