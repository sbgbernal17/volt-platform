# Registro de imágenes OCI (api, worker, ocpp-gateway, backoffice, app-web, synthetic-charger) con
# escaneo de vulnerabilidades (Artifact Analysis) y limpieza de versiones antiguas.
resource "google_artifact_registry_repository" "volt" {
  location      = var.region
  repository_id = "volt"
  format        = "DOCKER"
  description   = "Imágenes de la plataforma Volt (${var.env})"
  labels        = local.labels
  depends_on    = [google_project_service.apis]

  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 30
    }
  }
  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "2592000s"
    }
  }
}
