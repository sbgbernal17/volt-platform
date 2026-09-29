# RB-12. Worker

**Alerta:** `[env] Trabajo del worker fallido` (línea `trabajo fallido` con el campo `job`). Los trabajos son idempotentes y se reintentan en el siguiente ciclo; la alerta importa si se repite.

| `job` | Qué revisar |
|---|---|
| `outbox-relay` | Redis o Pub/Sub (`Pub/Sub respondió 403`: falta `roles/pubsub.publisher` a `volt-worker@`; `404`: topic). Los eventos quedan pendientes con `last_error` en `ops.event_outbox`. |
| `connection-watch` | Base de datos (RB-13). Sin este trabajo no se abren ni cierran alarmas de cargador fuera de línea. |
| `billing`, `billing-reconciliation` | Llaves de Wompi (`unset` en Secret Manager = no configuradas), red hacia Wompi. |
| `push-notifications` | Expo Push (`DeviceNotRegistered` es normal; errores 5xx de Expo se reintentan). |
| `pricing-settlement`, `session-limits`, `session-start-timeouts`, `orphan-transactions` | Base de datos y gateway (comandos). |
| `partitions`, `audit-chain`, `config-drift` | Diarios; el fallo de `audit-chain` abre una alarma CRITICAL (cadena de auditoría rota). |

`gcloud run services logs read worker --region us-central1 --limit 200` muestra el contexto. El worker corre con una sola instancia siempre encendida (`worker_min_instances`).
