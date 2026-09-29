# Memorystore for Redis: directorio de conexiones, desalojo entre pods y canal de eventos (ADR 0013).
# AUTH activado; sin TLS en tránsito (solo accesible dentro de la VPC), deuda registrada en el ADR 0023.
resource "google_redis_instance" "main" {
  name               = "${local.name}-redis"
  tier               = var.redis_tier
  memory_size_gb     = var.redis_memory_gb
  region             = var.region
  redis_version      = "REDIS_7_2"
  authorized_network = google_compute_network.vpc.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"
  auth_enabled       = true
  labels             = local.labels
  depends_on         = [google_service_networking_connection.private_services]

  persistence_config {
    persistence_mode = "DISABLED"
  }
}

locals {
  redis_url = "redis://:${google_redis_instance.main.auth_string}@${google_redis_instance.main.host}:${google_redis_instance.main.port}"
}
