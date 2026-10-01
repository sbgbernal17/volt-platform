# VPC propia, subredes privadas con acceso privado a Google, rango para Private Service Access
# (Cloud SQL y Memorystore) y reglas mínimas. Sin Cloud NAT: el gateway en GKE solo habla con la
# base, Redis y APIs de Google (acceso privado); los servicios de Cloud Run salen a internet por
# su egreso público (solo los rangos privados van por la VPC).
resource "google_compute_network" "vpc" {
  name                    = local.name
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "main" {
  name                     = "${local.name}-main"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = local.cidr.main
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = local.cidr.pods
  }
  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = local.cidr.services
  }

  log_config {
    aggregation_interval = "INTERVAL_5_MIN"
    flow_sampling        = 0.1
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

# Subred del egreso directo de Cloud Run (api, worker, migraciones, cargador sintético).
resource "google_compute_subnetwork" "serverless" {
  name                     = "${local.name}-serverless"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = local.cidr.serverless
  private_ip_google_access = true
}

resource "google_compute_global_address" "private_services" {
  name          = "${local.name}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
  deletion_policy         = "ABANDON"
}

# api/worker (Cloud Run) → API interna del gateway (9222) y salud (9221) en los pods.
resource "google_compute_firewall" "internal_to_gateway" {
  name    = "${local.name}-internal-to-gateway"
  network = google_compute_network.vpc.name
  allow {
    protocol = "tcp"
    ports    = ["9220", "9221", "9222"]
  }
  source_ranges = [local.cidr.serverless, local.cidr.main, local.cidr.pods]
  direction     = "INGRESS"
}

# Comprobaciones de salud de los balanceadores de Google hacia los pods del gateway.
resource "google_compute_firewall" "health_checks_to_gateway" {
  name    = "${local.name}-health-checks"
  network = google_compute_network.vpc.name
  allow {
    protocol = "tcp"
    ports    = ["9220", "9221"]
  }
  source_ranges = ["130.211.0.0/22", "35.191.0.0/16"]
  direction     = "INGRESS"
}

# Salida a internet con IP fija (opcional, `static_egress_ip`): Cloud Run envía todo su tráfico por la
# VPC y Cloud NAT lo saca por una dirección reservada, estable por ambiente. Sin esto, Cloud Run sale
# con direcciones de Google que cambian y algunos proveedores (Wompi, Brevo) las rechazan o filtran.
locals {
  run_egress = var.static_egress_ip ? "ALL_TRAFFIC" : "PRIVATE_RANGES_ONLY"
}

resource "google_compute_address" "egress" {
  count        = var.static_egress_ip ? 1 : 0
  name         = "${local.name}-egress-ip"
  region       = var.region
  address_type = "EXTERNAL"
  network_tier = "PREMIUM"
  labels       = local.labels
}

resource "google_compute_router" "egress" {
  count   = var.static_egress_ip ? 1 : 0
  name    = "${local.name}-egress"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_router_nat" "egress" {
  count                              = var.static_egress_ip ? 1 : 0
  name                               = "${local.name}-egress"
  router                             = google_compute_router.egress[0].name
  region                             = var.region
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.egress[0].self_link]
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.serverless.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
