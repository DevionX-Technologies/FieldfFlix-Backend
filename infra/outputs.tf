output "alb_dns_name" {
  description = "Point your API domain (CNAME) at this ALB."
  value       = aws_lb.main.dns_name
}

output "ecr_repository_url" {
  description = "Push images here (used by CI)."
  value       = aws_ecr_repository.backend.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.app.name
}

output "cloudfront_media_domain" {
  description = "CloudFront domain for media (wire the app to sign URLs against this). Null until media buckets are managed."
  value       = try(aws_cloudfront_distribution.media[0].domain_name, null)
}

output "github_deploy_role_arn" {
  description = "Set as AWS_DEPLOY_ROLE in GitHub for OIDC auth."
  value       = aws_iam_role.github_deploy.arn
}

output "rds_endpoint" {
  value     = aws_db_instance.main.address
  sensitive = true
}

# Add these CNAMEs to your external DNS to validate the ACM cert (see acm.tf).
output "acm_validation_records" {
  description = "CNAME records to create in external DNS for ACM validation."
  value = [
    for o in aws_acm_certificate.api.domain_validation_options : {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  ]
}
