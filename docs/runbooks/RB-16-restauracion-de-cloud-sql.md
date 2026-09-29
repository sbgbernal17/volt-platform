# RB-16. Restauración de Cloud SQL (backup y PITR)

Objetivo: RPO 5 min (PITR con 7 días de WAL), RTO 4 h. Probar en staging una vez por trimestre y anotar el tiempo (SEG §6.2).

1. **Elegir el punto:** último backup diario (06:00 UTC) o un instante (`--point-in-time`) anterior al incidente.
2. **Restaurar a una instancia nueva** (no sobre la actual): `gcloud sql instances clone volt-<env>-pg volt-<env>-pg-restore --point-in-time "2026-09-29T12:00:00Z"`.
3. **Verificar** con Cloud SQL Studio: recuento de sesiones del día, última fila de `ops.event_outbox`, `SELECT max(created_at) FROM sessions.charging_session`.
4. **Cambiar la plataforma** a la instancia restaurada: importar la instancia en Terraform o actualizar el secreto `database-url` con la IP privada nueva y volver a desplegar api, worker, gateway y sintético (RB-15). Los cargadores no se ven afectados: reconectan solos.
5. **Después:** borrar la instancia dañada cuando no haga falta para el análisis; registrar el incidente y el tiempo real de recuperación.
