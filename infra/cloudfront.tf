locals {
  cloudfront_enabled = var.bridge_domain != ""

  api_gateway_host = replace(aws_apigatewayv2_api.http.api_endpoint, "https://", "")
}

# Origin Access Control: lets CloudFront fetch private S3 objects via SigV4.
# Replaces the older Origin Access Identity pattern.
resource "aws_cloudfront_origin_access_control" "frontend" {
  count                             = local.cloudfront_enabled ? 1 : 0
  name                              = "${local.name_prefix}-frontend-oac-${var.env}"
  description                       = "OAC for bridge-tracker frontend bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "bridge" {
  count               = local.cloudfront_enabled ? 1 : 0
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "bridge-tracker (${var.env})"
  default_root_object = "index.html"
  aliases             = [var.bridge_domain]
  price_class         = "PriceClass_100" # US + EU edge locations; cheapest

  origin {
    origin_id                = "s3-frontend"
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend[0].id
  }

  origin {
    origin_id   = "apigw"
    domain_name = local.api_gateway_host
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Default behavior: static SPA from S3.
  default_cache_behavior {
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 300
    max_ttl     = 86400
  }

  # /api/bridges/brickell/stats and /cycles — cacheable: poller refreshes the
  # precomputed JSON every ~60s, browser refreshes every 15s, so a 15s edge
  # cache flatlines per-visitor cost without making the data feel stale.
  # Honors the API's own `cache-control: max-age=15` header.
  ordered_cache_behavior {
    path_pattern           = "/api/bridges/brickell/stats"
    target_origin_id       = "apigw"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Origin"]
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 15
    max_ttl     = 60
  }

  ordered_cache_behavior {
    path_pattern           = "/api/bridges/brickell/cycles"
    target_origin_id       = "apigw"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Origin"]
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 15
    max_ttl     = 60
  }

  # Other /api/* (status, devices, history) -> API Gateway, no cache.
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "apigw"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Origin", "Content-Type", "Accept"]
      cookies { forward = "all" }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  # SPA fallback: unknown paths under the root resolve to index.html so
  # client-side routing doesn't 404.
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.bridge[0].certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  # CloudFront distributions take 5–10 minutes to deploy; the resource only
  # returns when status is Deployed.
}

# S3 bucket policy: let CloudFront (via OAC) read frontend objects.
data "aws_iam_policy_document" "frontend_oac" {
  count = local.cloudfront_enabled ? 1 : 0
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.bridge[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  count  = local.cloudfront_enabled ? 1 : 0
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_oac[0].json
}

output "cloudfront_domain_name" {
  description = "The CloudFront distribution domain — point your bridge subdomain CNAME at this value."
  value       = local.cloudfront_enabled ? aws_cloudfront_distribution.bridge[0].domain_name : null
}

output "cloudfront_distribution_id" {
  value = local.cloudfront_enabled ? aws_cloudfront_distribution.bridge[0].id : null
}
