# ===========================================================================
# Cost + health monitoring. Native CloudWatch/SNS/Athena — a few $/mo.
# Goal: get alerted the DAY a bandwidth/error spike starts, and be able to
# attribute it to a specific request/endpoint via ALB access logs.
# ===========================================================================

# --- SNS topic for alarm notifications (email) ---
resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
  # NOTE: confirm the subscription via the email AWS sends after apply.
}

# --- CloudWatch alarms (all use free default metrics) ---

# Bandwidth tripwire: bytes through the ALB in a 1h window. This is the direct
# early signal for the data-transfer problem. Tune the threshold to your norm.
resource "aws_cloudwatch_metric_alarm" "alb_processed_bytes" {
  alarm_name          = "${local.name_prefix}-alb-processed-bytes-high"
  alarm_description   = "ALB ProcessedBytes unusually high in 1h — possible bandwidth spike."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "ProcessedBytes"
  dimensions          = { LoadBalancer = aws_lb.main.arn_suffix }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 21474836480 # 20 GiB/hour — adjust to your baseline
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${local.name_prefix}-alb-5xx-high"
  alarm_description   = "Target 5xx errors elevated."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = aws_lb.main.arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 25
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "alb_latency_p95" {
  alarm_name          = "${local.name_prefix}-alb-latency-p95-high"
  alarm_description   = "p95 target response time > 3s."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = { LoadBalancer = aws_lb.main.arn_suffix }
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "ecs_cpu" {
  alarm_name          = "${local.name_prefix}-ecs-cpu-high"
  alarm_description   = "ECS service CPU > 85%."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  dimensions          = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.app.name }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 85
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "ecs_mem" {
  alarm_name          = "${local.name_prefix}-ecs-mem-high"
  alarm_description   = "ECS service memory > 85%."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  dimensions          = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.app.name }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 85
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name_prefix}-rds-cpu-high"
  alarm_description   = "RDS CPU > 85%."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 85
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  alarm_name          = "${local.name_prefix}-rds-free-storage-low"
  alarm_description   = "RDS free storage < 2 GiB."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "LessThanThreshold"
  threshold           = 2147483648
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# ===========================================================================
# ALB access logs -> S3 -> Athena (per-request bandwidth attribution)
# ===========================================================================
resource "aws_s3_bucket" "alb_logs" {
  bucket        = "${local.name_prefix}-alb-logs-${local.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "alb_logs" {
  bucket                  = aws_s3_bucket.alb_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule {
    id     = "expire-old-logs"
    status = "Enabled"
    filter {}
    expiration { days = 90 }
  }
}

# ALB access-log delivery: modern service-principal method (works in ap-south-1),
# plus the regional ELB account as a fallback.
resource "aws_s3_bucket_policy" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AWSLogDeliveryWrite"
        Effect    = "Allow"
        Principal = { Service = "logdelivery.elasticloadbalancing.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.alb_logs.arn}/alb/AWSLogs/${local.account_id}/*"
        Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
      },
      {
        Sid       = "ELBRegionalAccountWrite"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::718504428378:root" } # ELB account, ap-south-1
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.alb_logs.arn}/alb/AWSLogs/${local.account_id}/*"
      },
      {
        Sid       = "AWSLogDeliveryAclCheck"
        Effect    = "Allow"
        Principal = { Service = "logdelivery.elasticloadbalancing.amazonaws.com" }
        Action    = ["s3:GetBucketAcl", "s3:ListBucket"]
        Resource  = aws_s3_bucket.alb_logs.arn
      },
    ]
  })
}

# Athena results + query definitions
resource "aws_athena_workgroup" "logs" {
  name = "${local.name_prefix}-logs"
  configuration {
    result_configuration {
      output_location = "s3://${aws_s3_bucket.alb_logs.id}/athena-results/"
    }
  }
  force_destroy = true
}

resource "aws_glue_catalog_database" "logs" {
  name = replace("${local.name_prefix}_logs", "-", "_")
}

resource "aws_athena_named_query" "create_alb_table" {
  name        = "01-create-alb-logs-table"
  description = "Run once: creates the external table over ALB access logs."
  database    = aws_glue_catalog_database.logs.name
  workgroup   = aws_athena_workgroup.logs.name
  query       = <<-SQL
    CREATE EXTERNAL TABLE IF NOT EXISTS alb_logs (
      type string, time string, elb string, client_ip string, client_port int,
      target_ip string, target_port int, request_processing_time double,
      target_processing_time double, response_processing_time double,
      elb_status_code int, target_status_code string, received_bytes bigint,
      sent_bytes bigint, request_verb string, request_url string, request_proto string,
      user_agent string, ssl_cipher string, ssl_protocol string, target_group_arn string,
      trace_id string, domain_name string, chosen_cert_arn string, matched_rule_priority string,
      request_creation_time string, actions_executed string, redirect_url string,
      lambda_error_reason string, target_port_list string, target_status_code_list string,
      classification string, classification_reason string, conn_trace_id string
    )
    ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.RegexSerDe'
    WITH SERDEPROPERTIES (
      'serialization.format' = '1',
      'input.regex' = '([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*):([0-9]*) ([^ ]*)[:-]([0-9]*) ([-.0-9]*) ([-.0-9]*) ([-.0-9]*) (|[-0-9]*) (-|[-0-9]*) ([-0-9]*) ([-0-9]*) \"([^ ]*) (.*) (- |[^ ]*)\" \"([^\"]*)\" ([A-Z0-9-_]+) ([A-Za-z0-9.-]*) ([^ ]*) \"([^\"]*)\" \"([^\"]*)\" \"([^\"]*)\" ([-.0-9]*) ([^ ]*) \"([^\"]*)\" \"([^\"]*)\" \"([^ ]*)\" \"([^\\s]+?)\" \"([^\\s]+)\" \"([^ ]*)\" \"([^ ]*)\" ?([^ ]*)?'
    )
    LOCATION 's3://${aws_s3_bucket.alb_logs.id}/alb/AWSLogs/${local.account_id}/elasticloadbalancing/${var.region}/';
  SQL
}

resource "aws_athena_named_query" "top_bandwidth" {
  name        = "02-top-bandwidth-by-endpoint-last-7d"
  description = "Which URLs sent the most bytes (bandwidth) in the last 7 days."
  database    = aws_glue_catalog_database.logs.name
  workgroup   = aws_athena_workgroup.logs.name
  query       = <<-SQL
    SELECT
      regexp_replace(request_url, '\?.*$', '') AS url,
      count(*)                                  AS requests,
      round(sum(sent_bytes) / 1073741824.0, 3)  AS gb_sent,
      round(avg(sent_bytes) / 1048576.0, 2)      AS avg_mb
    FROM alb_logs
    WHERE from_iso8601_timestamp(time) > current_timestamp - interval '7' day
    GROUP BY 1
    ORDER BY gb_sent DESC
    LIMIT 50;
  SQL
}
