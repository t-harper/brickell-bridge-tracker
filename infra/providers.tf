terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.46"
    }
  }

  # Remote state for CI-driven deploys. The workspace name (e.g. "prod") is
  # appended automatically, so the same backend block serves every workspace.
  # For local floci dev, init with `-backend=false` (state is throwaway).
  backend "s3" {
    bucket         = "bridge-tracker-tfstate-831473839640"
    key            = "bridge-tracker.tfstate"
    region         = "us-east-1"
    dynamodb_table = "bridge-tracker-tflock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  access_key                  = var.floci ? "test" : null
  secret_key                  = var.floci ? "test" : null
  skip_credentials_validation = var.floci
  skip_metadata_api_check     = var.floci
  skip_requesting_account_id  = var.floci
  s3_use_path_style           = var.floci

  dynamic "endpoints" {
    for_each = var.floci ? [1] : []
    content {
      dynamodb    = var.endpoint_url
      s3          = var.endpoint_url
      lambda      = var.endpoint_url
      iam         = var.endpoint_url
      sts         = var.endpoint_url
      apigateway  = var.endpoint_url
      apigatewayv2 = var.endpoint_url
      events      = var.endpoint_url
      cloudwatch  = var.endpoint_url
      logs        = var.endpoint_url
    }
  }
}
