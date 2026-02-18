# Secrets Manager entries — values are placeholders; set them manually or via CLI
# aws secretsmanager put-secret-value --secret-id <ARN> --secret-string '<value>'

resource "aws_secretsmanager_secret" "db_password" {
  name                    = "${var.project}/${var.env}/db-password"
  description             = "RDS PostgreSQL master password"
  recovery_window_in_days = 7

  tags = {
    Project = var.project
    Env     = var.env
  }
}

resource "aws_secretsmanager_secret" "openai_api_key" {
  name                    = "${var.project}/${var.env}/openai-api-key"
  description             = "OpenAI API key for RAG service"
  recovery_window_in_days = 7

  tags = {
    Project = var.project
    Env     = var.env
  }
}

resource "aws_secretsmanager_secret" "google_oauth" {
  name                    = "${var.project}/${var.env}/google-oauth"
  description             = "Google OAuth2 client ID and secret (JSON: {client_id, client_secret})"
  recovery_window_in_days = 7

  tags = {
    Project = var.project
    Env     = var.env
  }
}

resource "aws_secretsmanager_secret" "rag_shared_secret" {
  name                    = "${var.project}/${var.env}/rag-shared-secret"
  description             = "Shared secret for backend -> RAG auth (X-RAG-SECRET header)"
  recovery_window_in_days = 7

  tags = {
    Project = var.project
    Env     = var.env
  }
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name                    = "${var.project}/${var.env}/jwt-secret"
  description             = "JWT signing secret for session tokens"
  recovery_window_in_days = 7

  tags = {
    Project = var.project
    Env     = var.env
  }
}
