resource "aws_ssm_parameter" "apns" {
  count       = local.apns_enabled ? 1 : 0
  name        = "/${local.name_prefix}/${var.env}/apns/p8"
  description = "APNs .p8 auth key (private key PEM)"
  type        = "SecureString"
  value       = var.apns_p8_pem
  # AWS-managed key (alias/aws/ssm) is implicit when key_id is omitted; it has
  # no monthly fee, unlike Secrets Manager. Standard tier (under 4KB) is free.
}
