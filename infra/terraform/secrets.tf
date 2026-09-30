# Secretos en Secret Manager: los generados aquí (contraseña de la base, URL de Redis, token interno
# del gateway, token estático de administración fuera de prod) y los que llena el dueño o el flujo de
# despliegue (Wompi, Expo, proveedor de SMS). Las apps los reciben como variables de entorno (Cloud Run)
# o archivos (GKE).
locals {
  generated_secrets = merge(
    {
      "database-url"                = local.database_url
      "db-server-ca"                = local.db_server_ca
      "redis-url"                   = local.redis_url
      "ocpp-gateway-internal-token" = random_password.gateway_internal_token.result
    },
    local.api_admin_token_enabled ? { "api-admin-token" = random_password.api_admin_token.result } : {},
  )
  external_secrets = [
    "wompi-public-key",
    "wompi-private-key",
    "wompi-integrity-secret",
    "wompi-events-secret",
    "expo-access-token",
    "sms-provider-api-key",
    "email-provider-api-key",
  ]
  # Qué cuenta de servicio puede leer cada secreto.
  secret_readers = {
    "database-url"                = ["api", "worker", "gateway", "synthetic", "migrate"]
    "db-server-ca"                = ["api", "worker", "gateway", "synthetic", "migrate"]
    "redis-url"                   = ["api", "worker", "gateway"]
    "ocpp-gateway-internal-token" = ["api", "worker", "gateway"]
    "api-admin-token"             = ["api", "synthetic"]
    "wompi-public-key"            = ["api", "worker"]
    "wompi-private-key"           = ["api", "worker"]
    "wompi-integrity-secret"      = ["api", "worker"]
    "wompi-events-secret"         = ["api", "worker"]
    "expo-access-token"           = ["worker"]
    "sms-provider-api-key"        = ["api"]
    "email-provider-api-key"      = ["api"]
  }
  all_secret_ids = concat(keys(local.generated_secrets), local.external_secrets)
  secret_bindings = flatten([
    for secret in local.all_secret_ids : [
      for sa in lookup(local.secret_readers, secret, []) : { secret = secret, sa = sa }
    ]
  ])
}

resource "random_password" "gateway_internal_token" {
  length  = 48
  special = false
}

resource "random_password" "api_admin_token" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "s" {
  for_each  = toset(local.all_secret_ids)
  secret_id = each.value
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "generated" {
  for_each    = local.generated_secrets
  secret      = google_secret_manager_secret.s[each.key].id
  secret_data = each.value
}

# Versión inicial de los secretos externos para que los servicios arranquen; las versiones reales
# las añade el flujo de despliegue (staging, llaves de prueba) o el dueño en la consola (prod).
resource "google_secret_manager_secret_version" "placeholder" {
  for_each    = var.create_placeholder_secret_versions ? toset(local.external_secrets) : toset([])
  secret      = google_secret_manager_secret.s[each.key].id
  secret_data = "unset"
  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "readers" {
  for_each = {
    for b in local.secret_bindings : "${b.secret}/${b.sa}" => b
  }
  secret_id = google_secret_manager_secret.s[each.value.secret].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.svc[each.value.sa].member
}
