# ----- Task execution role -----
# Used by ECS itself to: pull from ECR, write to CloudWatch Logs, fetch
# Secrets Manager values to inject as env vars. Does NOT have application-
# level permissions - those go on the task role below.

data "aws_iam_policy_document" "task_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-task-execution"
  assume_role_policy = data.aws_iam_policy_document.task_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow execution role to read both DB and Bedrock secrets so it can inject
# them as env vars on container start.
data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      var.db_secret_arn,
      aws_secretsmanager_secret.bedrock.arn,
    ]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "${var.name_prefix}-execution-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# ----- Task role -----
# Identity the running container assumes for app-level AWS calls. Bedrock
# calls intentionally use BEDROCK_AWS_ACCESS_KEY_ID/SECRET (different account)
# rather than this role, so we grant only S3 read on the docs bucket here.

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-task"
  assume_role_policy = data.aws_iam_policy_document.task_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "task_s3" {
  statement {
    sid       = "ReadDocuments"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [var.documents_bucket_arn, "${var.documents_bucket_arn}/*"]
  }
}

resource "aws_iam_role_policy" "task_s3" {
  name   = "${var.name_prefix}-task-s3"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_s3.json
}
