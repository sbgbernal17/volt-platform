# GKE Autopilot regional y privado para el gateway OCPP (ADR 0007): Gateway API para el balanceador
# de los cargadores, complemento de Secret Manager (secretos como archivos), Workload Identity y
# Managed Service for Prometheus. El control plane se alcanza por su endpoint DNS (IAM), sin IP pública.
resource "google_container_cluster" "gateway" {
  name                = local.name
  location            = var.region
  enable_autopilot    = true
  network             = google_compute_network.vpc.id
  subnetwork          = google_compute_subnetwork.main.id
  deletion_protection = local.is_prod
  resource_labels     = local.labels
  depends_on          = [google_project_service.apis]

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  release_channel {
    channel = "REGULAR"
  }

  private_cluster_config {
    enable_private_nodes = true
  }

  control_plane_endpoints_config {
    dns_endpoint_config {
      allow_external_traffic = true
    }
    ip_endpoints_config {
      enabled = false
    }
  }

  gateway_api_config {
    channel = "CHANNEL_STANDARD"
  }

  secret_manager_config {
    enabled = true
  }

  cluster_autoscaling {
    auto_provisioning_defaults {
      service_account = google_service_account.svc["gke-nodes"].email
      oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
    }
  }

  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS"]
    managed_prometheus {
      enabled = true
    }
  }

  logging_config {
    enable_components = ["SYSTEM_COMPONENTS", "WORKLOADS"]
  }

  maintenance_policy {
    recurring_window {
      start_time = "2026-01-04T06:00:00Z"
      end_time   = "2026-01-04T10:00:00Z"
      recurrence = "FREQ=WEEKLY;BYDAY=SU"
    }
  }
}
