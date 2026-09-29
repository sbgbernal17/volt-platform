output "hosts" {
  description = "Nombres públicos del ambiente."
  value       = local.hosts
}

output "web_ip" {
  value = google_compute_global_address.web.address
}

output "ocpp_ip" {
  value = google_compute_global_address.ocpp.address
}

output "dns_records" {
  description = "Registros que el dueño añade en Netlify DNS (tipo A, TTL 300)."
  value = [
    { host = local.hosts.ocpp, type = "A", value = google_compute_global_address.ocpp.address },
    { host = local.hosts.api, type = "A", value = google_compute_global_address.web.address },
    { host = local.hosts.admin, type = "A", value = google_compute_global_address.web.address },
    { host = local.hosts.app, type = "A", value = google_compute_global_address.web.address },
  ]
}

output "registry" {
  description = "Prefijo de las imágenes en Artifact Registry."
  value       = local.registry
}

output "cluster_name" {
  value = google_container_cluster.gateway.name
}

output "cluster_location" {
  value = google_container_cluster.gateway.location
}

output "run_services" {
  description = "URL directa (*.run.app) de cada servicio de Cloud Run."
  value = merge(
    {
      api        = google_cloud_run_v2_service.api.uri
      worker     = google_cloud_run_v2_service.worker.uri
      backoffice = google_cloud_run_v2_service.backoffice.uri
      app_web    = google_cloud_run_v2_service.app_web.uri
    },
    var.synthetic_enabled ? { synthetic = google_cloud_run_v2_service.synthetic[0].uri } : {},
  )
}

output "identity_platform_api_key" {
  description = "Clave de navegador de Identity Platform (pública, restringida por origen)."
  value       = google_apikeys_key.identity_platform.key_string
  sensitive   = true
}

output "identity_platform_auth_domain" {
  value = local.identity_platform.auth_domain
}

# Valores que los manifiestos de GKE necesitan (se renderizan en el flujo de despliegue).
output "gke" {
  value = {
    namespace            = local.gke_namespace
    service_account      = local.gke_ksa
    gsa_email            = google_service_account.svc["gateway"].email
    ocpp_address_name    = google_compute_global_address.ocpp.name
    ocpp_certificate_map = google_certificate_manager_certificate_map.ocpp.name
    ocpp_ssl_policy      = google_compute_ssl_policy.ocpp.name
    ocpp_security_policy = var.cloud_armor_enabled ? google_compute_security_policy.ocpp[0].name : ""
    ocpp_host            = local.hosts.ocpp
    project_id           = var.project_id
    # Tamaño del despliegue por ambiente (manifiestos de infra/k8s/ocpp-gateway).
    replicas     = tostring(var.gateway_replicas)
    max_replicas = tostring(var.gateway_max_replicas)
    cpu          = var.gateway_cpu
    memory       = var.gateway_memory
  }
}

output "project_number" {
  value = local.project_number
}
