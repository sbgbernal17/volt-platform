# 0013. API interna HTTP del gateway, directorio de conexiones en Redis y `uniqueId` generado por el gateway

Fecha: 2026-09-22. Estado: aceptada.

## Contexto

ARQ §4.3 y §6.3 proponen que `api` y `worker` envíen comandos al pod del gateway que tiene el WebSocket del cargador mediante gRPC (`Gateway.SendCall`, `GetConnection`, `Disconnect`), localizando el pod en Redis (`cs:conn:{chargeBoxId}`). En la iteración 2 hacen falta ya `GetConfiguration`, `ChangeConfiguration`, `Reset`, `TriggerMessage`, `ChangeAvailability` y `UnlockConnector` desde la API de administración y desde el trabajo diario de deriva. Restricciones: sin dependencias nuevas sin justificarlas (gRPC exigiría `@grpc/grpc-js`, `@grpc/proto-loader` y tooling de protobuf); `ocpp-rpc` genera él mismo el `uniqueId` de cada CALL saliente y no permite fijarlo; el outbox y Pub/Sub llegan en la iteración 3.

## Decisión

1. El gateway expone una **API interna HTTP/JSON** en un puerto propio (`OCPP_GATEWAY_INTERNAL_PORT`, 9222) protegida con un token compartido (`OCPP_GATEWAY_INTERNAL_TOKEN`, comparación en tiempo constante), con la misma semántica que el contrato gRPC: `POST /internal/v1/calls` (una CALL y su CALLRESULT/CALLERROR), `GET /internal/v1/connections/{chargeBoxId}` y `POST /internal/v1/connections/{chargeBoxId}/disconnect`. Errores tipados equivalentes a los gRPC: `NOT_CONNECTED` (404), `TIMEOUT` (504), `QUEUE_FULL` (429), `INVALID_REQUEST` (400, payload fuera del esquema OCPP), `INVALID_RESPONSE` (422, respuesta del cargador fuera del esquema), `CALL_ERROR` (502, con el `errorCode` OCPP-J) y `UNAVAILABLE` (pod inalcanzable, lo detecta el cliente). Una sola CALL en vuelo por conexión y cola acotada (`OCPP_CALL_QUEUE_MAX`). El cliente (`@volt/gateway-client`) reintenta una vez tras `UNAVAILABLE`/`NOT_CONNECTED` releyendo el directorio (ARQ §4.3, regla 6).
2. **Directorio de conexiones en Redis** según ARQ §4.4: `cs:conn:{chargeBoxId}` = `{podId, internalUrl, protocol, connectedAt, generation}` con TTL de 90 s refrescado cada 30 s, borrado *compare-and-delete* (Lua) al cerrar, y canal `cs:evict:{podId}` para que el pod que aún tiene un socket viejo lo cierre con código 1008. Sin Redis (laboratorio y pruebas) se usa un directorio estático apuntando a un único gateway (`OCPP_GATEWAY_INTERNAL_URL`).
3. El **`uniqueId` de la CALL lo genera el gateway** (`ocpp-rpc`, UUID) y se devuelve a la `api`, que lo guarda en `ops.command.unique_id` tras enviar; `ops.command.id` (uuid) identifica el comando desde su creación y un ULID provisional ocupa `unique_id` hasta que el gateway responde. Si el gateway devolviera un id ya usado para ese cargador, se conserva el provisional.
4. Hasta que exista el outbox (iteración 3), el gateway **persiste directamente** en PostgreSQL la conectividad (`connected`, `connection_generation`, `ops.charge_point_connection`), los datos de `BootNotification`, los estados de conector, `last_seen_at` (con un mínimo entre escrituras) y el log OCPP (por lotes, con `idTag` y `AuthorizationKey` enmascarados), y aplica las transiciones de ciclo de vida que dependen del arranque (PROVISIONED → CONNECTED_PENDING; CONNECTED_PENDING → REJECTED con alarma `INVENTORY_MISMATCH` si vendor/model no coinciden con el inventario). Cuando llegue el outbox, estas escrituras pasarán a eventos consumidos por el worker sin cambiar la API interna.

## Alternativas consideradas

- **gRPC como en ARQ §6.3.** Ventajas: contrato tipado, streaming futuro. Desventajas: tres dependencias nuevas y tooling de generación para una interfaz de tres operaciones; se puede introducir después detrás de la misma interfaz `GatewayClient` sin tocar `api` ni `worker`.
- **Redis Pub/Sub para los comandos (opción A de ARQ §4.2).** Desacopla la red, pero es *fire-and-forget* y necesita correlación de respuestas; queda como respaldo si la `api` no puede alcanzar los pods.
- **Generar el `uniqueId` en la `api`.** Exigiría parchear `ocpp-rpc` o sustituirlo; el valor de la regla (correlación de logs) se conserva porque el gateway devuelve el id y lo escribe en `ops.ocpp_message_log`.

## Consecuencias

- En GKE el puerto interno debe ser alcanzable desde Cloud Run (Direct VPC egress y regla de firewall al rango de pods, ARQ §4.2, opción B) y nunca se expone por el balanceador. El token vive en Secret Manager; el paso a mTLS interno se evalúa con la iteración 8.
- `api` y `worker` necesitan `OCPP_GATEWAY_INTERNAL_TOKEN` y `REDIS_URL` (o `OCPP_GATEWAY_INTERNAL_URL` con un solo pod).
- Cuando el gateway escale a varios pods, la evicción entre pods y el TTL del directorio se prueban en la iteración 8 con el clúster real; con un pod, el directorio estático basta.
- Revisar en la iteración 3: trasladar las escrituras de dominio del gateway al outbox y dejar al gateway solo con telemetría y credenciales (rol limitado de base de datos, DAT §7).
