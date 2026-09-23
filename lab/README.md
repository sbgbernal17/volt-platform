# Laboratorio de software OCPP

Herramientas para probar el gateway sin hardware. El simulador embebido no necesita Docker; los simuladores externos sí (Compose v2).

## Simulador embebido (`@volt/ocpp-sim`)

Cargador OCPP 1.6J en TypeScript que responde a `GetConfiguration`, `ChangeConfiguration`, `Reset` (reconecta y vuelve a arrancar), `TriggerMessage`, `ChangeAvailability`, `UnlockConnector` y `ClearCache`, con configuración de fábrica distinta de la plantilla de Volt para que el comisionamiento tenga algo que corregir. Es el mismo que usan las pruebas automáticas.

Comisionamiento completo en local, con PostgreSQL y Redis levantados (`pnpm services:up`, `pnpm db:migrate`) y `.env` copiado de `.env.example`:

```bash
pnpm dev:gateway                     # terminal 1: gateway con registro en la base de datos
pnpm dev:api                         # terminal 2: API con /admin/v1
export TOKEN=cambia-este-token-admin-local
export API=http://localhost:8080/admin/v1
export H="Authorization: Bearer $TOKEN"

# 1. sede, plantilla y cargador en inventario
SITE=$(curl -s -X POST $API/sites -H "$H" -H 'content-type: application/json' -d '{"code":"LAB","name":"Laboratorio","address":"Calle 1","latitude":4.7,"longitude":-74.1}' | jq -r .id)
TPL=$(curl -s -X POST $API/config-templates -H "$H" -H 'content-type: application/json' -d '{"name":"DC-180-publico","keys":{"HeartbeatInterval":"300","MeterValueSampleInterval":"15","WebSocketPingInterval":"60"},"optionalKeys":["WebSocketPingInterval"]}' | jq -r .id)
CP=$(curl -s -X POST $API/charge-points -H "$H" -H 'content-type: application/json' -d "{\"siteId\":\"$SITE\",\"chargeBoxId\":\"SIM-001\",\"vendor\":\"VoltSim\",\"model\":\"SIM-DC180\",\"configTemplateId\":\"$TPL\",\"connectors\":[{\"ocppConnectorId\":1,\"standard\":\"IEC_62196_T2_COMBO\",\"powerType\":\"DC\",\"maxPowerW\":180000},{\"ocppConnectorId\":2,\"standard\":\"IEC_62196_T2_COMBO\",\"powerType\":\"DC\",\"maxPowerW\":180000}]}" | jq -r .id)

# 2. credencial (se muestra una sola vez) -> PROVISIONED
KEY=$(curl -s -X POST $API/charge-points/$CP/credentials -H "$H" | jq -r .authorizationKey)

# 3. el cargador simulado se conecta con la clave (terminal 3) -> BootNotification Pending -> CONNECTED_PENDING
SIM_IDENTITY=SIM-001 SIM_PASSWORD=$KEY SIM_ENDPOINT=ws://127.0.0.1:9220/ocpp pnpm --filter @volt/ocpp-sim start

# 4. comisionar: GetConfiguration, ChangeConfiguration por deriva, Reset si hace falta, verificación -> CONFIGURED
curl -s -X POST $API/charge-points/$CP/commission -H "$H" | jq '{configured, rebootRequired, changes, after: .after.blockingDrift}'

# 5. comandos y aprobación
curl -s -X POST $API/charge-points/$CP/commands -H "$H" -H 'content-type: application/json' -d '{"action":"TriggerMessage","payload":{"requestedMessage":"StatusNotification"}}' | jq .command.state
curl -s -X POST $API/charge-points/$CP/lifecycle -H "$H" -H 'content-type: application/json' -d '{"to":"TESTED","reason":"prueba manual"}'
curl -s -X POST $API/charge-points/$CP/lifecycle -H "$H" -H 'content-type: application/json' -d '{"to":"OPERATIONAL","reason":"aprobado"}'

# 6. deriva: cambia una key en el simulador (o con un ChangeConfiguration manual) y sincroniza
curl -s -X POST $API/charge-points/$CP/configuration/sync -H "$H" | jq '{drift: .sync.drift, alarm}'
curl -s $API/charge-points/$CP -H "$H" | jq '{lifecycle_status, connected, drift, alarms}'
```

