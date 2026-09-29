# Una cuenta de servicio por carga con roles mínimos; sin claves (SEG §6.3).
locals {
  service_accounts = {
    api       = "API pública y de administración (Cloud Run)"
    worker    = "Trabajos en segundo plano (Cloud Run)"
    web       = "Back-office y app web estáticos (Cloud Run)"
    synthetic = "Cargador sintético (Cloud Run)"
    migrate   = "Migraciones de base de datos (Cloud Run Job)"
    gateway   = "Gateway OCPP (GKE, Workload Identity)"
    gke-nodes = "Nodos de GKE Autopilot"
  }
}

resource "google_service_account" "svc" {
  for_each     = local.service_accounts
  account_id   = "volt-${each.key}"
  display_name = each.value
  depends_on   = [google_project_service.apis]
}

# Nodos: solo escritura de logs y métricas y lectura de imágenes.
resource "google_project_iam_member" "gke_nodes" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/monitoring.viewer",
    "roles/stackdriver.resourceMetadata.writer",
    "roles/autoscaling.metricsWriter",
    "roles/artifactregistry.reader",
  ])
  project = var.project_id
  role    = each.value
  member  = google_service_account.svc["gke-nodes"].member
}

resource "google_project_iam_member" "trace_agents" {
  for_each = toset(["api", "worker", "gateway", "synthetic"])
  project  = var.project_id
  role     = "roles/cloudtrace.agent"
  member   = google_service_account.svc[each.key].member
}

resource "google_pubsub_topic_iam_member" "worker_publisher" {
  topic      = google_pubsub_topic.domain_events.name
  role       = "roles/pubsub.publisher"
  member     = google_service_account.svc["worker"].member
  depends_on = [time_sleep.deployer_roles]
}

# El pod del gateway (KSA volt/ocpp-gateway) actúa como su cuenta de servicio de Google. El pool
# de identidades <proyecto>.svc.id.goog existe solo desde que hay un clúster.
resource "google_service_account_iam_member" "gateway_workload_identity" {
  service_account_id = google_service_account.svc["gateway"].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${local.gke_namespace}/${local.gke_ksa}]"
  depends_on         = [google_container_cluster.gateway]
}

# Roles que el despliegue desde GitHub Actions necesita además de los de la guía de configuración
# (Cloud Run, GKE, Artifact Registry, claves de API, IAP, peering de servicios, Pub/Sub, logs).
locals {
  deployer_roles = [
    "roles/run.admin",
    "roles/container.developer",
    "roles/artifactregistry.writer",
    "roles/iam.serviceAccountUser",
    "roles/servicenetworking.networksAdmin",
    "roles/serviceusage.apiKeysAdmin",
    "roles/iap.admin",
    "roles/monitoring.admin",
    "roles/logging.admin",
    "roles/certificatemanager.editor",
    "roles/pubsub.admin",
    # Iteración 9: plantillas de correo de Identity Platform aplicadas desde el flujo *Correos de identidad*.
    "roles/identityplatform.admin",
  ]
}

resource "google_project_iam_member" "deployer" {
  for_each = toset(local.deployer_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${var.deployer_service_account}"
}

# Un rol recién concedido tarda hasta un par de minutos en surtir efecto: los recursos que lo
# necesitan en el mismo apply (IAM de Pub/Sub, bucket de logs) esperan aquí. Se repite si cambia la
# lista de roles.
resource "time_sleep" "deployer_roles" {
  depends_on      = [google_project_iam_member.deployer]
  create_duration = "120s"
  triggers = {
    roles = join(",", local.deployer_roles)
  }
}
