# Infraestructura en Google Cloud (Terraform)

Estructura prevista (ARQ §3 y §6.1). Se implementa en la iteración 8, cuando existan los proyectos `volt-dev`, `volt-staging` y `volt-prod` (tarea del dueño del proyecto).

```
infra/terraform/
  modules/
    network/        VPC, subredes, Cloud NAT, Private Service Connect para Cloud SQL
    edge/           External Application Load Balancer, Cloud Armor, Certificate Manager, política SSL propia
    gke/            GKE Autopilot para ocpp-gateway (Gateway API, backend timeout, PDB)
    cloudrun/       api, worker, backoffice
    data/           Cloud SQL PostgreSQL (HA, IP privada, PITR), Memorystore Redis, BigQuery
    messaging/      Pub/Sub (topic domain-events, suscripciones, dead letter, BigQuery subscription)
    security/       Secret Manager, Cloud KMS (CMEK), IAM, Workload Identity Federation, Binary Authorization
    observability/  Managed Prometheus, dashboards, alertas, SLOs, exportación de audit logs
  envs/
    dev/            un solo entorno de desarrollo compartido
    staging/        réplica reducida de producción; cargador real de laboratorio
    prod/
```

Convenciones: estado remoto en un bucket de GCS con bloqueo, `terraform plan` en cada pull request y `apply` solo desde CD con Workload Identity Federation; sin claves de cuentas de servicio; variables sensibles nunca en `*.tfvars` versionados (ver `.gitignore`). Región principal `us-east1` (ADR 0005).
