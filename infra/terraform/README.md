# Infraestructura en Google Cloud (Terraform)

Iteración 8 (ADR 0023). Un solo módulo raíz con variables por ambiente; el mismo código crea dev, staging y prod con tamaños y protecciones distintos.

```
infra/terraform/
  versions.tf providers.tf variables.tf locals.tf apis.tf
  network.tf     VPC, subredes (principal con rangos de pods/servicios; egreso directo de Cloud Run), Private Service Access, reglas mínimas
  sql.tf         Cloud SQL PostgreSQL 16 (IP privada, TLS obligatorio, backups y PITR; HA por variable)
  redis.tf       Memorystore for Redis con AUTH
  pubsub.tf      Topic domain-events, cola de rechazados y suscripción de BigQuery (telemetry.domain_events)
  registry.tf    Artifact Registry con limpieza de versiones
  iam.tf         Cuentas de servicio por carga, Workload Identity del gateway, roles del desplegador
  secrets.tf     Secret Manager: generados (base, Redis, tokens) y externos (Wompi, Expo) con versión inicial `unset`
  gke.tf         GKE Autopilot regional privado (endpoint DNS, Gateway API, complemento de Secret Manager)
  cloudrun.tf    api, worker, backoffice, app-web, synthetic-charger y el Job migrate; clave de navegador de Identity Platform
  edge.tf        IP y certificado de los dos balanceadores, políticas SSL, balanceador web (NEG serverless), redirección HTTP→HTTPS, IAP opcional
  armor.tf       Políticas de Cloud Armor (web y ocpp) cuando cloud_armor_enabled
  monitoring.tf  Canal de correo, métricas de logs, alertas con runbook, uptime checks, SLOs, panel, auditoría de acceso a datos
  outputs.tf     IP, registros DNS, servicios, valores para los manifiestos de GKE
  envs/<env>.tfvars       tamaños y banderas por ambiente
  envs/<env>.backend.hcl  prefijo del estado (bucket <proyecto>-tfstate)
```

## Cómo se ejecuta

Desde GitHub Actions, flujo *Infraestructura (Terraform)*: `plan` corre solo en cada cambio de esta carpeta (ambiente dev); `apply` se lanza a mano eligiendo ambiente. La autenticación es Workload Identity Federation (`docs/google-cloud-setup.md`); no hay claves. Después del primer `apply` de un ambiente:

1. El resumen del flujo imprime los registros `A` (dos IP por ambiente); el dueño los añade en Netlify DNS y los certificados se emiten solos. Luego `public_dns_ready = true` en `envs/<env>.tfvars` y otro `apply` activa uptime checks y SLO del gateway.
2. El flujo *Despliegue* construye las imágenes, aplica migraciones, actualiza Cloud Run y despliega el gateway en GKE (`infra/k8s/ocpp-gateway`), que crea el balanceador de los cargadores.
3. En staging el propio despliegue copia las llaves de prueba de Wompi a Secret Manager; en prod las escribe el dueño (Consola → Secret Manager → `wompi-*` → nueva versión).
4. Cuando el dueño exceptúe la política de organización *Domain restricted sharing* (`iam.allowedPolicyMemberDomains`) en el proyecto, `allow_unauthenticated_invoker = true` en `envs/<env>.tfvars` y otro `apply` conceden `roles/run.invoker` a `allUsers` en `api`, `backoffice` y `app-web`; hasta entonces el balanceador web responde 403 (ADR 0023, decisión 16).

Si el primer `apply` de un ambiente falla con un 403 sobre un permiso que el propio `apply` acaba de conceder (propagación de IAM), basta relanzarlo: el `time_sleep` de `iam.tf` ordena los casos conocidos, pero la propagación no tiene plazo garantizado.

En local solo formato y validación (sin credenciales): `terraform init -backend=false && terraform validate`. CI lo comprueba en cada push.

## Convenciones

- Nunca `apply` desde una máquina personal ni con claves de cuentas de servicio.
- `envs/*.tfvars` no llevan secretos; los secretos viven en Secret Manager.
- Cambios de tamaño (`db_tier`, `redis_*`, `gateway_*`) y protecciones (`db_ha`, `audit_bucket_locked`, `cloud_armor_enabled`, `backoffice_iap_enabled`) se hacen por tfvars y `apply`.
- Región `us-central1` (ADR 0015).
