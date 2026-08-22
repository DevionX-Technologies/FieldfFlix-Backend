# ---------------------------------------------------------------------------
# Cost guardrails — the whole point of the rebuild. A monthly budget alarm and
# ML-based anomaly detection email you before a data-transfer spike compounds.
# Cost Explorer APIs live in us-east-1, so CE resources use that provider.
# ---------------------------------------------------------------------------

resource "aws_budgets_budget" "monthly" {
  name         = "${local.name_prefix}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Early tripwire: 50% of budget already spent (actual).
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  # Alert at 80% forecasted and 100% actual.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

# NOTE: A custom Cost Anomaly Monitor is omitted — this account hit the
# dimensional-monitor limit (AWS already provides a default service monitor).
# The monthly Budget above covers cost alerting. Re-add a custom monitor here
# if you later remove the default one:
#
# resource "aws_ce_anomaly_monitor" "services" { ... }
# resource "aws_ce_anomaly_subscription" "services" { ... }
