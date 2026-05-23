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
      APNS_KEY_PARAM_NAME  = aws_ssm_parameter.apns[0].name
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
  # Graviton: arm64 is ~20% cheaper per GB-second. Our bundle is pure JS so
  # there's no native-binary concern.
  architectures    = ["arm64"]
  handler          = "handler.handler"
  s3_bucket        = aws_s3_object.poller_zip.bucket
  s3_key           = aws_s3_object.poller_zip.key
  source_code_hash = filebase64sha256(local.poller_zip)
  # 2 polls × ~1s + 1 × 30s sleep + buffer for retries / slow FL511.
  timeout          = 60
  # Poller is I/O-bound (fetch FL511 + DDB + S3). 128MB is plenty; halves the
  # GB-sec bill vs 256MB, which matters because most of the invocation is sleep.
  memory_size      = 128

  environment {
    variables = local.shared_env
  }
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name_prefix}-api-${var.env}"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  architectures    = ["arm64"]
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

# Explicit log groups with 7-day retention so CloudWatch Logs storage doesn't
# grow forever (Lambda's auto-created groups default to "Never Expire"). Has to
# come before the first Lambda invocation, or Lambda pre-creates the group and
# Terraform will fail to claim it — import + retention would be needed then.
resource "aws_cloudwatch_log_group" "poller" {
  name              = "/aws/lambda/${aws_lambda_function.poller.function_name}"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${aws_lambda_function.api.function_name}"
  retention_in_days = 7
}
