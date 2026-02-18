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

output "ssh_command" {
  description = "SSH command to connect to the EC2 instance"
  value       = "ssh -i ~/.ssh/${var.ec2_key_name}.pem ec2-user@${aws_eip.app.public_ip}"
}
