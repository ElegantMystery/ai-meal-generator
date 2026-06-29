# EC2 security group — allow HTTP/HTTPS inbound; all outbound.
# No inbound SSH (:22): administrative access is via AWS SSM Session Manager
# (SSH-over-SSM), which tunnels over the SSM agent's outbound channel and needs
# no open port. See deploy.yml / scraper workflows and the "Production access
# (SSM)" section in CLAUDE.md.
resource "aws_security_group" "ec2" {
  name = "${var.project}-${var.env}-ec2-sg"
  # NOTE: description is immutable in AWS — changing it forces SG replacement
  # (and a cascading re-attach to the instance + RDS SG). Left as-is on purpose;
  # SSH is no longer open despite the wording (admin access is via SSM).
  description = "Allow HTTP, HTTPS, SSH inbound traffic"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project}-${var.env}-ec2-sg"
    Project = var.project
    Env     = var.env
  }
}

# RDS security group — allow 5432 from EC2 SG only
resource "aws_security_group" "rds" {
  name        = "${var.project}-${var.env}-rds-sg"
  description = "Allow PostgreSQL access from EC2 only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from EC2"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project}-${var.env}-rds-sg"
    Project = var.project
    Env     = var.env
  }
}
