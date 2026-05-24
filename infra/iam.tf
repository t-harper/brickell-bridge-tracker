data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.name_prefix}-lambda-${var.env}"
  assume_role_policy = data.aws_iam_policy_document.assume_lambda.json
}

data "aws_iam_policy_document" "lambda_inline" {
  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ]
    resources = [
      aws_dynamodb_table.current.arn,
      aws_dynamodb_table.devices.arn,
    ]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.history.arn, "${aws_s3_bucket.history.arn}/*"]
  }
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["*"]
  }
  dynamic "statement" {
    for_each = local.apns_enabled ? [1] : []
    content {
      actions   = ["ssm:GetParameter"]
      resources = [aws_ssm_parameter.apns[0].arn]
    }
  }
}

resource "aws_iam_role_policy" "lambda" {
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_inline.json
}

# The GitHub Actions deploy role itself is bootstrap-managed (it has to exist
# before CI can run terraform), but its inline policy is owned here so SSM /
# IAM / etc. grants flow through PRs instead of out-of-band aws cli calls.
# The role grants iam:PutRolePolicy on role/bridge-tracker-* — so it can
# rewrite its own policy on apply.
resource "aws_iam_role_policy" "gha_apply" {
  name   = "terraform-deploy"
  role   = "bridge-tracker-gha-apply"
  policy = file("${path.module}/gha-apply-policy.json")
}
