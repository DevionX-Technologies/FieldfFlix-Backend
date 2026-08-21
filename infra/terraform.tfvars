domain_name = "api.fieldflicks.com"
github_repo = "DevionX-Technologies/FieldfFlix-Backend"
alert_email = "chandamin23@gmail.com"

# Bring the stack up on HTTP first (ALB DNS name). Flip to true and re-apply
# once the ACM cert for api.fieldflicks.com has validated, to enable HTTPS.
enable_https = true

# Account is on the AWS Free Tier plan → create RDS without backups/PI/etc.
# Flip to false after upgrading to a paid plan, then re-apply for prod backups.
db_free_tier = true

# Don't manage media S3 buckets/CloudFront yet: the app's expected bucket name
# is owned by the old account, and live data exists in eu-north-1. Deferred.
manage_media_buckets = false
