# Observabilidad (OPS §2): canal de correo, métricas basadas en logs, alertas con runbook, uptime
# checks, SLOs de la API y del gateway (por el cargador sintético), panel y logs de auditoría.
locals {
  runbooks_url = "https://github.com/sbgbernal17/volt-platform/blob/main/docs/runbooks"
  log_alert_strategy = {
    period     = "300s"
    auto_close = "1800s"
  }
}

resource "google_monitoring_notification_channel" "email" {
  for_each     = toset(var.alert_emails)
  display_name = "Correo ${each.value}"
  type         = "email"
  labels = {
    email_address = each.value
  }
  depends_on = [google_project_service.apis]
}

locals {
  channels = [for c in google_monitoring_notification_channel.email : c.id]
}

# --- Métricas basadas en logs (las apps registran JSON con `event`) ---
resource "google_logging_metric" "alarm_raised" {
  name   = "volt/alarm_raised"
  filter = "jsonPayload.event=\"alarm.raised\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    labels {
      key         = "kind"
      value_type  = "STRING"
      description = "Tipo de alarma (ops.alarm.kind)"
    }
    labels {
      key        = "severity"
      value_type = "STRING"
    }
  }
  label_extractors = {
    kind     = "EXTRACT(jsonPayload.kind)"
    severity = "EXTRACT(jsonPayload.severity)"
  }
}

resource "google_logging_metric" "gateway_disconnects" {
  name   = "volt/gateway_disconnects"
  filter = "resource.type=\"k8s_container\" AND jsonPayload.message=\"cargador desconectado\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    labels {
      key        = "code"
      value_type = "STRING"
    }
  }
  label_extractors = {
    code = "EXTRACT(jsonPayload.code)"
  }
}

resource "google_logging_metric" "worker_job_failed" {
  name   = "volt/worker_job_failed"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"worker\" AND jsonPayload.message=\"trabajo fallido\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    labels {
      key        = "job"
      value_type = "STRING"
    }
  }
  label_extractors = {
    job = "EXTRACT(jsonPayload.job)"
  }
}

resource "google_logging_metric" "synthetic_cycle" {
  name   = "volt/synthetic_cycle"
  filter = "jsonPayload.event=\"synthetic.cycle\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    labels {
      key        = "result"
      value_type = "STRING"
    }
  }
  label_extractors = {
    result = "EXTRACT(jsonPayload.result)"
  }
}

# --- Alertas ---
resource "google_monitoring_alert_policy" "charger_offline" {
  display_name = "[${var.env}] Cargador fuera de línea"
  combiner     = "OR"
  severity     = "WARNING"
  conditions {
    display_name = "Alarma CHARGER_OFFLINE abierta"
    condition_matched_log {
      filter = "jsonPayload.event=\"alarm.raised\" AND jsonPayload.kind=\"CHARGER_OFFLINE\""
    }
  }
  alert_strategy {
    notification_rate_limit {
      period = local.log_alert_strategy.period
    }
    auto_close = local.log_alert_strategy.auto_close
  }
  notification_channels = local.channels
  documentation {
    mime_type = "text/markdown"
    content   = "Un cargador OPERATIONAL lleva más de la gracia configurada sin conexión. Runbook: ${local.runbooks_url}/RB-01-cargador-offline.md"
  }
}

resource "google_monitoring_alert_policy" "critical_alarms" {
  display_name = "[${var.env}] Alarma crítica de la plataforma"
  combiner     = "OR"
  severity     = "CRITICAL"
  conditions {
    display_name = "Alarma con severidad CRITICAL"
    condition_matched_log {
      filter = "jsonPayload.event=\"alarm.raised\" AND jsonPayload.severity=\"CRITICAL\""
    }
  }
  alert_strategy {
    notification_rate_limit {
      period = local.log_alert_strategy.period
    }
    auto_close = local.log_alert_strategy.auto_close
  }
  notification_channels = local.channels
  documentation {
    mime_type = "text/markdown"
    content   = "Alarma crítica (sede con muchos cargadores fuera de línea, cobros fallando, cadena de auditoría rota…). Runbooks: ${local.runbooks_url}"
  }
}