## Sesión de carga de punta a punta (iteración 3)

Con el cargador simulado ya OPERATIONAL (pasos anteriores) y `pnpm dev:worker` en otra terminal:

```bash
# conductor de prueba e identidad de desarrollo (API_DEV_DRIVER_AUTH=true en .env)
DRIVER=$(curl -s -X POST $API/drivers -H "$H" -H 'content-type: application/json' -d '{"email":"ana@example.com","displayName":"Ana"}' | jq -r .id)
export D="Authorization: Bearer dev:$DRIVER"

curl -s http://localhost:8080/v1/locations | jq '.items[0].evses'          # mapa con estado en vivo
SESSION=$(curl -s -X POST http://localhost:8080/v1/sessions -H "$D" -H 'content-type: application/json' -H 'Idempotency-Key: demo-1' -d '{"evseId":"SIM-001-1"}' | jq -r .id)
curl -sN http://localhost:8080/v1/sessions/$SESSION/events -H "$D"          # progreso por SSE (Ctrl+C para salir)
curl -s http://localhost:8080/v1/sessions/$SESSION -H "$D" | jq '{state, energyKwh, powerKw, soc}'
curl -s -X POST http://localhost:8080/v1/sessions/$SESSION/stop -H "$D" | jq .state
curl -s $API/sessions/$SESSION -H "$H" | jq '{state, energy_wh, stop_reason, events: [.events[].type]}'
```

Corte de red: en el simulador, `goOffline()`/`goOnline()` encolan y reenvían `StartTransaction`, `MeterValues` y `StopTransaction` con sus sellos originales; el CSMS acepta la transacción, marca `offline_start`/`offline_stop` y no duplica nada aunque el cargador reintente (prueba `apps/ocpp-gateway/src/transactions.db.test.ts`).

## Tarifas y costo de una sesión (iteración 4)

Sin tarifa vigente ninguna sesión de app arranca (fail-closed, `NO_TARIFF`). Un solo comando publica la tarifa base de Volt (ADR 0012 y 0017: precios de ejemplo por franja, 15 minutos de gracia y 1.500 COP por minuto de ocupación, IVA incluido) y la asigna como respaldo `PLATFORM/PUBLIC`:

```bash
curl -s -X POST $API/tariffs/bootstrap -H "$H" | jq '{tariff: .tariff.code, version: .version.version, created}'
curl -s http://localhost:8080/v1/evses/SIM-001-1 | jq .tariff          # lo que verá la app: precio por kWh ahora, franjas, ocupación, gracia, tope
curl -s "$API/tariff-assignments/resolve?evseCode=SIM-001-1&segment=PUBLIC" -H "$H" | jq '{segmentUsed, candidates}'
```

Durante la carga el costo en curso llega en cada `session.metered` del SSE y en `GET /v1/sessions/{id}` (`cost`). Al terminar, si el vehículo sigue conectado, la ocupación corre hasta que el conector vuelve a `Available`; el worker liquida la sesión (`SETTLED`) y deja las líneas:

```bash
curl -s http://localhost:8080/v1/sessions/$SESSION/cost -H "$D" | jq '{summary, final: .final.lines}'
curl -s $API/sessions/$SESSION/cost -H "$H" | jq '.final'
curl -s -X POST $API/sessions/$SESSION/settle -H "$H" -H 'content-type: application/json' -d '{"force":true}' | jq .status   # liquidar sin esperar al worker
```

Cambiar precios y parámetros:

