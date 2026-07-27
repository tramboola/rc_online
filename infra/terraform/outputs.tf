output "artifact_registry_repository" {
  value = google_artifact_registry_repository.containers.id
}

output "cloud_run_services" {
  value = { for key, service in google_cloud_run_v2_service.service : key => service.uri }
}

output "cloud_sql_private_ip" {
  value     = google_sql_database_instance.postgres.private_ip_address
  sensitive = true
}

output "redis_host" {
  value     = google_redis_instance.operational.host
  sensitive = true
}
