# Laboratorio de software OCPP

Herramientas para probar el gateway sin hardware. Requiere Docker con Compose v2.

## Simuladores de cargador

`docker-compose.lab.yml` construye desde el código fuente dos simuladores que interpretan la especificación de forma distinta, lo que hace aflorar errores del servidor (HW §4.2):

| Servicio | Proyecto | OCPP |
|---|---|---|
| `sim-sap` | SAP e-mobility-charging-stations-simulator (TypeScript) | 1.6, 2.0.1 |
| `sim-microocpp` | MicroOcpp Simulator (C++), con interfaz web | 1.6, 2.0.1 |

Los simuladores se apuntan al gateway local en `ws://host.docker.internal:9220/ocpp/<chargeBoxId>` con las credenciales del registro estático del gateway (`OCPP_STATIC_REGISTRY` en `.env`). Las imágenes se construyen a partir de los repositorios públicos; la primera construcción tarda varios minutos. Las rutas de configuración de cada simulador están indicadas en el archivo de Compose y deben verificarse contra la versión clonada (a confirmar en la primera ejecución).

```bash
docker compose -f lab/docker-compose.lab.yml up --build
```

## Suites de prueba abiertas para el CSMS

- `tzi-app/tzi-OCTT` (pytest): 75 casos para OCPP 1.6J y 252 para 2.0.1, con API para que el CSMS dispare mensajes.
- `juherr/open-ocpp-tck` (TypeScript): 47 escenarios de certificación 1.6 y 36 de 2.0.1.

Se integran en CI en la iteración 1 contra el gateway. La certificación formal con OCTT de la Open Charge Alliance es de pago y opcional (OPS §4.7).

## Cargador real

El cargador de laboratorio se apunta a `wss://ocpp.staging.<dominio>/ocpp/<chargeBoxId>` con perfil de seguridad 2 cuando exista staging (iteración 8). Hasta entonces puede apuntarse al gateway local por `ws://` solo dentro de la red del laboratorio.
