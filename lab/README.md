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