resource "google_monitoring_alert_policy" "worker_job_failed" {
  display_name = "[${var.env}] Trabajo del worker fallido"
  combiner     = "OR"
  severity     = "WARNING"
  conditions {
    display_name = "Un trabajo del worker terminó con error"
    condition_matched_log {
      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"worker\" AND jsonPayload.message=\"trabajo fallido\""
    }
  }
  alert_strategy {
    notification_rate_limit {
      period = "1800s"
    }
    auto_close = local.log_alert_strategy.auto_close
  }
  notification_channels = local.channels
  documentation {
    mime_type = "text/markdown"
    content   = "Revisar el log del worker (campo `job`). Runbook: ${local.runbooks_url}/RB-12-worker.md"
  }
}

resource "google_monitoring_alert_policy" "api_5xx" {
  display_name = "[${var.env}] API con errores 5xx"
  combiner     = "OR"
  severity     = "CRITICAL"
  conditions {
    display_name = "Más de 5 respuestas 5xx por minuto durante 5 minutos"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"api\" AND metric.labels.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger {
        count = 1
      }
    }
  }
  notification_channels = local.channels
  documentation {
    mime_type = "text/markdown"
    content   = "Errores 5xx sostenidos en la API. Runbook: ${local.runbooks_url}/RB-11-api-y-cloud-run.md"
  }
}

