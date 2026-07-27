locals {
  name = "rc-${var.environment}"
  labels = {
    application = "rc-racing"
    environment = var.environment
    managed_by  = "terraform"
  }
  services = toset([
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "redis.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "vpcaccess.googleapis.com"
  ])
  provider_environment = {
    IDENTITY_PROVIDER      = "google"
    PAYMENT_PROVIDER       = "stripe"
    DEVICE_PROVIDER        = "physical"
    TIMING_PROVIDER        = "openstint"
    CAMERA_PROVIDER        = "rtsp"
    PUBLIC_STREAM_PROVIDER = "youtube"
    NOTIFICATION_PROVIDER  = "smtp"
  }
  runtime_secret_names = toset([
    "database-url",
    "google-oauth-client-id",
    "google-oauth-client-secret",
    "ride-grant-ed25519-private-key",
    "ride-grant-ed25519-public-key",
    "stripe-restricted-key",
    "stripe-webhook-secret"
  ])
  api_secret_environment = {
    DATABASE_URL                   = "database-url"
    GOOGLE_OAUTH_CLIENT_ID         = "google-oauth-client-id"
    GOOGLE_OAUTH_CLIENT_SECRET     = "google-oauth-client-secret"
    RIDE_GRANT_ED25519_PRIVATE_KEY = "ride-grant-ed25519-private-key"
    RIDE_GRANT_ED25519_PUBLIC_KEY  = "ride-grant-ed25519-public-key"
    STRIPE_RESTRICTED_KEY          = "stripe-restricted-key"
    STRIPE_WEBHOOK_SECRET          = "stripe-webhook-secret"
  }
  worker_secret_environment = {
    DATABASE_URL = "database-url"
  }
}

resource "google_project_service" "required" {
  for_each           = local.services
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "containers" {
  location      = var.region
  repository_id = "${local.name}-containers"
  format        = "DOCKER"
  labels        = local.labels
  depends_on    = [google_project_service.required]
}

resource "google_compute_network" "main" {
  name                    = "${local.name}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
  depends_on              = [google_project_service.required]
}

resource "google_compute_subnetwork" "cloud_run" {
  name                     = "${local.name}-run"
  network                  = google_compute_network.main.id
  region                   = var.region
  ip_cidr_range            = "10.42.0.0/24"
  private_ip_google_access = true
}

resource "google_compute_global_address" "private_services" {
  name          = "${local.name}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

resource "random_password" "database" {
  length  = 32
  special = true
}

resource "google_secret_manager_secret" "runtime" {
  for_each  = local.runtime_secret_names
  secret_id = "${local.name}-${each.key}"
  replication {
    auto {}
  }
  labels     = local.labels
  depends_on = [google_project_service.required]
}

resource "google_sql_database_instance" "postgres" {
  name                = "${local.name}-postgres"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.deletion_protection
  settings {
    tier              = var.environment == "production" ? "db-custom-2-7680" : "db-custom-1-3840"
    availability_type = var.environment == "production" ? "REGIONAL" : "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 50
    disk_autoresize   = true
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 14
        retention_unit   = "COUNT"
      }
    }
    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.main.id
      enable_private_path_for_google_cloud_services = true
    }
    insights_config {
      query_insights_enabled  = true
      record_application_tags = true
      record_client_address   = false
    }
    user_labels = local.labels
  }
  depends_on = [google_service_networking_connection.private_services]
}

