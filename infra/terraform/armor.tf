# Cloud Armor (SEG §6.2): WAF con reglas preconfiguradas OWASP a sensibilidad baja y límites por IP
# en la API; en el balanceador OCPP solo un umbral alto por IP (varios cargadores salen por el mismo
# NAT de la operadora móvil). Solo evalúa la petición de upgrade del WebSocket (ARQ §3.1).
resource "google_compute_security_policy" "web" {
  count       = var.cloud_armor_enabled ? 1 : 0
  name        = "${local.name}-web"
  description = "API, back-office y app web (${var.env})"

  dynamic "rule" {
    for_each = {
      1000 = "sqli-v33-stable"
      1001 = "xss-v33-stable"
      1002 = "lfi-v33-stable"
      1003 = "rce-v33-stable"
      1004 = "scannerdetection-v33-stable"
      1005 = "protocolattack-v33-stable"
    }
    content {
      priority    = tonumber(rule.key)
      action      = "deny(403)"
      description = "OWASP ${rule.value}"
      match {
        expr {
          expression = "evaluatePreconfiguredWaf('${rule.value}', {'sensitivity': 1})"
        }
      }
    }
  }

  # Inicio de sesiones de carga: 60 por minuto y por IP.
  rule {
    priority    = 2000
    action      = "throttle"
    description = "Límite por IP en POST /v1/sessions"
    match {
      expr {
        expression = "request.path.startsWith('/v1/sessions') && request.method == 'POST'"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 60
        interval_sec = 60
      }
    }
  }

  # Resto de la API y web: 600 por minuto y por IP, con bloqueo temporal de 10 minutos.
  rule {
    priority    = 2100
    action      = "rate_based_ban"
    description = "Límite general por IP"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action   = "allow"
      exceed_action    = "deny(429)"
      enforce_on_key   = "IP"
      ban_duration_sec = 600
      rate_limit_threshold {
        count        = 600
        interval_sec = 60
      }
    }
  }

  rule {
    priority    = 2147483647
    action      = "allow"
    description = "Regla por defecto"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}

resource "google_compute_security_policy" "ocpp" {
  count       = var.cloud_armor_enabled ? 1 : 0
  name        = "${local.name}-ocpp"
  description = "Gateway OCPP (${var.env}): solo umbral de conexiones por IP"

  rule {
    priority    = 1000
    action      = "rate_based_ban"
    description = "Máximo 600 aperturas de conexión por minuto y por IP"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action   = "allow"
      exceed_action    = "deny(429)"
      enforce_on_key   = "IP"
      ban_duration_sec = 300
      rate_limit_threshold {
        count        = 600
        interval_sec = 60
      }
    }
  }

  rule {
    priority    = 2147483647
    action      = "allow"
    description = "Regla por defecto"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}
