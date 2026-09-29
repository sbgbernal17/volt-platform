# Eventos de dominio en Pub/Sub (ARQ §2.2): el worker publica lo que sale del outbox; una
# suscripción de BigQuery guarda la telemetría para analítica; los mensajes que BigQuery rechaza van
# a la cola de rechazados.
resource "google_project_service_identity" "pubsub" {
  provider = google-beta
  service  = "pubsub.googleapis.com"
}

resource "google_pubsub_topic" "domain_events" {
  name                       = "domain-events"
  labels                     = local.labels
  message_retention_duration = "86400s"
  depends_on                 = [google_project_service.apis]
}

resource "google_pubsub_topic" "domain_events_dlq" {
  name   = "domain-events-dlq"
  labels = local.labels
}

resource "google_bigquery_dataset" "telemetry" {
  dataset_id                 = "telemetry"
  friendly_name              = "Telemetría Volt (${var.env})"
  location                   = var.region
  delete_contents_on_destroy = !local.is_prod
  labels                     = local.labels
}

resource "google_bigquery_table" "domain_events" {
  dataset_id          = google_bigquery_dataset.telemetry.dataset_id
  table_id            = "domain_events"
  deletion_protection = local.is_prod
  labels              = local.labels

  time_partitioning {
    type  = "DAY"
    field = "publish_time"
  }
  clustering = ["subscription_name"]

  schema = jsonencode([
    { name = "subscription_name", type = "STRING", mode = "NULLABLE" },
    { name = "message_id", type = "STRING", mode = "NULLABLE" },
    { name = "publish_time", type = "TIMESTAMP", mode = "NULLABLE" },
    { name = "data", type = "STRING", mode = "NULLABLE" },
    { name = "attributes", type = "STRING", mode = "NULLABLE" },
  ])
}

locals {
  pubsub_agent = "serviceAccount:service-${local.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_bigquery_dataset_iam_member" "pubsub_editor" {
  dataset_id = google_bigquery_dataset.telemetry.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = local.pubsub_agent
  depends_on = [google_project_service_identity.pubsub]
}

resource "google_pubsub_topic_iam_member" "dlq_publisher" {
  topic      = google_pubsub_topic.domain_events_dlq.name
  role       = "roles/pubsub.publisher"
  member     = local.pubsub_agent
  depends_on = [google_project_service_identity.pubsub]
}

resource "google_pubsub_subscription" "domain_events_bigquery" {
  name   = "domain-events-bigquery"
  topic  = google_pubsub_topic.domain_events.id
  labels = local.labels

  bigquery_config {
    table               = "${var.project_id}.${google_bigquery_dataset.telemetry.dataset_id}.${google_bigquery_table.domain_events.table_id}"
    write_metadata      = true
    drop_unknown_fields = true
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.domain_events_dlq.id
    max_delivery_attempts = 10
  }

  expiration_policy {
    ttl = ""
  }

  depends_on = [google_bigquery_dataset_iam_member.pubsub_editor, google_pubsub_topic_iam_member.dlq_publisher]
}

resource "google_pubsub_subscription_iam_member" "bigquery_sub_subscriber" {
  subscription = google_pubsub_subscription.domain_events_bigquery.name
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_agent
}

resource "google_pubsub_subscription" "domain_events_dlq" {
  name   = "domain-events-dlq-pull"
  topic  = google_pubsub_topic.domain_events_dlq.id
  labels = local.labels
  expiration_policy {
    ttl = ""
  }
}
