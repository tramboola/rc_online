variable "project_id" {
  type        = string
  description = "Dedicated staging or production GCP project ID."
}

variable "environment" {
  type        = string
  description = "Deployment environment."
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "region" {
  type        = string
  description = "Primary GCP region."
  default     = "europe-central2"
}

variable "container_tag" {
  type        = string
  description = "Immutable image tag, normally a Git commit SHA."
  validation {
    condition     = var.container_tag != "latest"
    error_message = "The latest tag is forbidden."
  }
}

variable "domain" {
  type        = string
  description = "Public application domain."
}

variable "deletion_protection" {
  type        = bool
  default     = true
  description = "Protect stateful production resources."
}
