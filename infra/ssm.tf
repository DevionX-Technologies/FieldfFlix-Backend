# ---------------------------------------------------------------------------
# Secrets in SSM Parameter Store (SecureString). Injected into the ECS task
# via the `secrets` block (see ecs.tf) so values never appear in the task
# definition or console.
#
# DB_PASSWORD is fully Terraform-managed (generated here, fed to RDS).
# The third-party keys are created with a placeholder; set real values with:
#   aws ssm put-parameter --name /fieldflicks/production/MUX_TOKEN_ID \
#     --type SecureString --value 'xxx' --overwrite
# Terraform ignores later value changes so it won't clobber them.
# ---------------------------------------------------------------------------

resource "random_password" "db" {
  length  = 32
  special = false # avoid characters that need URL-encoding in connection strings
}

resource "aws_ssm_parameter" "db_password" {
  name  = "${local.ssm_prefix}/DB_PASSWORD"
  type  = "SecureString"
  value = random_password.db.result
}

# DB_HOST is only known after RDS is created; store it so the app config is
# fully SSM-driven if desired (also passed as plaintext env in ecs.tf).
resource "aws_ssm_parameter" "db_host" {
  name  = "${local.ssm_prefix}/DB_HOST"
  type  = "String"
  value = aws_db_instance.main.address
}

resource "aws_ssm_parameter" "app_secret" {
  for_each = toset(local.app_secret_keys)

  name  = "${local.ssm_prefix}/${each.key}"
  type  = "SecureString"
  value = "REPLACE_ME"

  lifecycle {
    ignore_changes = [value] # real value set out-of-band via CLI
  }
}