```bash
TARIFF=$(curl -s $API/tariffs -H "$H" | jq -r '.items[0].id')
curl -s $API/tariffs/$TARIFF -H "$H" | jq '.versions[0].definition' > /tmp/tarifa.json   # edita los precios (texto decimal, IVA incluido)
curl -s -X POST $API/tariffs/$TARIFF/versions -H "$H" -H 'content-type: application/json' -d "{\"definition\": $(cat /tmp/tarifa.json), \"notes\": \"precios reales\"}" | jq '{version, warnings}'
curl -s -X POST $API/tariffs/$TARIFF/versions/2/publish -H "$H" -H 'content-type: application/json' -d '{}' | jq .status
curl -s -X PUT $API/parameters/pricing.exposure_limit_minor -H "$H" -H 'content-type: application/json' -d '{"scopeType":"PLATFORM","value":150000,"reason":"tope nuevo"}' | jq .value
curl -s -X POST $API/pricing/simulate -H "$H" -H 'content-type: application/json' -d '{"tariffVersionId":"<id de la versión>","scenario":{"startAt":"2026-10-06T10:00:00-05:00","durationMin":60,"energyWh":10000,"idleMin":20}}' | jq '{total, lines: [.lines[] | {dimension, quantity, unit, total}]}'
```

La prueba `apps/api/src/pricing.e2e.test.ts` recorre el flujo completo con el simulador (`suspendEv`, `unplug`, `stayPluggedAfterStop`): carga que termina, gracia, ocupación por segundo, tope de exposición que detiene la sesión y liquidación.

## Pagos con Wompi (iteración 5)

Sin medio de pago registrado ninguna sesión de app arranca (`NO_PAYMENT_METHOD`). En local, con `PAYMENTS_PROVIDER=fake` en `.env`, la API lleva un emulador de pasarela en memoria: los cobros, deudas y webhooks se ejercitan sin red desde `POST $API/billing/jobs/run` (el worker solo cobra con `wompi`). Con las llaves del sandbox (`PAYMENTS_PROVIDER=wompi`, `WOMPI_*`), el flujo es el real: la app tokeniza la tarjeta con el widget de Wompi y Volt crea la fuente de pago.

```bash
curl -s http://localhost:8080/v1/billing -H "$D" | jq '{canCharge, reason, status, debts}'
curl -s http://localhost:8080/v1/payment-methods/acceptance -H "$D" | jq .          # tokens de aceptación para el alta
# con el sandbox: TOKEN = el que devuelve el widget (tarjeta 4242 4242 4242 4242 aprobada, 4111 1111 1111 1111 rechazada)
curl -s -X POST http://localhost:8080/v1/payment-methods -H "$D" -H 'content-type: application/json' \
  -d '{"type":"CARD","token":"tok_test_...","acceptanceToken":"...","personalDataAuthToken":"..."}' | jq .
curl -s http://localhost:8080/v1/sessions/$SESSION -H "$D" | jq '{state, paymentStatus, cost, receipt}'
curl -s -X POST $API/billing/jobs/run -H "$H" -H 'content-type: application/json' -d '{"job":"all"}' | jq .   # cobrar ahora
curl -s http://localhost:8080/v1/sessions/$SESSION/receipt -H "$D" | jq '{number, totals, payment}'
curl -s "http://localhost:8080/v1/sessions/$SESSION/receipt?format=html" -H "$D" > recibo.html
curl -s "$API/payments?sessionId=$SESSION" -H "$H" | jq '.items[] | {kind, status, reference, psp_status}'
curl -s -X POST $API/payments/<id>/reverse -H "$H" -H 'content-type: application/json' -d '{"reason":"prueba"}' | jq '{kind, status}'
curl -s "$API/debts?status=OPEN" -H "$H" | jq .                                       # cobros rechazados
curl -s -X POST http://localhost:8080/v1/debts/<id>/pay-link -H "$D" | jq .          # enlace de checkout para saldar
curl -s -X POST $API/billing/reconcile -H "$H" -H 'content-type: application/json' -d '{}' | jq '{day, counts, discrepancies}'
```

