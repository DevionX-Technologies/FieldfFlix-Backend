data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Two AZs is enough for a single-service prod footprint in ap-south-1.
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name_prefix = "${var.app_name}-${var.environment}" # e.g. fieldflicks-production
  account_id  = data.aws_caller_identity.current.account_id
  azs         = slice(data.aws_availability_zones.available.names, 0, 2)

  media_bucket        = "${local.name_prefix}-media"   # fieldflicks-production-media (matches app code)
  media_assets_bucket = "${var.app_name}-media-assets" # fieldflicks-media-assets (matches app code)

  # Path prefix for SSM parameters holding secret app config.
  ssm_prefix = "/${var.app_name}/${var.environment}"

  # Third-party secrets injected into the task as `secrets` (SecureString).
  # Terraform creates the parameter KEYS with a placeholder; real values are set
  # out-of-band (see infra/README.md) and preserved via ignore_changes.
  # Full set of app runtime config/secrets the app needs at boot (validated by a
  # local `--env-file .env` run). Injected from SSM SecureString. Values are set
  # out-of-band from .env; Terraform only manages the keys (ignore_changes=value).
  # NOTE: AWS_ACCESS_KEY_ID/SECRET are included to mirror the current app (S3 in
  # eu-north-1). TODO: migrate app S3 access to the ECS task role and drop these.
  app_secret_keys = [
    "AWS_ACCESS_KEY_ID",
    "AWS_CW_LOG_GROUP",
    "AWS_S3_BUCKET_NAME",
    "AWS_SECRET_ACCESS_KEY",
    "FAST2SMS_AUTHORIZATION",
    "FAST2SMS_DLT_MESSAGE_ID",
    "FAST2SMS_SENDER_ID",
    "FFMPEG_PATH",
    "FIREBASE_APP_CHECK_DEBUG_TOKEN",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "FIREBASE_PROJECT_ID",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_REDIRECT_URL",
    "GOOGLE_OAUTH_SECRET",
    "JWT_EXPIRATION",
    "JWT_EXPIRE_TIME",
    "JWT_SECRET",
    "MSG91_AUTH_KEY",
    "MSG91_OTP_TEMPLATE_ID",
    "MUX_PRIVATE_KEY",
    "MUX_SIGNING_KEY_ID",
    "MUX_TOKEN_ID",
    "MUX_TOKEN_SECRET",
    "MUX_WEBHOOK_SECRET",
    "PI_API_KEY",
    "PI_EVMS_API_KEY",
    "PI_LIVE_API_KEY",
    "PI_LIVE_API_URL",
    "PI_RECORDINGS_API_URL",
    "RASPBERRY_PI_API_URL",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RPI_CLIENT_ID",
    "SMTP_PASS",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
  ]

  # Non-sensitive config injected as plaintext `environment`.
  # DB_HOST is added dynamically in ecs.tf from the RDS endpoint.
  app_environment = {
    NODE_ENV                              = "production"
    APP_NAME                              = var.app_name
    ENVIRONMENT                           = var.environment
    PORT                                  = tostring(var.container_port)
    AWS_REGION                            = var.region
    DB_PORT                               = "5432"
    DB_DATABASE                           = var.db_name
    DB_USER                               = var.db_username
    APP_BASE_URL                          = "https://${var.domain_name}"
    HIGHLIGHT_MP4_EXPORT_STRATEGY         = "mux_then_lambda"
    HIGHLIGHT_MUX_AUTO_REQUEST_STATIC_MP4 = "true"
    MUX_CONVERTER_LAMBDA_FUNCTION_NAME    = "${local.name_prefix}-m3u8-converter"
    SMTP_HOST                             = "smtp.gmail.com"
    SMTP_PORT                             = "587"
    SMTP_USER                             = "admin@fieldflix.com"
    SUPPORT_CONTACT_TO                    = "admin@fieldflix.com"
    # FIREBASE_PROJECT_ID / FAST2SMS_SENDER_ID / FAST2SMS_DLT_MESSAGE_ID are now
    # injected from SSM (see app_secret_keys) so all app config is set the same way.
  }
}
