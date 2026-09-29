# Borde (ARQ §3.4, ADR 0019 y 0023): dos balanceadores de aplicación globales por ambiente.
#  - web: creado aquí; api/admin/app → Cloud Run por NEG serverless; TLS 1.2+ perfil MODERN.
#  - ocpp: lo crea el Gateway API de GKE a partir de los manifiestos; aquí viven su IP, su
#    certificado (Certificate Manager), su política SSL y su política de Cloud Armor.
# Certificados gestionados por Google con autorización por balanceador: basta el registro A.
resource "google_compute_global_address" "web" {
  name       = "${local.name}-web-ip"
  depends_on = [google_project_service.apis]
}

resource "google_compute_global_address" "ocpp" {
  name       = "${local.name}-ocpp-ip"
  depends_on = [google_project_service.apis]
}

resource "google_compute_ssl_policy" "web" {
  name            = "${local.name}-web"
  profile         = var.web_ssl_profile
  min_tls_version = "TLS_1_2"
}

resource "google_compute_ssl_policy" "ocpp" {
  name            = "${local.name}-ocpp"
  profile         = var.ocpp_ssl_profile
  min_tls_version = "TLS_1_2"
}

resource "google_certificate_manager_certificate" "web" {
  name   = "${local.name}-web"
  scope  = "DEFAULT"
  labels = local.labels
  managed {
    domains = [local.hosts.api, local.hosts.admin, local.hosts.app]
  }
}

resource "google_certificate_manager_certificate_map" "web" {
  name   = "${local.name}-web"
  labels = local.labels
}

resource "google_certificate_manager_certificate_map_entry" "web" {
  name         = "${local.name}-web-primary"
  map          = google_certificate_manager_certificate_map.web.name
  certificates = [google_certificate_manager_certificate.web.id]
  matcher      = "PRIMARY"
}

resource "google_certificate_manager_certificate" "ocpp" {
  name   = "${local.name}-ocpp"
  scope  = "DEFAULT"
  labels = local.labels
  managed {
    domains = [local.hosts.ocpp]
  }
}

resource "google_certificate_manager_certificate_map" "ocpp" {
  name   = "${local.name}-ocpp"
  labels = local.labels
}

resource "google_certificate_manager_certificate_map_entry" "ocpp" {
  name         = "${local.name}-ocpp-primary"
  map          = google_certificate_manager_certificate_map.ocpp.name
  certificates = [google_certificate_manager_certificate.ocpp.id]
  matcher      = "PRIMARY"
}

# --- Backends de Cloud Run ---
locals {
  web_services = {
    api        = google_cloud_run_v2_service.api.name
    backoffice = google_cloud_run_v2_service.backoffice.name
    app-web    = google_cloud_run_v2_service.app_web.name
  }
}

resource "google_compute_region_network_endpoint_group" "run" {
  for_each              = local.web_services
  name                  = "${local.name}-${each.key}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = each.value
  }
}

resource "google_compute_backend_service" "run" {
  for_each              = local.web_services
  name                  = "${local.name}-${each.key}"
  protocol              = "HTTPS"
  port_name             = "http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  # SSE de la API: conexiones de minutos; el resto son peticiones cortas.
  timeout_sec     = each.key == "api" ? 3600 : 60
  security_policy = var.cloud_armor_enabled ? google_compute_security_policy.web[0].id : null

  backend {
    group = google_compute_region_network_endpoint_group.run[each.key].id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }

  dynamic "iap" {
    for_each = each.key == "backoffice" && var.backoffice_iap_enabled ? [1] : []
    content {
      enabled = true
    }
  }
}

resource "google_iap_web_backend_service_iam_member" "backoffice" {
  count               = var.backoffice_iap_enabled ? 1 : 0
  web_backend_service = google_compute_backend_service.run["backoffice"].name
  role                = "roles/iap.httpsResourceAccessor"
  member              = "domain:${var.iap_access_domain}"
}

resource "google_compute_url_map" "web" {
  name            = "${local.name}-web"
  default_service = google_compute_backend_service.run["api"].id

  host_rule {
    hosts        = [local.hosts.api]
    path_matcher = "api"
  }
  host_rule {
    hosts        = [local.hosts.admin]
    path_matcher = "admin"
  }
  host_rule {
    hosts        = [local.hosts.app]
    path_matcher = "app"
  }

  path_matcher {
    name            = "api"
    default_service = google_compute_backend_service.run["api"].id
  }
  path_matcher {
    name            = "admin"
    default_service = google_compute_backend_service.run["backoffice"].id
  }
  path_matcher {
    name            = "app"
    default_service = google_compute_backend_service.run["app-web"].id
  }
}

resource "google_compute_target_https_proxy" "web" {
  name            = "${local.name}-web"
  url_map         = google_compute_url_map.web.id
  certificate_map = "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.web.id}"
  ssl_policy      = google_compute_ssl_policy.web.id
}

resource "google_compute_global_forwarding_rule" "web_https" {
  name                  = "${local.name}-web-https"
  target                = google_compute_target_https_proxy.web.id
  port_range            = "443"
  ip_address            = google_compute_global_address.web.address
  load_balancing_scheme = "EXTERNAL_MANAGED"
  labels                = local.labels
}

# HTTP → HTTPS.
resource "google_compute_url_map" "web_redirect" {
  name = "${local.name}-web-redirect"
  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }
}

resource "google_compute_target_http_proxy" "web_redirect" {
  name    = "${local.name}-web-redirect"
  url_map = google_compute_url_map.web_redirect.id
}

resource "google_compute_global_forwarding_rule" "web_http" {
  name                  = "${local.name}-web-http"
  target                = google_compute_target_http_proxy.web_redirect.id
  port_range            = "80"
  ip_address            = google_compute_global_address.web.address
  load_balancing_scheme = "EXTERNAL_MANAGED"
  labels                = local.labels
}
