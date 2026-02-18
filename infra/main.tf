terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "ai-meal-generator-tfstate"
    key    = "prod/terraform.tfstate"
    region = "us-east-1"
    # Enable state locking via DynamoDB
    dynamodb_table = "ai-meal-generator-tflock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}
