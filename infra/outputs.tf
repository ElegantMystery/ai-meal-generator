output "ec2_public_ip" {
  description = "Elastic IP of the EC2 instance"
  value       = aws_eip.app.public_ip
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port)"
  value       = aws_db_instance.postgres.endpoint
  sensitive   = true
}

output "rds_host" {
  description = "RDS PostgreSQL hostname"
  value       = aws_db_instance.postgres.address
  sensitive   = true
}

output "ecr_frontend_url" {
  description = "ECR repository URL for the frontend image"
  value       = aws_ecr_repository.frontend.repository_url
}

output "ecr_backend_url" {
  description = "ECR repository URL for the backend image"
  value       = aws_ecr_repository.backend.repository_url
}

output "ecr_rag_url" {
  description = "ECR repository URL for the RAG service image"
  value       = aws_ecr_repository.rag.repository_url
}

# Admin access is via SSM Session Manager (no public SSH port). For SSH/scp
# tooling, add an SSH-over-SSM ProxyCommand to ~/.ssh/config (see CLAUDE.md).
output "ssm_session_command" {
  description = "Open a shell on the EC2 instance via SSM Session Manager"
  value       = "aws ssm start-session --target ${aws_instance.app.id} --region ${var.aws_region}"
}
