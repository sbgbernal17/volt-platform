# RB-13. Cloud SQL

**Alertas:** `[env] Cloud SQL con CPU alta` (> 80 % 15 min) y `[env] Cloud SQL con disco casi lleno` (> 85 %).

1. **Consultas lentas:** Consola → Cloud SQL → `volt-<env>-pg` → Query Insights (está activado). Índices faltantes o particiones (`meter_value`, `ocpp_message_log`) sin crear: el trabajo `partitions` del worker las crea cada día; comprobar `SELECT * FROM pg_tables WHERE tablename LIKE 'meter_value_%'`.
2. **Tamaño:** `db_tier` en `envs/<env>.tfvars` (por ejemplo `db-custom-2-8192`) y `terraform apply` (reinicio breve fuera del horario de carga; ventana de mantenimiento: domingo 08:00 UTC).
3. **Disco:** crece solo (`disk_autoresize`); si crece rápido, revisar retención de `ops.ocpp_message_log` y exportar telemetría a BigQuery (ya se publica por Pub/Sub).
4. **Conexiones:** `max_connections = 200`; api (5 por instancia), worker (3), gateway (5 por pod), sintético (2). Con muchas instancias de API considerar un pool gestionado.
5. **Acceso puntual:** sin IP pública. Desde Cloud Shell: `gcloud sql connect` no aplica; usar Cloud SQL Studio en la consola o un túnel IAP a una VM efímera (SEG §6.3).
6. **Failover/backups:** HA regional solo en prod con `db_ha = true`. Restauración: RB-16.
