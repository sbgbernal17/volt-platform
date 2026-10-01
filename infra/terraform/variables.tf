variable "project_id" {
  description = "Proyecto de Google Cloud del ambiente (GCP_PROJECT_ID_<ENV> en GitHub)."
  type        = string
}

variable "env" {
  description = "Ambiente: dev, staging o prod. Decide nombres de host, tamaños y protecciones."
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env debe ser dev, staging o prod."
  }
}

variable "region" {
  description = "Región principal (ADR 0015)."
  type        = string
  default     = "us-central1"
}

variable "domain" {
  description = "Dominio raíz; los hosts son ocpp/api/admin/app con sufijo -<env> fuera de prod (ADR 0019)."
  type        = string
  default     = "supercargadores.co"
}

variable "deployer_service_account" {
  description = "Cuenta de servicio de GitHub Actions (Workload Identity Federation); recibe los roles que necesitan los despliegues."
  type        = string
}

# --- Datos ---
variable "db_tier" {
  description = "Máquina de Cloud SQL (db-custom-<vCPU>-<MiB> o compartida db-g1-small)."
  type        = string
  default     = "db-custom-1-3840"
}

variable "db_ha" {
  description = "Alta disponibilidad regional de Cloud SQL (solo prod)."
  type        = bool
  default     = false
}

variable "db_disk_gb" {
  description = "Disco inicial de Cloud SQL en GiB (crece solo)."
  type        = number
  default     = 20
}

variable "redis_tier" {
  description = "BASIC (sin réplica) o STANDARD_HA."
  type        = string
  default     = "BASIC"
}

variable "redis_memory_gb" {
  type    = number
  default = 1
}

# --- Cloud Run ---
variable "api_min_instances" {
  type    = number
  default = 0
}

variable "api_max_instances" {
  type    = number
  default = 10
}

variable "api_public_ingress" {
  description = "Permite tráfico directo a la URL *.run.app de la API (pruebas en dev); en staging y prod solo por el balanceador."
  type        = bool
  default     = false
}

variable "allow_unauthenticated_invoker" {
  description = "Concede roles/run.invoker a allUsers en api, backoffice y app-web (tráfico anónimo por el balanceador). Exige que la política de organización iam.allowedPolicyMemberDomains admita allUsers en el proyecto."
  type        = bool
  default     = false
}

variable "worker_min_instances" {
  type    = number
  default = 1
}

variable "synthetic_enabled" {
  description = "Despliega el cargador sintético (Cloud Run, siempre encendido)."
  type        = bool
  default     = true
}

variable "synthetic_visible_in_app" {
  description = "Publica el cargador sintético en la app como estación de pruebas y garantiza la tarifa base (solo dev y staging; el servicio lo rechaza en prod)."
  type        = bool
  default     = false
}

variable "placeholder_image" {
  description = "Imagen inicial de los servicios; el flujo de despliegue la reemplaza (Terraform ignora cambios de imagen)."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

# --- Configuración de las apps ---
variable "payments_provider" {
  description = "fake (emulador) o wompi."
  type        = string
  default     = "fake"
}

variable "wompi_environment" {
  description = "sandbox o production (WOMPI_ENVIRONMENT de api y worker)."
  type        = string
  default     = "sandbox"
}

variable "push_provider" {
  description = "expo, log o none."
  type        = string
  default     = "expo"
}

variable "google_maps_map_id" {
  description = "Map ID de Google Maps Platform (Map Management, tipo JavaScript, vector) del proyecto: estilos en la nube y marcadores avanzados en el back-office y la app web; vacío = marcadores clásicos. Público."
  type        = string
  default     = ""
}

# --- Correos de identidad con la marca (ADR 0032) ---
variable "email_provider" {
  description = "resend o brevo (clave en el secreto email-provider-api-key): la API envía los correos de verificación y contraseña con la marca; none = los envía Identity Platform (correo genérico de Google)."
  type        = string
  default     = "none"
}

variable "email_from" {
  description = "Remitente de los correos propios (remitente verificado en Brevo: notificaciones@supercargadores.co, ADR 0019)."
  type        = string
  default     = "VOLT <notificaciones@supercargadores.co>"
}

# --- Celular verificado por SMS (ADR 0031) ---
variable "sms_provider" {
  description = "fake (emulador: el código vuelve en la respuesta; solo dev y staging), twilio o brevo (clave en el secreto sms-provider-api-key) o none."
  type        = string
  default     = "fake"
}

variable "sms_sender" {
  description = "Remitente de los SMS: número E.164 o Messaging Service (MG…) en Twilio; nombre de hasta 11 caracteres o número en Brevo."
  type        = string
  default     = "VOLT"
}

variable "twilio_account_sid" {
  description = "Account SID de Twilio (solo con sms_provider = twilio; el token va en el secreto sms-provider-api-key)."
  type        = string
  default     = ""
}

variable "staff_bootstrap_email" {
  description = "Primer administrador del back-office (API_STAFF_BOOTSTRAP_EMAIL)."
  type        = string
}

variable "create_placeholder_secret_versions" {
  description = "Crea una versión inicial 'unset' en los secretos que llena el dueño o el flujo de despliegue (Wompi, Expo)."
  type        = bool
  default     = true
}

# --- Borde ---
variable "cloud_armor_enabled" {
  description = "Políticas de Cloud Armor en los balanceadores (WAF y límites por IP)."
  type        = bool
  default     = false
}

variable "web_ssl_profile" {
  description = "Perfil de la política SSL del balanceador web (MODERN o RESTRICTED); mínimo TLS 1.2."
  type        = string
  default     = "MODERN"
}

variable "ocpp_ssl_profile" {
  description = "Perfil de la política SSL del balanceador OCPP; COMPATIBLE hasta probar con cargadores reales (ARQ §3.4)."
  type        = string
  default     = "COMPATIBLE"
}

variable "backoffice_iap_enabled" {
  description = "Identity-Aware Proxy delante de admin.<dominio>; requiere la pantalla de consentimiento OAuth (interna) creada por el dueño."
  type        = bool
  default     = false
}

variable "iap_access_domain" {
  description = "Dominio de Google Workspace cuyos usuarios pasan IAP."
  type        = string
  default     = "supercargadores.co"
}

variable "public_dns_ready" {
  description = "true cuando los registros DNS apuntan a los balanceadores: activa uptime checks, SLO del gateway y sus alertas."
  type        = bool
  default     = false
}

# --- Observabilidad ---
variable "alert_emails" {
  description = "Correos que reciben las alertas de Cloud Monitoring."
  type        = list(string)
  default     = []
}

variable "audit_bucket_locked" {
  description = "Bloquea la retención (400 días) del bucket de logs de auditoría; irreversible, solo prod."
  type        = bool
  default     = false
}

# --- Gateway en GKE (tamaño por ambiente; ARQ §4.5) ---
variable "gateway_replicas" {
  type    = number
  default = 2
}

variable "gateway_max_replicas" {
  type    = number
  default = 5
}

variable "gateway_cpu" {
  description = "CPU por pod (Autopilot: mínimo 250m)."
  type        = string
  default     = "500m"
}

variable "gateway_memory" {
  type    = string
  default = "1Gi"
}
