# APIs que usa la plataforma (la guía de configuración ya habilita la mayoría; esto las deja declaradas).
resource "google_project_service" "apis" {
  for_each = toset([
    "compute.googleapis.com",
    "container.googleapis.com",
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "pubsub.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "containerscanning.googleapis.com",
    "servicenetworking.googleapis.com",
    "certificatemanager.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "cloudtrace.googleapis.com",
    "bigquery.googleapis.com",
    "apikeys.googleapis.com",
    "iap.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "identitytoolkit.googleapis.com",
    # Lectura de las políticas de organización efectivas desde los flujos de comprobación.
    "orgpolicy.googleapis.com",
    # Iteración 9: Maps JavaScript API para los mapas del back-office y de la app web.
    "maps-backend.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}
