resource "aws_instance" "app" {
  ami                    = var.ec2_ami
  instance_type          = var.ec2_instance_type
  key_name               = var.ec2_key_name
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  # User data: install Docker + Docker Compose on first boot
  user_data = <<-EOF
    #!/bin/bash
    set -e

    # Update system
    dnf update -y

    # Install Docker
    dnf install -y docker
    systemctl enable docker
    systemctl start docker
    usermod -aG docker ec2-user

    # Install Docker Compose plugin
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

    # Install AWS CLI v2 (for ECR login helper)
    dnf install -y aws-cli

    # Configure ECR credential helper for Docker
    mkdir -p /root/.docker
    cat > /root/.docker/config.json <<'DOCKERCFG'
    {
      "credHelpers": {
        "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com": "ecr-login"
      }
    }
    DOCKERCFG

    # Create app directory
    mkdir -p /opt/meal-gen
    chown ec2-user:ec2-user /opt/meal-gen

    # Create nginx log directory (mounted from container for CloudWatch Agent)
    mkdir -p /opt/meal-gen/nginx-logs
    chown ec2-user:ec2-user /opt/meal-gen/nginx-logs

    # Install CloudWatch Agent
    dnf install -y amazon-cloudwatch-agent

    echo "Bootstrap complete"
  EOF

  tags = {
    Name    = "${var.project}-${var.env}-app"
    Project = var.project
    Env     = var.env
  }

  depends_on = [aws_internet_gateway.igw]
}

# Elastic IP — stable public IP across instance stop/start
resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id

  tags = {
    Name    = "${var.project}-${var.env}-eip"
    Project = var.project
    Env     = var.env
  }
}

# Data source needed for account ID in user_data
data "aws_caller_identity" "current" {}
