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

# Allow execution role to read the DB secret so it can inject DATABASE_URL as
# an env var on container start.
data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      var.db_secret_arn,
    ]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "${var.name_prefix}-execution-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# ----- Task role -----
# Identity the running container assumes for app-level AWS calls: S3 read on
# the docs bucket, and Bedrock model invocation (Claude + Titan embeddings).

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-task"
  assume_role_policy = data.aws_iam_policy_document.task_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "task_app" {
  statement {
    sid       = "ReadDocuments"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [var.documents_bucket_arn, "${var.documents_bucket_arn}/*"]
  }

  # Bedrock invocation. Scoped to "*" because cross-region inference profiles
  # (us.anthropic.*) resolve to foundation-model ARNs across multiple regions.
  # In prod, scope to the specific inference-profile + model ARNs you use.
  statement {
    sid       = "InvokeBedrock"
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task_app" {
  name   = "${var.name_prefix}-task-app"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_app.json
}