resource "google_sql_database" "application" {
  name     = "rc_racing"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "application" {
  name     = "rc_app"
  instance = google_sql_database_instance.postgres.name
  password = random_password.database.result
}

resource "google_secret_manager_secret_version" "database_url" {
  secret = google_secret_manager_secret.runtime["database-url"].id
  secret_data = format(
    "postgresql://rc_app:%s@%s:5432/rc_racing?sslmode=require",
    urlencode(random_password.database.result),
    google_sql_database_instance.postgres.private_ip_address
  )
}

resource "google_redis_instance" "operational" {
  name                    = "${local.name}-redis"
  region                  = var.region
  tier                    = var.environment == "production" ? "STANDARD_HA" : "BASIC"
  memory_size_gb          = 1
  redis_version           = "REDIS_7_2"
  authorized_network      = google_compute_network.main.id
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  transit_encryption_mode = "SERVER_AUTHENTICATION"
  labels                  = local.labels
  depends_on              = [google_service_networking_connection.private_services]
}

resource "google_service_account" "runtime" {
  for_each     = toset(["web", "api", "worker", "migrations"])
  account_id   = "${local.name}-${each.key}"
  display_name = "RC Racing ${each.key} ${var.environment}"
}

resource "google_secret_manager_secret_iam_member" "runtime_access" {
  for_each = {
    for pair in setproduct(
      ["api", "worker", "migrations"],
      local.runtime_secret_names
      ) : "${pair[0]}:${pair[1]}" => {
      service = pair[0]
      secret  = pair[1]
    }
    if pair[1] == "database-url" || pair[0] == "api"
  }
  secret_id = google_secret_manager_secret.runtime[each.value.secret].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value.service].email}"
}

resource "google_cloud_run_v2_service" "service" {
  for_each = {
    web    = { port = 3000, min = var.environment == "production" ? 1 : 0, cpu_idle = true }
    api    = { port = 3001, min = var.environment == "production" ? 1 : 0, cpu_idle = true }
    worker = { port = 8080, min = 1, cpu_idle = false }
  }
  name                = "${local.name}-${each.key}"
  location            = var.region
  deletion_protection = var.deletion_protection
  ingress             = each.key == "worker" ? "INGRESS_TRAFFIC_INTERNAL_ONLY" : "INGRESS_TRAFFIC_ALL"
  template {
    service_account = google_service_account.runtime[each.key].email
    scaling {
      min_instance_count = each.value.min
      max_instance_count = each.key == "worker" ? 4 : 20
    }
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.repository_id}/${each.key}:${var.container_tag}"
      ports {
        container_port = each.value.port
      }
      resources {
        cpu_idle = each.value.cpu_idle
        limits = {
          cpu    = each.key == "worker" ? "2" : "1"
          memory = each.key == "worker" ? "1Gi" : "512Mi"
        }
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "REDIS_URL"
        value = "rediss://${google_redis_instance.operational.host}:${google_redis_instance.operational.port}"
      }
      dynamic "env" {
        for_each = each.key == "web" ? {} : local.provider_environment
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = each.key == "api" ? local.api_secret_environment : (
          each.key == "worker" ? local.worker_secret_environment : {}
        )
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
      startup_probe {
        http_get {
          path = each.key == "web" ? "/" : "/health/live"
          port = each.value.port
        }
        initial_delay_seconds = 2
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 12
      }
    }
    vpc_access {
      network_interfaces {
        network    = google_compute_network.main.name
        subnetwork = google_compute_subnetwork.cloud_run.name
        tags       = ["cloud-run"]
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
  }
  labels     = local.labels
  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_job" "migrations" {
  name                = "${local.name}-migrations"
  location            = var.region
  deletion_protection = var.deletion_protection
  template {
    template {
      service_account = google_service_account.runtime["migrations"].email
      max_retries     = 0
      timeout         = "900s"
      containers {
        image   = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.repository_id}/migrations:${var.container_tag}"
        command = ["pnpm", "--filter", "@rc/database", "db:migrate"]
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime["database-url"].secret_id
              version = "latest"
            }
          }
        }
      }
      vpc_access {
        network_interfaces {
          network    = google_compute_network.main.name
          subnetwork = google_compute_subnetwork.cloud_run.name
        }
        egress = "PRIVATE_RANGES_ONLY"
      }
    }
  }
  labels = local.labels
}

resource "google_compute_security_policy" "edge" {
  name = "${local.name}-armor"
  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow; application and rate-limit rules are added per reviewed rollout."
  }
  rule {
    action   = "rate_based_ban"
    priority = 1000
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 600
        interval_sec = 60
      }
      ban_duration_sec = 300
    }
  }
}

# The external HTTPS load balancer, managed certificate, serverless NEGs and CDN
# are intentionally composed in the environment layer after DNS ownership is
# verified. Cloud Armor above is attached to that backend service.
