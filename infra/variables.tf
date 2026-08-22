variable "region" {
  type        = string
  default     = "ap-south-1"
  description = "Primary AWS region (Mumbai)."
}

variable "environment" {
  type        = string
  default     = "production"
  description = "Deployment environment. Drives resource names and the app's ENVIRONMENT var."
}

variable "app_name" {
  type        = string
  default     = "fieldflicks"
  description = "Application name. Combined with environment for bucket naming (<app>-<env>-media)."
}

variable "domain_name" {
  type        = string
  description = "Public API hostname served by the ALB, e.g. api.devionx.com. Used for the ACM cert and APP_BASE_URL."
}

variable "media_cdn_domain" {
  type        = string
  default     = ""
  description = "Optional custom domain for the CloudFront media distribution (e.g. media.devionx.com). Leave empty to use the default *.cloudfront.net domain."
}

variable "github_repo" {
  type        = string
  description = "GitHub repo allowed to assume the CI/CD deploy role, in owner/name form, e.g. Dark-Kernel/FieldfFlix-Backend."
}

variable "github_deploy_branches" {
  type        = list(string)
  default     = ["main"]
  description = "Branches whose pushes may assume the deploy role via OIDC."
}

# --- Compute / DB sizing (cost-tunable) ---
variable "task_cpu" {
  type        = number
  default     = 512
  description = "Fargate task CPU units (512 = 0.5 vCPU)."
}

variable "task_memory" {
  type        = number
  default     = 1024
  description = "Fargate task memory in MiB."
}

variable "service_desired_count" {
  type        = number
  default     = 1
  description = "Baseline number of running tasks."
}

variable "service_max_count" {
  type        = number
  default     = 3
  description = "Autoscaling ceiling."
}

variable "db_instance_class" {
  type        = string
  default     = "db.t4g.micro"
  description = "RDS instance class (Graviton)."
}

variable "db_allocated_storage" {
  type        = number
  default     = 20
  description = "RDS storage in GB (gp3)."
}

variable "db_name" {
  type        = string
  default     = "fieldflicks"
  description = "Initial Postgres database name."
}

variable "db_username" {
  type        = string
  default     = "fieldflicks"
  description = "Postgres master username."
}

variable "container_port" {
  type        = number
  default     = 8000
  description = "Port the NestJS app listens on (Dockerfile EXPOSE 8000)."
}

variable "enable_https" {
  type        = bool
  default     = true
  description = "When true, the ALB serves HTTPS (443) with the ACM cert and 80 redirects to 443 — requires the cert to be validated. When false, the ALB serves plain HTTP on 80 (bring-up before DNS/cert is ready)."
}

variable "manage_media_buckets" {
  type        = bool
  default     = true
  description = "When true, Terraform creates/manages the S3 media buckets + CloudFront. Set false to deploy the app without touching media storage (e.g. the desired bucket name is owned elsewhere, or live data already exists). The ECS task role still gets access to the expected bucket ARNs either way."
}

variable "enable_container_insights" {
  type        = bool
  default     = false
  description = "ECS Container Insights. Off by default to save cost — the essential alarms use free AWS/ECS + AWS/ApplicationELB metrics. Turn on for deeper per-container/network dashboards."
}

variable "db_free_tier" {
  type        = bool
  default     = false
  description = "When true, RDS is created with free-tier-plan-compatible settings (no automated backups, no performance insights, no deletion protection, no final snapshot). Flip to false after upgrading the AWS account to a paid plan, then re-apply for production-grade backups."
}

variable "monthly_budget_usd" {
  type        = number
  default     = 150
  description = "AWS Budgets monthly threshold (USD) for alerting."
}

variable "alert_email" {
  type        = string
  description = "Email address for Budgets + Cost Anomaly Detection alerts."
}
