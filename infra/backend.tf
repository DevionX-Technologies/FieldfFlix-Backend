# Remote state — created by infra/bootstrap. After bootstrap apply, run:
#   terraform init -migrate-state
terraform {
  backend "s3" {
    bucket         = "fieldflicks-tfstate-697589241071"
    key            = "production/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "fieldflicks-tflock"
    encrypt        = true
  }
}
