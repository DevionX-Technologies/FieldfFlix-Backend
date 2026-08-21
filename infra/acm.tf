# ---------------------------------------------------------------------------
# ACM certificate for the API domain (ap-south-1, for the ALB).
#
# No Route53 hosted zone exists in this account → DNS validation is manual.
# A cert can only attach to the ALB HTTPS listener once ISSUED, so the flow is:
#
#   1. terraform apply -target=aws_acm_certificate.api
#   2. terraform output acm_validation_records   # add these CNAMEs to your DNS
#   3. terraform apply                            # waits for validation, then
#                                                 # builds the ALB 443 listener
#
# The certificate_validation resource below is what makes the listener wait.
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "api" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Waits until the cert is ISSUED (i.e. you've added the CNAMEs to external DNS).
# No validation_record_fqdns because DNS is managed outside this account.
resource "aws_acm_certificate_validation" "api" {
  count           = var.enable_https ? 1 : 0
  certificate_arn = aws_acm_certificate.api.arn

  timeouts {
    create = "60m" # gives you time to add the DNS records during apply
  }
}
