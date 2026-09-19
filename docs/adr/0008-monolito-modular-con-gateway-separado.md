# 0008. Monolito modular hexagonal con el gateway OCPP como proceso separado

Fecha: 2026-09-19. Estado: aceptada.

## Contexto

Un equipo pequeño (Claude Code y el dueño del proyecto) necesita un sistema fácil de razonar, probar y desplegar, sin la sobrecarga operativa de muchos servicios, pero con el gateway aislado por su perfil de carga distinto.

## Decisión

Tres procesos de despliegue: `ocpp-gateway` (conexiones persistentes), `api` (dominio y rutas `/v1` y `/admin`) y `worker` (relay del outbox, timeouts, conciliación, notificaciones). El dominio vive en paquetes internos (`@volt/domain`, `@volt/tariff-engine`, `@volt/events`, `@volt/db`) con puertos explícitos (registro de cargadores, pasarela de pago, facturación electrónica, notificaciones) y adaptadores por proveedor. Los procesos se comunican por la base de datos, Redis y eventos de dominio publicados con patrón outbox hacia Pub/Sub; ningún adaptador externo se llama desde dentro de una transacción de base de datos.

## Alternativas consideradas

- Microservicios por módulo desde el inicio: más despliegues, más contratos y más fallos parciales sin beneficio a esta escala.
- Un único proceso para todo: mezcla conexiones persistentes con trabajo por lotes y HTTP; complica el escalado y los despliegues sin cortes.

## Consecuencias

- Las reglas de negocio se prueban sin infraestructura (funciones puras y máquinas de estado en `@volt/domain`).
- Si un módulo crece (por ejemplo, tarifas o pagos), puede extraerse a su propio proceso sin cambiar el dominio.
