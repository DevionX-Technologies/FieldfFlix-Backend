terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

# Primary region — everything lives in ap-south-1 (Mumbai), close to users.
provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "fieldflicks"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# CloudFront + ACM certs consumed by CloudFront must live in us-east-1.
# The ALB cert stays in ap-south-1 (see acm.tf); this alias is only used if a
# CloudFront-attached cert is added later.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      Project     = "fieldflicks"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
