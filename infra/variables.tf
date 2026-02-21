variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name used as a prefix for resource names"
  type        = string
  default     = "meal-gen"
}

variable "env" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "ec2_instance_type" {
  description = "EC2 instance type (ARM)"
  type        = string
  default     = "t4g.small"
}

variable "ec2_ami" {
  description = "Amazon Linux 2023 ARM64 AMI ID (update per region)"
  type        = string
  # Amazon Linux 2023 arm64 in us-east-1 — update if you change region
  default = "ami-044006edae9a34ef5"
}

variable "ec2_key_name" {
  description = "Name of the EC2 key pair for SSH access"
  type        = string
  default     = "meal-gen-key"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "mealgen"
}

variable "db_username" {
  description = "PostgreSQL master username"
  type        = string
  default     = "meal_user"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage in GB"
  type        = number
  default     = 20
}

variable "ecr_image_count" {
  description = "Number of ECR images to retain per repository"
  type        = number
  default     = 5
}

variable "alert_email" {
  description = "Email address to receive CloudWatch alarm notifications (brute-force, errors)"
  type        = string
}
