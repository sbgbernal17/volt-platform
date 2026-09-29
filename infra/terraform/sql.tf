# Cloud SQL para PostgreSQL 16 (edición Enterprise), IP privada, TLS obligatorio, backups diarios y
# recuperación a un punto en el tiempo (7 días de WAL). HA regional solo en prod (ARQ §3.5).
resource "google_sql_database_instance" "main" {
  name                = "${local.name}-pg"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = local.is_prod
  depends_on          = [google_service_networking_connection.private_services]

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    availability_type = var.db_ha ? "REGIONAL" : "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = var.db_disk_gb
    disk_autoresize   = true
    user_labels       = local.labels

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.vpc.id
      ssl_mode                                      = "ENCRYPTED_ONLY"
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "06:00"
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 14
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day          = 7
      hour         = 8
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled  = true
      record_application_tags = true
    }

    database_flags {
      name  = "max_connections"
      value = "200"
    }
  }
}

resource "google_sql_database" "volt" {
  name     = "volt"
  instance = google_sql_database_instance.main.name
}

resource "random_password" "db_app" {
  length  = 32
  special = false
}

# Un usuario de aplicación (migraciones y servicios); usuarios por servicio con privilegios mínimos
# quedan como deuda registrada en el ADR 0023.
resource "google_sql_user" "app" {
  name     = "volt"
  instance = google_sql_database_instance.main.name
  password = random_password.db_app.result
}

locals {
  database_url = "postgres://${google_sql_user.app.name}:${random_password.db_app.result}@${google_sql_database_instance.main.private_ip_address}:5432/${google_sql_database.volt.name}"
  db_server_ca = google_sql_database_instance.main.server_ca_cert[0].cert
}
