locals {
  poller_zip = "${path.module}/../packages/poller/bundle.zip"
  api_zip    = "${path.module}/../packages/api/bundle.zip"

  # Floci spawns Lambda containers on a different podman network than the Floci
  # service container, so the service name "floci" doesn't resolve. Both podman
  # and Docker expose the host via host.containers.internal, which maps to the
  # host-published 4566 port.
  lambda_endpoint = var.floci ? "http://host.containers.internal:4566" : ""

  shared_env = merge(
    {
      CURRENT_TABLE    = aws_dynamodb_table.current.name
      DEVICES_TABLE    = aws_dynamodb_table.devices.name
      HISTORY_BUCKET   = aws_s3_bucket.history.bucket
      AWS_ENDPOINT_URL = local.lambda_endpoint
      CORS_ORIGIN      = var.cors_origin
    },
    local.apns_enabled ? {
      APNS_TEAM_ID         = var.apns_team_id
      APNS_KEY_ID          = var.apns_key_id
      APNS_BUNDLE_ID       = var.apns_bundle_id
      APNS_KEY_SECRET_ARN  = aws_secretsmanager_secret.apns[0].arn
    } : {}
  )
}

resource "aws_s3_bucket" "artifacts" {
  bucket        = "${local.name_prefix}-artifacts-${var.env}"
  force_destroy = true
}

resource "aws_s3_object" "poller_zip" {
  bucket = aws_s3_bucket.artifacts.bucket
  key    = "poller-${filebase64sha256(local.poller_zip)}.zip"
  source = local.poller_zip
  etag   = filemd5(local.poller_zip)
}

resource "aws_s3_object" "api_zip" {
  bucket = aws_s3_bucket.artifacts.bucket
  key    = "api-${filebase64sha256(local.api_zip)}.zip"
  source = local.api_zip
  etag   = filemd5(local.api_zip)
}

resource "aws_lambda_function" "poller" {
  function_name    = "${local.name_prefix}-poller-${var.env}"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "handler.handler"
  s3_bucket        = aws_s3_object.poller_zip.bucket
  s3_key           = aws_s3_object.poller_zip.key
  source_code_hash = filebase64sha256(local.poller_zip)
  timeout          = 30
  memory_size      = 256

  environment {
    variables = local.shared_env
  }
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name_prefix}-api-${var.env}"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "handler.handler"
  s3_bucket        = aws_s3_object.api_zip.bucket
  s3_key           = aws_s3_object.api_zip.key
  source_code_hash = filebase64sha256(local.api_zip)
  timeout          = 15
  memory_size      = 256

  environment {
    variables = local.shared_env
  }
}
