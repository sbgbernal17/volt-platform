# Cloud Run v2: api, worker, back-office, app web y cargador sintético; migraciones como Job.
# Terraform fija la configuración (cuenta, red, variables, secretos); la imagen la actualiza el
# flujo de despliegue y aquí se ignora para no pisarla.
locals {
  identity_platform = {
    project_id  = var.project_id
    auth_domain = "${var.project_id}.firebaseapp.com"
  }
  app_terms_url   = "https://${var.domain}/terminos-y-condiciones"
  app_privacy_url = "https://${var.domain}/politica-de-datos"
  wompi_secret_env = {
    WOMPI_PUBLIC_KEY       = "wompi-public-key"
    WOMPI_PRIVATE_KEY      = "wompi-private-key"
    WOMPI_INTEGRITY_SECRET = "wompi-integrity-secret"
    WOMPI_EVENTS_SECRET    = "wompi-events-secret"
  }
  run_common_env = {
    NODE_ENV  = "production"
    LOG_LEVEL = "info"
    VOLT_ENV  = var.env
  }
}

resource "google_cloud_run_v2_service" "api" {
  name                = "api"
  location            = var.region
  ingress             = var.api_public_ingress ? "INGRESS_TRAFFIC_ALL" : "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = false
  labels              = local.labels
  depends_on          = [google_secret_manager_secret_version.generated, google_secret_manager_secret_iam_member.readers]

  template {
    service_account = google_service_account.svc["api"].email
    labels          = local.labels
    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }
    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.serverless.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
    max_instance_request_concurrency = 80
    timeout                          = "3600s"

    containers {
      image = var.placeholder_image
      ports {
        container_port = 8080
      }
      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = merge(local.run_common_env, {
          API_HOST                      = "0.0.0.0"
          API_PORT                      = "8080"
          IDENTITY_PLATFORM_PROJECT_ID  = local.identity_platform.project_id
          IDENTITY_PLATFORM_AUTH_DOMAIN = local.identity_platform.auth_domain
          IDENTITY_PLATFORM_API_KEY     = google_apikeys_key.identity_platform.key_string
          API_STAFF_BOOTSTRAP_EMAIL     = var.staff_bootstrap_email
          APP_TERMS_URL                 = local.app_terms_url
          APP_PRIVACY_URL               = local.app_privacy_url
          PAYMENTS_PROVIDER             = var.payments_provider
          WOMPI_ENVIRONMENT             = var.wompi_environment
          PAYMENTS_REDIRECT_URL         = "https://${local.hosts.app}/pagos/retorno"
          API_CORS_ORIGINS              = "https://${local.hosts.admin},https://${local.hosts.app}"
          GOOGLE_MAPS_BROWSER_KEY       = google_apikeys_key.maps_browser.key_string
          SMS_PROVIDER                  = var.sms_provider
          SMS_SENDER                    = var.sms_sender
          EMAIL_PROVIDER                = var.email_provider
          EMAIL_FROM                    = var.email_from
          APP_WEB_URL                   = "https://${local.hosts.app}"
          API_PUBLIC_URL                = "https://${local.hosts.api}"
          IDENTITY_LINKS_SOURCE         = "metadata"
          },
          var.twilio_account_sid != "" ? { TWILIO_ACCOUNT_SID = var.twilio_account_sid } : {},
          var.google_maps_map_id != "" ? { GOOGLE_MAPS_MAP_ID = var.google_maps_map_id } : {},
        )
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = merge(
          {
            DATABASE_URL                = "database-url"
            DATABASE_SSL_CA             = "db-server-ca"
            REDIS_URL                   = "redis-url"
            OCPP_GATEWAY_INTERNAL_TOKEN = "ocpp-gateway-internal-token"
          },
          var.payments_provider == "wompi" ? local.wompi_secret_env : {},
          local.api_admin_token_enabled ? { API_ADMIN_TOKEN = "api-admin-token" } : {},
          contains(["twilio", "brevo"], var.sms_provider) ? { SMS_PROVIDER_API_KEY = "sms-provider-api-key" } : {},
          contains(["resend", "brevo"], var.email_provider) ? { EMAIL_PROVIDER_API_KEY = "email-provider-api-key" } : {},
        )
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}

resource "google_cloud_run_v2_service" "worker" {
  name                = "worker"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = false
  labels              = local.labels
  depends_on          = [google_secret_manager_secret_version.generated, google_secret_manager_secret_iam_member.readers]

  template {
    service_account = google_service_account.svc["worker"].email
    labels          = local.labels
    scaling {
      min_instance_count = var.worker_min_instances
      max_instance_count = 1
    }
    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.serverless.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
    max_instance_request_concurrency = 10
    timeout                          = "300s"

    containers {
      image = var.placeholder_image
      ports {
        container_port = 8080
      }
      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        cpu_idle          = false
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = merge(local.run_common_env, {
          WORKER_HEALTH_PORT  = "8080"
          PAYMENTS_PROVIDER   = var.payments_provider
          WOMPI_ENVIRONMENT   = var.wompi_environment
          PUSH_PROVIDER       = var.push_provider
          OUTBOX_PUBSUB_TOPIC = google_pubsub_topic.domain_events.id
        })
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = merge(
          {
            DATABASE_URL                = "database-url"
            DATABASE_SSL_CA             = "db-server-ca"
            REDIS_URL                   = "redis-url"
            OCPP_GATEWAY_INTERNAL_TOKEN = "ocpp-gateway-internal-token"
            EXPO_ACCESS_TOKEN           = "expo-access-token"
          },
          var.payments_provider == "wompi" ? local.wompi_secret_env : {},
        )
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}

resource "google_cloud_run_v2_service" "backoffice" {
  name                = "backoffice"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = false
  labels              = local.labels

  template {
    service_account = google_service_account.svc["web"].email
    labels          = local.labels
    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
    containers {
      image = var.placeholder_image
      ports {
        container_port = 8080
      }
      resources {
        limits   = { cpu = "1", memory = "256Mi" }
        cpu_idle = true
      }
      env {
        name  = "API_BASE_URL"
        value = "https://${local.hosts.api}"
      }
      env {
        name  = "GOOGLE_MAPS_BROWSER_KEY"
        value = google_apikeys_key.maps_browser.key_string
      }
      env {
        name  = "GOOGLE_MAPS_MAP_ID"
        value = var.google_maps_map_id
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}

resource "google_cloud_run_v2_service" "app_web" {
  name                = "app-web"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = false
  labels              = local.labels

  template {
    service_account = google_service_account.svc["web"].email
    labels          = local.labels
    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
    containers {
      image = var.placeholder_image
      ports {
        container_port = 8080
      }
      resources {
        limits   = { cpu = "1", memory = "256Mi" }
        cpu_idle = true
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}

resource "google_cloud_run_v2_service" "synthetic" {
  count               = var.synthetic_enabled ? 1 : 0
  name                = "synthetic-charger"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = false
  labels              = local.labels
  depends_on          = [google_secret_manager_secret_version.generated, google_secret_manager_secret_iam_member.readers]

  template {
    service_account = google_service_account.svc["synthetic"].email
    labels          = local.labels
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }
    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.serverless.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
    # Solo atiende /healthz.
    max_instance_request_concurrency = 1
    timeout                          = "300s"

    containers {
      image = var.placeholder_image
      ports {
        container_port = 8080
      }
      resources {
        # El proceso vive todo el mes conectado por WebSocket: CPU siempre asignada, y Cloud Run
        # no admite menos de 1 vCPU en ese modo (~45 USD/mes por ambiente).
        limits            = { cpu = "1", memory = "512Mi" }
        cpu_idle          = false
        startup_cpu_boost = false
      }

      dynamic "env" {
        for_each = merge(local.run_common_env, {
          SYNTHETIC_HEALTH_PORT   = "8080"
          SYNTHETIC_OCPP_URL      = "wss://${local.hosts.ocpp}/ocpp"
          SYNTHETIC_CHARGE_BOX_ID = "VOLT-SYNTH-${upper(var.env)}"
          SYNTHETIC_API_URL       = "https://${local.hosts.api}"
          SYNTHETIC_CYCLE_MINUTES = "5"
          # Iteración 9: estación de pruebas visible en la app (dev y staging) con tarifa base.
          SYNTHETIC_VISIBLE_IN_APP = var.synthetic_visible_in_app ? "true" : "false"
          }, local.api_admin_token_enabled ? {
          # Fuera de prod: una sesión de prueba por hora por la API de administración (carga sintética).
          SYNTHETIC_SESSION_EVERY_CYCLES = "12"
          SYNTHETIC_SESSION_SECONDS      = "60"
        } : {})
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = merge(
          {
            DATABASE_URL    = "database-url"
            DATABASE_SSL_CA = "db-server-ca"
          },
          local.api_admin_token_enabled ? { SYNTHETIC_ADMIN_TOKEN = "api-admin-token" } : {},
        )
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}

resource "google_cloud_run_v2_job" "migrate" {
  name                = "migrate"
  location            = var.region
  deletion_protection = false
  labels              = local.labels
  depends_on          = [google_secret_manager_secret_version.generated, google_secret_manager_secret_iam_member.readers]

  template {
    labels = local.labels
    template {
      service_account = google_service_account.svc["migrate"].email
      max_retries     = 0
      timeout         = "900s"
      vpc_access {
        network_interfaces {
          network    = google_compute_network.vpc.id
          subnetwork = google_compute_subnetwork.serverless.id
        }
        egress = "PRIVATE_RANGES_ONLY"
      }
      containers {
        image   = var.placeholder_image
        command = ["node", "migrate.mjs"]
        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        dynamic "env" {
          for_each = { DATABASE_URL = "database-url", DATABASE_SSL_CA = "db-server-ca" }
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.s[env.value].secret_id
                version = "latest"
              }
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }
}

# Los servicios públicos reciben tráfico anónimo (siempre a través del balanceador salvo en dev).
# La política de organización iam.allowedPolicyMemberDomains (activa por defecto en organizaciones
# nuevas) rechaza allUsers hasta que el dueño la exceptúe en el proyecto; mientras tanto el
# balanceador responde 403 y la variable queda en false (ADR 0023).
resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = var.allow_unauthenticated_invoker ? {
    api        = google_cloud_run_v2_service.api.name
    backoffice = google_cloud_run_v2_service.backoffice.name
    app_web    = google_cloud_run_v2_service.app_web.name
  } : {}
  location = var.region
  name     = each.value
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Clave de navegador de Maps JavaScript API (iteración 9) para el mapa del back-office y de la app
# web: pública por diseño, restringida a nuestros orígenes y solo a esa API. Se inyecta en el
# back-office por config.js (GOOGLE_MAPS_BROWSER_KEY, GOOGLE_MAPS_MAP_ID) y en la app por GET /v1/config.
resource "google_apikeys_key" "maps_browser" {
  name         = "maps-browser"
  display_name = "Google Maps (navegador, ${var.env})"
  depends_on   = [google_project_service.apis]

  restrictions {
    api_targets {
      service = "maps-backend.googleapis.com"
    }
    browser_key_restrictions {
      allowed_referrers = [
        "https://${local.hosts.admin}/*",
        "https://${local.hosts.app}/*",
        "http://localhost:*/*",
        "http://localhost/*",
      ]
    }
  }
}

# Clave de navegador de Identity Platform restringida a nuestros orígenes (back-office y app web).
resource "google_apikeys_key" "identity_platform" {
  name         = "identity-platform-browser"
  display_name = "Identity Platform (navegador, ${var.env})"
  depends_on   = [google_project_service.apis]

  restrictions {
    api_targets {
      service = "identitytoolkit.googleapis.com"
    }
    api_targets {
      service = "securetoken.googleapis.com"
    }
    browser_key_restrictions {
      allowed_referrers = [
        "https://${local.hosts.admin}/*",
        "https://${local.hosts.app}/*",
        "http://localhost:*/*",
        "http://localhost/*",
      ]
    }
  }
}
