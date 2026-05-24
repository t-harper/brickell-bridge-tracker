variable "env" {
  description = "Environment name (local, prod)."
  type        = string
}

variable "aws_region" {
  description = "AWS region."
  type        = string
  default     = "us-east-1"
}

variable "floci" {
  description = "If true, target Floci (local AWS emulator) at endpoint_url."
  type        = bool
  default     = false
}

variable "endpoint_url" {
  description = "Override endpoint URL for Floci."
  type        = string
  default     = "http://localhost:4566"
}

variable "poll_schedule_expression" {
  description = "EventBridge schedule for the poller."
  type        = string
  default     = "rate(1 minute)"
}

variable "cors_origin" {
  description = "Allowed origin for the HTTP API."
  type        = string
  default     = "*"
}

variable "apns_team_id" {
  description = "Apple Developer team ID (e.g. ABCDE12345). Leave empty to skip APNs wiring."
  type        = string
  default     = ""
}

variable "apns_key_id" {
  description = "Apple auth key ID for the .p8 (e.g. ABC1234567)."
  type        = string
  default     = ""
}

variable "apns_bundle_id" {
  description = "iOS app bundle id (e.g. net.travis-harper.bridgetracker)."
  type        = string
  default     = ""
}

variable "apns_p8_pem" {
  description = "Contents of the APNs .p8 private key (PEM). Empty to skip APNs wiring. Pass via TF_VAR_apns_p8_pem rather than committing it."
  type        = string
  default     = ""
  sensitive   = true
}

variable "bridge_domain" {
  description = "Alternate domain served by CloudFront (e.g. bridge.example.com). Empty disables CloudFront + ACM."
  type        = string
  default     = ""
}

locals {
  name_prefix     = "bridge-tracker"
  current_table   = "${local.name_prefix}-current-${var.env}"
  devices_table   = "${local.name_prefix}-devices-${var.env}"
  history_bucket  = "${local.name_prefix}-history-${var.env}"
  frontend_bucket = "${local.name_prefix}-frontend-${var.env}"
  apns_enabled    = var.apns_team_id != "" && var.apns_key_id != "" && var.apns_bundle_id != "" && var.apns_p8_pem != ""
}