El webhook de Wompi se registra en su panel apuntando a `https://api.supercargadores.co/v1/webhooks/wompi` (en local, un túnel como `ngrok`); cada evento se verifica con el secreto de eventos y se guarda en `billing.webhook_inbox` (`GET $API/billing/webhooks`). La prueba `apps/api/src/payments.e2e.test.ts` recorre el flujo completo con el emulador y `apps/api/src/wompi.sandbox.test.ts` contrasta el adaptador con el sandbox real cuando existen las llaves de prueba.

## Back-office (iteración 6)

```bash
pnpm dev:api          # con API_ADMIN_TOKEN en .env (y PAYMENTS_PROVIDER=fake para ver pagos)
pnpm dev:backoffice   # http://localhost:5173
```

Entra con el token de administración (sección "Laboratorio" de la pantalla de entrada; el actor que declares queda en la auditoría). Recorrido sugerido: Sedes → nueva sede; Cargadores → nuevo cargador con sus conectores → Emitir credencial (se muestra una sola vez) → pestañas Configuración, Comandos (con confirmación y motivo en los sensibles) y Bitácora; Tarifas → crear la tarifa base de Volt → Simulador; Personal → invitar; Auditoría → verificar cadena. Con el simulador embebido (`pnpm --filter @volt/api ...` de las secciones anteriores) los cargadores aparecen conectados y el resumen "Ahora" se refresca cada 10 s.

Para probar la entrada real con Identity Platform: `IDENTITY_PLATFORM_PROJECT_ID`, `IDENTITY_PLATFORM_API_KEY` y `API_STAFF_BOOTSTRAP_EMAIL` en `.env` (ver `.env.example`), un usuario con ese correo en Identity Platform (correo verificado) y, para ADMIN u OPERATIONS, el segundo factor TOTP que la pantalla te guía a activar. `apps/api/src/staff.e2e.test.ts` cubre la verificación de tokens, el RBAC por rol y la auditoría con secretos redactados.

## Simuladores de cargador externos

`docker-compose.lab.yml` construye desde el código fuente dos simuladores que interpretan la especificación de forma distinta, lo que hace aflorar errores del servidor (HW §4.2):

| Servicio | Proyecto | OCPP |
|---|---|---|
| `sim-sap` | SAP e-mobility-charging-stations-simulator (TypeScript) | 1.6, 2.0.1 |
| `sim-microocpp` | MicroOcpp Simulator (C++), con interfaz web | 1.6, 2.0.1 |

Los simuladores se apuntan al gateway local en `ws://host.docker.internal:9220/ocpp/<chargeBoxId>` con la credencial emitida por la API (`POST /admin/v1/charge-points/{id}/credentials`) o, si el gateway corre sin base de datos, con las del registro estático (`OCPP_STATIC_REGISTRY` en `.env`). Las imágenes se construyen a partir de los repositorios públicos; la primera construcción tarda varios minutos. Las rutas de configuración de cada simulador están indicadas en el archivo de Compose y deben verificarse contra la versión clonada (a confirmar en la primera ejecución).

```bash
docker compose -f lab/docker-compose.lab.yml up --build
```

## Suites de prueba abiertas para el CSMS

- `tzi-app/tzi-OCTT` (pytest): 75 casos para OCPP 1.6J y 252 para 2.0.1, con API para que el CSMS dispare mensajes.
- `juherr/open-ocpp-tck` (TypeScript): 47 escenarios de certificación 1.6 y 36 de 2.0.1.

Se integran en CI en la iteración 1 contra el gateway. La certificación formal con OCTT de la Open Charge Alliance es de pago y opcional (OPS §4.7).

## Cargador real

El cargador de laboratorio se apunta a `wss://ocpp.staging.<dominio>/ocpp/<chargeBoxId>` con perfil de seguridad 2 cuando exista staging (iteración 8). Hasta entonces puede apuntarse al gateway local por `ws://` solo dentro de la red del laboratorio.
