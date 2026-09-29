locals {
  is_prod = var.env == "prod"
  suffix  = local.is_prod ? "" : "-${var.env}"
  name    = "volt-${var.env}"

  hosts = {
    ocpp  = "ocpp${local.suffix}.${var.domain}"
    api   = "api${local.suffix}.${var.domain}"
    admin = "admin${local.suffix}.${var.domain}"
    app   = "app${local.suffix}.${var.domain}"
  }

  labels = {
    app        = "volt"
    env        = var.env
    managed-by = "terraform"
  }

  project_number = data.google_project.current.number
  registry       = "${var.region}-docker.pkg.dev/${var.project_id}/volt"

  # Rangos de red (RFC 1918) por ambiente: no se solapan entre sí por si algún día se conectan.
  cidr_index = { dev = 0, staging = 1, prod = 2 }[var.env]
  cidr = {
    main       = "10.${10 + local.cidr_index}.0.0/20"
    serverless = "10.${10 + local.cidr_index}.32.0/24"
    pods       = "10.${20 + local.cidr_index}.0.0/16"
    services   = "10.${30 + local.cidr_index}.0.0/20"
  }

  # Nombres que los manifiestos de GKE necesitan (se renderizan en el flujo de despliegue).
  gke_namespace = "volt"
  gke_ksa       = "ocpp-gateway"

  api_admin_token_enabled = !local.is_prod
}
