# ---------------------------------------------------------------------------
# CloudFront over the media bucket (Origin Access Control). Gated behind
# var.manage_media_buckets — enabled together with the S3 media buckets once
# the media naming is sorted. Provisioned so the app can move from direct S3
# presigned URLs to CloudFront-signed URLs later (the real egress win).
# PriceClass_200 includes the India edge locations.
# ---------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "media" {
  count                             = var.manage_media_buckets ? 1 : 0
  name                              = "${local.name_prefix}-media-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "media" {
  count           = var.manage_media_buckets ? 1 : 0
  enabled         = true
  comment         = "${local.name_prefix} media"
  price_class     = "PriceClass_200"
  is_ipv6_enabled = true

  origin {
    domain_name              = aws_s3_bucket.media[0].bucket_regional_domain_name
    origin_id                = "media-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.media[0].id
  }

  default_cache_behavior {
    target_origin_id       = "media-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]

    # AWS managed CachingOptimized policy.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Name = "${local.name_prefix}-media-cdn" }
}

# Allow only this CloudFront distribution to read the private media bucket.
data "aws_iam_policy_document" "media_cloudfront" {
  count = var.manage_media_buckets ? 1 : 0
  statement {
    sid       = "AllowCloudFrontOAC"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media[0].arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.media[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  count  = var.manage_media_buckets ? 1 : 0
  bucket = aws_s3_bucket.media[0].id
  policy = data.aws_iam_policy_document.media_cloudfront[0].json
}
