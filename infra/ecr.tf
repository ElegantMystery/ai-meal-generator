resource "aws_ecr_repository" "frontend" {
  name                 = "${var.project}-frontend"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Project = var.project
    Env     = var.env
  }
}

resource "aws_ecr_repository" "backend" {
  name                 = "${var.project}-backend"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Project = var.project
    Env     = var.env
  }
}

resource "aws_ecr_repository" "rag" {
  name                 = "${var.project}-rag"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Project = var.project
    Env     = var.env
  }
}

# Lifecycle policy: keep only the last N images in each repo
resource "aws_ecr_lifecycle_policy" "frontend" {
  repository = aws_ecr_repository.frontend.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last ${var.ecr_image_count} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.ecr_image_count
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last ${var.ecr_image_count} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.ecr_image_count
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "rag" {
  repository = aws_ecr_repository.rag.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last ${var.ecr_image_count} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.ecr_image_count
      }
      action = { type = "expire" }
    }]
  })
}
