# ACM cert for the CloudFront alternate domain. CloudFront requires the cert
# in us-east-1; our default provider is already us-east-1 so no aliasing needed.
resource "aws_acm_certificate" "bridge" {
  count             = var.bridge_domain != "" ? 1 : 0
  domain_name       = var.bridge_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# DNS validation records live in our external DNS provider (not managed by
# this Terraform). The `cert_dns_validation` output exposes the CNAME pair
# to create manually; once the record propagates we pass through the
# validation resource.
resource "aws_acm_certificate_validation" "bridge" {
  count                   = var.bridge_domain != "" ? 1 : 0
  certificate_arn         = aws_acm_certificate.bridge[0].arn
  # No validation_record_fqdns: we wait on ACM's own poller to detect the CNAME.
  timeouts {
    create = "30m"
  }
}

output "cert_dns_validation" {
  description = "CNAME record(s) to create in your DNS provider to validate the ACM cert."
  value = var.bridge_domain != "" ? [
    for o in aws_acm_certificate.bridge[0].domain_validation_options : {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  ] : []
}
