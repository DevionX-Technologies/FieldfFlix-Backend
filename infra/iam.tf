# ===========================================================================
# ECS execution role — used by the ECS agent to pull images, write logs, and
# read the SSM secrets referenced in the task definition.
# ===========================================================================
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "${local.name_prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Read the SSM SecureString params (secrets injection) + decrypt via the
# AWS-managed SSM key, scoped by ViaService.
data "aws_iam_policy_document" "ecs_execution_ssm" {
  statement {
    sid       = "ReadAppParams"
    actions   = ["ssm:GetParameters"]
    resources = ["arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.ssm_prefix}/*"]
  }
  statement {
    sid       = "DecryptSsm"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ecs_execution_ssm" {
  name   = "${local.name_prefix}-ecs-execution-ssm"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution_ssm.json
}

# ===========================================================================
# ECS task role — the app's own runtime AWS permissions (S3, SQS, Lambda,
# X-Ray). No AWS keys in env: the SDK picks up these creds from the task role.
# ===========================================================================
resource "aws_iam_role" "ecs_task" {
  name               = "${local.name_prefix}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "ecs_task" {
  # Static ARNs (not resource refs) so the task role is valid whether or not
  # Terraform manages the buckets (see var.manage_media_buckets).
  statement {
    sid     = "MediaBuckets"
    actions = ["s3:GetObject", "s3:PutObject", "s3:PutObjectAcl", "s3:DeleteObject"]
    resources = [
      "arn:aws:s3:::${local.media_bucket}/*",
      "arn:aws:s3:::${local.media_assets_bucket}/*",
    ]
  }
  statement {
    sid     = "MediaBucketsList"
    actions = ["s3:ListBucket"]
    resources = [
      "arn:aws:s3:::${local.media_bucket}",
      "arn:aws:s3:::${local.media_assets_bucket}",
    ]
  }
  statement {
    sid = "ClipProcessingQueue"
    actions = [
      "sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes", "sqs:GetQueueUrl",
    ]
    # Queue is created by the Serverless Framework stack.
    resources = ["arn:aws:sqs:${var.region}:${local.account_id}:${local.name_prefix}-clip-processing"]
  }
  statement {
    sid       = "InvokeMuxLambdas"
    actions   = ["lambda:InvokeFunction"]
    resources = ["arn:aws:lambda:${var.region}:${local.account_id}:function:${local.name_prefix}-*"]
  }
  statement {
    sid       = "XRay"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ecs_task" {
  name   = "${local.name_prefix}-ecs-task"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task.json
}

# ===========================================================================
# GitHub Actions OIDC — lets the CI workflow assume a deploy role with no
# long-lived access keys stored in GitHub.
# ===========================================================================
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/${var.github_deploy_branch}"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${local.name_prefix}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart",
      "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.backend.arn]
  }
  statement {
    sid = "EcsDeploy"
    actions = [
      "ecs:UpdateService", "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition",
    ]
    resources = ["*"]
  }
  statement {
    sid       = "PassEcsRoles"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.ecs_execution.arn, aws_iam_role.ecs_task.arn]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "${local.name_prefix}-github-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

# NOTE: An admin IAM user (to retire the account root keys) is intentionally
# NOT created by Terraform. Create it manually in the IAM console:
#   IAM -> Users -> Create user "fieldflicks-admin" -> attach AdministratorAccess,
# generate credentials, reconfigure the AWS CLI to use them, then delete the
# account root access keys.