resource "google_monitoring_alert_policy" "cloudsql_cpu" {
  display_name = "[${var.env}] Cloud SQL con CPU alta"
  combiner     = "OR"
  severity     = "WARNING"
  conditions {
    display_name = "CPU > 80 % durante 15 minutos"
    condition_threshold {
      filter          = "metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\" AND resource.type=\"cloudsql_database\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "900s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
  notification_channels = local.channels
  documentation {
    mime_type = "text/markdown"
    content   = "Runbook: ${local.runbooks_url}/RB-13-cloud-sql.md"
  }
}

resource "google_monitoring_alert_policy" "cloudsql_disk" {
  display_name = "[${var.env}] Cloud SQL con disco casi lleno"
  combiner     = "OR"
  severity     = "CRITICAL"
  conditions {
    display_name = "Disco > 85 %"
    condition_threshold {
      filter          = "metric.type=\"cloudsql.googleapis.com/database/disk/utilization\" AND resource.type=\"cloudsql_database\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.85
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
  notification_channels = local.channels
  documentation {
    mime_type = "text/markdown"
    content   = "El disco crece solo, pero conviene revisar particiones y retención. Runbook: ${local.runbooks_url}/RB-13-cloud-sql.md"
  }
}

resource "google_monitoring_alert_policy" "redis_memory" {
  display_name = "[${var.env}] Redis con memoria alta"
  combiner     = "OR"
  severity     = "WARNING"
  conditions {
    display_name = "Uso de memoria > 85 %"
    condition_threshold {
      filter          = "metric.type=\"redis.googleapis.com/stats/memory/usage_ratio\" AND resource.type=\"redis_instance\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.85
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
  notification_channels = local.channels
  documentation {
    mime_type = "text/markdown"
    content   = "Runbook: ${local.runbooks_url}/RB-14-redis.md"
  }
}

resource "google_monitoring_alert_policy" "pubsub_backlog" {
  display_name = "[${var.env}] Pub/Sub con mensajes atrasados"
  combiner     = "OR"
  severity     = "WARNING"
  conditions {
    display_name = "Mensaje sin confirmar más antiguo que 5 minutos"
    condition_threshold {
      filter          = "metric.type=\"pubsub.googleapis.com/subscription/oldest_unacked_message_age\" AND resource.type=\"pubsub_subscription\""
      comparison      = "COMPARISON_GT"
      threshold_value = 300
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }
  notification_channels = local.channels
  documentation {
    mime_type = "text/markdown"
    content   = "La suscripción de BigQuery no consume: revisar el esquema de la tabla y la cola de rechazados domain-events-dlq."
  }
}

resource "google_monitoring_alert_policy" "gateway_restarts" {
  display_name = "[${var.env}] Gateway OCPP reiniciándose"
  combiner     = "OR"
  severity     = "CRITICAL"
  conditions {
    display_name = "Más de 3 reinicios de contenedor en 10 minutos"
    condition_threshold {
      filter          = "metric.type=\"kubernetes.io/container/restart_count\" AND resource.type=\"k8s_container\" AND resource.labels.container_name=\"ocpp-gateway\""
      comparison      = "COMPARISON_GT"
      threshold_value = 3
      duration        = "0s"
      aggregations {
        alignment_period     = "600s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  notification_channels = local.channels
  documentation {
    mime_type = "text/markdown"
    content   = "Runbook: ${local.runbooks_url}/RB-10-gateway-caido.md"
  }
}

# --- Uptime checks y alertas asociadas (cuando el DNS ya apunta a los balanceadores) ---
resource "google_monitoring_uptime_check_config" "https" {
  for_each     = var.public_dns_ready ? { api = local.hosts.api, ocpp = local.hosts.ocpp } : {}
  display_name = "[${var.env}] ${each.key} /healthz"
  timeout      = "10s"
  period       = "60s"
  checker_type = "STATIC_IP_CHECKERS"

  http_check {
    path         = "/healthz"
    port         = 443
    use_ssl      = true
    validate_ssl = true
    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = each.value
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  for_each     = google_monitoring_uptime_check_config.https
  display_name = "[${var.env}] ${each.key} no responde desde internet"
  combiner     = "OR"
  severity     = "CRITICAL"
  conditions {
    display_name = "Uptime check fallido"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.labels.check_id=\"${each.value.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "60s"
      aggregations {
        alignment_period     = "1200s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }
      trigger {
        count = 1
      }
    }
  }
  notification_channels = local.channels
  documentation {
    mime_type = "text/markdown"
    content   = "El balanceador o el servicio no responden desde fuera. Runbooks: ${local.runbooks_url}/RB-10-gateway-caido.md y RB-11-api-y-cloud-run.md"
  }
}

# --- SLOs (OPS §2.4) ---
resource "google_monitoring_custom_service" "api" {
  service_id   = "volt-api-${var.env}"
  display_name = "API Volt (${var.env})"
}

resource "google_monitoring_slo" "api_availability" {
  service             = google_monitoring_custom_service.api.service_id
  slo_id              = "api-availability"
  display_name        = "API sin errores 5xx: 99,9 % en 30 días"
  goal                = 0.999
  rolling_period_days = 30
  request_based_sli {
    good_total_ratio {
      total_service_filter = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\" resource.label.\"service_name\"=\"api\""
      bad_service_filter   = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\" resource.label.\"service_name\"=\"api\" metric.label.\"response_code_class\"=\"5xx\""
    }
  }
}

resource "google_monitoring_slo" "api_latency" {
  service             = google_monitoring_custom_service.api.service_id
  slo_id              = "api-latency"
  display_name        = "API p95 < 500 ms: 99 % en 30 días"
  goal                = 0.99
  rolling_period_days = 30
  request_based_sli {
    distribution_cut {
      distribution_filter = "metric.type=\"run.googleapis.com/request_latencies\" resource.type=\"cloud_run_revision\" resource.label.\"service_name\"=\"api\""
      range {
        min = 0
        max = 500
      }
    }
  }
}

resource "google_monitoring_custom_service" "gateway" {
  service_id   = "volt-gateway-${var.env}"
  display_name = "Gateway OCPP (${var.env})"
}

# Disponibilidad del gateway medida por el cargador sintético desde fuera (OPS §2.4): ciclos
# correctos / ciclos totales.
resource "google_monitoring_slo" "gateway_availability" {
  count               = var.synthetic_enabled ? 1 : 0
  service             = google_monitoring_custom_service.gateway.service_id
  slo_id              = "gateway-availability"
  display_name        = "Gateway alcanzable por el cargador sintético: 99,9 % en 30 días"
  goal                = 0.999
  rolling_period_days = 30
  request_based_sli {
    good_total_ratio {
      good_service_filter  = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.synthetic_cycle.name}\" metric.label.\"result\"=\"ok\""
      total_service_filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.synthetic_cycle.name}\""
    }
  }
}

resource "google_monitoring_alert_policy" "api_burn_rate" {
  display_name = "[${var.env}] API consumiendo el presupuesto de error"
  combiner     = "OR"
  severity     = "CRITICAL"
  conditions {
    display_name = "Tasa de consumo > 10 en 1 hora"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.api_availability.name}\", \"3600s\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 10
      duration        = "0s"
    }
  }
  notification_channels = local.channels
  documentation {
    mime_type = "text/markdown"
    content   = "Se congelan despliegues no correctivos si el presupuesto mensual baja del 20 % (OPS §2.4). Runbook: ${local.runbooks_url}/RB-11-api-y-cloud-run.md"
  }
}

# --- Panel ---
resource "google_monitoring_dashboard" "platform" {
  dashboard_json = jsonencode({
    displayName = "Volt ${var.env}: plataforma"
    mosaicLayout = {
      columns = 12
      tiles = [
        {
          xPos = 0, yPos = 0, width = 6, height = 4
          widget = {
            title = "API: peticiones por segundo por clase de respuesta"
            xyChart = {
              dataSets = [{
                plotType = "STACKED_AREA"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\" resource.label.\"service_name\"=\"api\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.\"response_code_class\""]
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 0, width = 6, height = 4
          widget = {
            title = "API: latencia p95 (ms)"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"run.googleapis.com/request_latencies\" resource.type=\"cloud_run_revision\" resource.label.\"service_name\"=\"api\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_PERCENTILE_95"
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos = 0, yPos = 4, width = 6, height = 4
          widget = {
            title = "Gateway: CPU por pod"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"kubernetes.io/container/cpu/core_usage_time\" resource.type=\"k8s_container\" resource.label.\"container_name\"=\"ocpp-gateway\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.\"pod_name\""]
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 4, width = 6, height = 4
          widget = {
            title = "Gateway: desconexiones de cargadores por minuto"
            xyChart = {
              dataSets = [{
                plotType = "STACKED_BAR"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.gateway_disconnects.name}\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_SUM"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.\"code\""]
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos = 0, yPos = 8, width = 4, height = 4
          widget = {
            title = "Alarmas abiertas por tipo (por minuto)"
            xyChart = {
              dataSets = [{
                plotType = "STACKED_BAR"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.alarm_raised.name}\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_SUM"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.\"kind\""]
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos = 4, yPos = 8, width = 4, height = 4
          widget = {
            title = "Cloud SQL: CPU"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\" resource.type=\"cloudsql_database\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_MEAN"
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos = 8, yPos = 8, width = 4, height = 4
          widget = {
            title = "Redis: memoria usada"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"redis.googleapis.com/stats/memory/usage_ratio\" resource.type=\"redis_instance\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_MEAN"
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos = 0, yPos = 12, width = 6, height = 4
          widget = {
            title = "Cargador sintético: ciclos por resultado"
            xyChart = {
              dataSets = [{
                plotType = "STACKED_BAR"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.synthetic_cycle.name}\""
                    aggregation = {
                      alignmentPeriod    = "300s"
                      perSeriesAligner   = "ALIGN_SUM"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.\"result\""]
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 12, width = 6, height = 4
          widget = {
            title = "Pub/Sub: antigüedad del mensaje sin confirmar (s)"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"pubsub.googleapis.com/subscription/oldest_unacked_message_age\" resource.type=\"pubsub_subscription\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_MAX"
                    }
                  }
                }
              }]
            }
          }
        },
      ]
    }
  })
}

# --- Auditoría (SEG §6.3): acceso a datos de Secret Manager y Cloud SQL, y bucket de 400 días ---
resource "google_project_iam_audit_config" "data_access" {
  for_each = toset(["secretmanager.googleapis.com", "cloudsql.googleapis.com"])
  project  = var.project_id
  service  = each.value
  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

resource "google_logging_project_bucket_config" "audit" {
  project        = var.project_id
  location       = "global"
  bucket_id      = "audit"
  retention_days = 400
  locked         = var.audit_bucket_locked
  description    = "Cloud Audit Logs con retención de 400 días"
}

resource "google_logging_project_sink" "audit" {
  name                   = "audit-to-bucket"
  destination            = "logging.googleapis.com/${google_logging_project_bucket_config.audit.id}"
  filter                 = "logName:\"cloudaudit.googleapis.com\""
  unique_writer_identity = true
}

resource "google_project_iam_member" "audit_sink_writer" {
  project = var.project_id
  role    = "roles/logging.bucketWriter"
  member  = google_logging_project_sink.audit.writer_identity
}
