# ---------------------------------------------------------------------------
# Media buckets. Gated behind var.manage_media_buckets — currently OFF because
# the app's expected `fieldflicks-production-media` name is owned by the old
# account and live data already exists in eu-north-1. The ECS task role is
# granted access to the expected bucket ARNs regardless (see iam.tf), so the
# app can talk to whatever buckets exist once the naming is sorted out.
#
# Names must match the app's runtime expectation:
#   media       = <APP_NAME>-<ENVIRONMENT>-media  (fieldflicks-production-media)
#   media-assets = <APP_NAME>-media-assets        (fieldflicks-media-assets)
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "media" {
  count  = var.manage_media_buckets ? 1 : 0
  bucket = local.media_bucket
  tags   = { Name = local.media_bucket }
}

resource "aws_s3_bucket" "media_assets" {
  count  = var.manage_media_buckets ? 1 : 0
  bucket = local.media_assets_bucket
  tags   = { Name = local.media_assets_bucket }
}

resource "aws_s3_bucket_public_access_block" "media" {
  count                   = var.manage_media_buckets ? 1 : 0
  bucket                  = aws_s3_bucket.media[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "media_assets" {
  count                   = var.manage_media_buckets ? 1 : 0
  bucket                  = aws_s3_bucket.media_assets[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "media" {
  count  = var.manage_media_buckets ? 1 : 0
  bucket = aws_s3_bucket.media[0].id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_cors_configuration" "media" {
  count  = var.manage_media_buckets ? 1 : 0
  bucket = aws_s3_bucket.media[0].id
  cors_rule {
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_versioning" "media" {
  count  = var.manage_media_buckets ? 1 : 0
  bucket = aws_s3_bucket.media[0].id
  versioning_configuration {
    status = "Suspended"
  }
}
