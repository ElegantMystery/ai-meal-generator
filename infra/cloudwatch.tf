# ---------------------------------------------------------------------------
# CloudWatch Log Groups
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "nginx" {
  name              = "/meal-gen/prod/nginx"
  retention_in_days = 30

  tags = {
    Project = var.project
    Env     = var.env
  }
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/meal-gen/prod/backend"
  retention_in_days = 30

  tags = {
    Project = var.project
    Env     = var.env
  }
}

resource "aws_cloudwatch_log_group" "rag" {
  name              = "/meal-gen/prod/rag"
  retention_in_days = 30

  tags = {
    Project = var.project
    Env     = var.env
  }
}

# ---------------------------------------------------------------------------
# Auth Event Metric Filters (on backend JSON logs)
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "signup_success" {
  name           = "SignupSuccess"
  log_group_name = aws_cloudwatch_log_group.backend.name
  pattern        = "{ $.mdc.event = \"SIGNUP_SUCCESS\" }"

  metric_transformation {
    name          = "SignupCount"
    namespace     = "MealGen/Auth"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "login_success" {
  name           = "LoginSuccess"
  log_group_name = aws_cloudwatch_log_group.backend.name
  pattern        = "{ $.mdc.event = \"LOGIN_SUCCESS\" }"

  metric_transformation {
    name          = "LoginCount"
    namespace     = "MealGen/Auth"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "oauth_login_success" {
  name           = "OAuthLoginSuccess"
  log_group_name = aws_cloudwatch_log_group.backend.name
  pattern        = "{ $.mdc.event = \"OAUTH_LOGIN_SUCCESS\" }"

  metric_transformation {
    name          = "OAuthLoginCount"
    namespace     = "MealGen/Auth"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "login_failed" {
  name           = "LoginFailed"
  log_group_name = aws_cloudwatch_log_group.backend.name
  pattern        = "{ $.mdc.event = \"LOGIN_FAILED\" }"

  metric_transformation {
    name          = "LoginFailedCount"
    namespace     = "MealGen/Auth"
    value         = "1"
    default_value = "0"
  }
}

# ---------------------------------------------------------------------------
# HTTP Status Code Metric Filters (on nginx JSON access logs)
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "http_2xx" {
  name           = "Http2xx"
  log_group_name = aws_cloudwatch_log_group.nginx.name
  pattern        = "{ $.status >= 200 && $.status < 300 }"

  metric_transformation {
    name          = "Http2xxCount"
    namespace     = "MealGen/HTTP"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "http_4xx" {
  name           = "Http4xx"
  log_group_name = aws_cloudwatch_log_group.nginx.name
  pattern        = "{ $.status >= 400 && $.status < 500 }"

  metric_transformation {
    name          = "Http4xxCount"
    namespace     = "MealGen/HTTP"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "http_5xx" {
  name           = "Http5xx"
  log_group_name = aws_cloudwatch_log_group.nginx.name
  pattern        = "{ $.status >= 500 }"

  metric_transformation {
    name          = "Http5xxCount"
    namespace     = "MealGen/HTTP"
    value         = "1"
    default_value = "0"
  }
}

# ---------------------------------------------------------------------------
# CloudWatch Dashboard
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "MealGen-Prod"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Auth Events"
          region = var.aws_region
          view   = "timeSeries"
          period = 300
          metrics = [
            ["MealGen/Auth", "SignupCount",     { stat = "Sum", label = "Sign-ups",           color = "#2ca02c" }],
            ["MealGen/Auth", "LoginCount",      { stat = "Sum", label = "Local logins",       color = "#1f77b4" }],
            ["MealGen/Auth", "OAuthLoginCount", { stat = "Sum", label = "Google logins",      color = "#ff7f0e" }],
            ["MealGen/Auth", "LoginFailedCount",{ stat = "Sum", label = "Failed login attempts", color = "#d62728" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "HTTP Status Codes"
          region = var.aws_region
          view   = "timeSeries"
          period = 300
          metrics = [
            ["MealGen/HTTP", "Http2xxCount", { stat = "Sum", label = "2xx Success", color = "#2ca02c" }],
            ["MealGen/HTTP", "Http4xxCount", { stat = "Sum", label = "4xx Client Errors", color = "#ff7f0e" }],
            ["MealGen/HTTP", "Http5xxCount", { stat = "Sum", label = "5xx Server Errors", color = "#d62728" }]
          ]
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 6
        width  = 24
        height = 6
        properties = {
          title  = "Recent Auth Events"
          region = var.aws_region
          view   = "table"
          query  = "SOURCE '/meal-gen/prod/backend' | fields @timestamp, mdc.event, mdc.provider, message | filter mdc.event in ['SIGNUP_SUCCESS', 'LOGIN_SUCCESS', 'OAUTH_LOGIN_SUCCESS', 'LOGIN_FAILED'] | sort @timestamp desc | limit 50"
        }
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# SNS Topic + Email Subscription for Alerts
# ---------------------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name = "${var.project}-${var.env}-alerts"

  tags = {
    Project = var.project
    Env     = var.env
  }
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---------------------------------------------------------------------------
# Alarm: High Login Failure Rate (security monitoring)
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "high_login_failures" {
  alarm_name          = "MealGen-HighLoginFailures"
  alarm_description   = "More than 10 failed login attempts in 5 minutes — possible brute-force attack"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "LoginFailedCount"
  namespace           = "MealGen/Auth"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  tags = {
    Project = var.project
    Env     = var.env
  }
}
