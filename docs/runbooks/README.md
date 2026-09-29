# Runbooks

Procedimientos operativos enlazados desde las políticas de alerta de Cloud Monitoring (ADR 0023). Los de negocio (RB-01 a RB-09) resumen y remiten a OPS §3; los de plataforma (RB-10 en adelante) son nuevos en la iteración 8. Cada alerta llega al correo configurado en `alert_emails` (`infra/terraform/envs/<env>.tfvars`).

| Runbook | Alerta que lo dispara |
|---|---|
| [RB-01 Cargador fuera de línea](RB-01-cargador-offline.md) | `[env] Cargador fuera de línea` (alarma `CHARGER_OFFLINE`) |
| [RB-10 Gateway caído o reiniciándose](RB-10-gateway-caido.md) | `[env] Gateway OCPP reiniciándose`, `[env] ocpp no responde desde internet` |
| [RB-11 API y Cloud Run](RB-11-api-y-cloud-run.md) | `[env] API con errores 5xx`, `[env] API consumiendo el presupuesto de error`, `[env] api no responde desde internet` |
| [RB-12 Worker](RB-12-worker.md) | `[env] Trabajo del worker fallido` |
| [RB-13 Cloud SQL](RB-13-cloud-sql.md) | `[env] Cloud SQL con CPU alta`, `[env] Cloud SQL con disco casi lleno` |
| [RB-14 Redis](RB-14-redis.md) | `[env] Redis con memoria alta` |
| [RB-15 Despliegue y reversión](RB-15-despliegue-y-reversion.md) | Cualquier incidente tras un despliegue |
| [RB-16 Restauración de Cloud SQL](RB-16-restauracion-de-cloud-sql.md) | Pérdida o corrupción de datos (prueba trimestral, SEG §6.2) |

Dónde mirar: Consola → Monitoring → panel "Volt <env>: plataforma"; Logs Explorer con `jsonPayload.event="alarm.raised"` o `jsonPayload.chargeBoxId="<id>"`; back-office → Alarmas.
