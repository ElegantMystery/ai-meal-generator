resource "aws_db_instance" "postgres" {
  identifier        = "${var.project}-${var.env}-postgres"
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = var.db_instance_class
  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  # pgvector requires PostgreSQL 15+ with the rds-pgvector parameter group
  parameter_group_name = aws_db_parameter_group.postgres.name

  # Backups
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"

  # Not publicly accessible — EC2 connects via private subnet
  publicly_accessible = false

  # Keep final snapshot on destroy for safety
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.project}-${var.env}-final-snapshot"

  deletion_protection = true

  tags = {
    Name    = "${var.project}-${var.env}-postgres"
    Project = var.project
    Env     = var.env
  }
}

resource "aws_db_parameter_group" "postgres" {
  name        = "${var.project}-${var.env}-pg16"
  family      = "postgres16"
  description = "PostgreSQL 16 parameter group with pgvector support"

  # pgvector must be loaded via shared_preload_libraries for some operations
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  tags = {
    Project = var.project
    Env     = var.env
  }
}
