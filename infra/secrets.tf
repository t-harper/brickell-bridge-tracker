resource "aws_secretsmanager_secret" "apns" {
  count                   = local.apns_enabled ? 1 : 0
  name                    = "${local.name_prefix}-apns-${var.env}"
  description             = "APNs .p8 auth key (private key PEM)"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "apns" {
  count         = local.apns_enabled ? 1 : 0
  secret_id     = aws_secretsmanager_secret.apns[0].id
  secret_string = file(var.apns_p8_file)
}
