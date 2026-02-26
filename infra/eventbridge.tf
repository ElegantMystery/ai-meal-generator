# ---------------------------------------------------------------------------
# EventBridge Scheduler + SSM Run Command — TJ Scraper Pipeline
#
# Flow: EventBridge Scheduler → SSM SendCommand → EC2 runs tj-scraper-pipeline.sh
# ---------------------------------------------------------------------------

# CloudWatch log group for scraper output (SSM Run Command streams output here)
resource "aws_cloudwatch_log_group" "scraper" {
  name              = "/meal-gen/prod/scraper"
  retention_in_days = 30

  tags = {
    Project = var.project
    Env     = var.env
  }
}

# ---------------------------------------------------------------------------
# IAM Role for EventBridge Scheduler → SSM SendCommand
# ---------------------------------------------------------------------------

resource "aws_iam_role" "eventbridge_scraper" {
  name = "${var.project}-${var.env}-eventbridge-scraper"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Project = var.project
    Env     = var.env
  }
}

resource "aws_iam_role_policy" "eventbridge_ssm_send" {
  name = "ssm-send-command"
  role = aws_iam_role.eventbridge_scraper.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "ssm:SendCommand"
        Resource = [
          # The SSM document this role is allowed to run
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:document/${aws_ssm_document.tj_scraper.name}",
          # The EC2 instance this role is allowed to target
          aws_instance.app.arn,
        ]
      },
      {
        # Required to poll command status (EventBridge checks execution)
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation", "ssm:ListCommands"]
        Resource = "*"
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# SSM Command Document
# ---------------------------------------------------------------------------

resource "aws_ssm_document" "tj_scraper" {
  name            = "${var.project}-${var.env}-tj-scraper"
  document_type   = "Command"
  document_format = "JSON"

  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Run the TJ scraper pipeline: scrape → import → backfill embeddings"
    mainSteps = [
      {
        action = "aws:runShellScript"
        name   = "RunTJScraperPipeline"
        inputs = {
          runCommand = [
            "#!/bin/bash",
            "set -euo pipefail",
            "echo \"[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting TJ scraper pipeline\"",
            "bash /opt/meal-gen/scripts/tj-scraper-pipeline.sh",
            "echo \"[$(date -u +%Y-%m-%dT%H:%M:%SZ)] TJ scraper pipeline finished\""
          ]
          workingDirectory = "/opt/meal-gen"
          timeoutSeconds   = "3600"
        }
      }
    ]
  })

  tags = {
    Project = var.project
    Env     = var.env
  }
}

# ---------------------------------------------------------------------------
# EventBridge Scheduler Rule
# Uses the universal target "aws-sdk:ssm:sendCommand" to invoke SSM directly
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "tj_scraper" {
  name       = "${var.project}-${var.env}-tj-scraper"
  group_name = "default"

  schedule_expression          = var.scraper_schedule_expression
  schedule_expression_timezone = "UTC"
  state                        = var.scraper_enabled ? "ENABLED" : "DISABLED"

  # Allow up to 30 min flexibility so it doesn't pile up if instance is busy
  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 30
  }

  target {
    # Universal target: EventBridge calls SSM SendCommand API directly
    arn      = "arn:aws:scheduler:::aws-sdk:ssm:sendCommand"
    role_arn = aws_iam_role.eventbridge_scraper.arn

    input = jsonencode({
      DocumentName = aws_ssm_document.tj_scraper.name
      InstanceIds  = [aws_instance.app.id]
      CloudWatchOutputConfig = {
        CloudWatchLogGroupName  = aws_cloudwatch_log_group.scraper.name
        CloudWatchOutputEnabled = true
      }
      TimeoutSeconds = 3600
    })
  }

  depends_on = [
    aws_ssm_document.tj_scraper,
    aws_iam_role_policy.eventbridge_ssm_send,
  ]
}
