# Run-to-completion ingestion task. EventBridge invokes RunTask with this
# task definition, passing the S3 key as a containerOverride env var
# (S3_INGEST_KEY). The container's entrypoint reads that env var and runs the
# ingestion script equivalent.

resource "aws_ecs_task_definition" "ingestion" {
  family                   = "${var.name_prefix}-ingestion"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.ingestion_cpu
  memory                   = var.ingestion_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "ingestion"
      image     = var.ingestion_image
      essential = true

      # EventBridge passes S3_INGEST_BUCKET + S3_INGEST_KEY via the input
      # transformer (see modules/ingestion_trigger/main.tf). The script reads
      # those env vars, downloads the bundle, and ingests it via Prisma.
      command = ["node", "dist/scripts/ingest-bundle-from-s3.js"]

      environment = local.common_env
      secrets     = local.common_secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ingestion.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ingestion"
        }
      }
    }
  ])

  tags = merge(var.tags, { Name = "${var.name_prefix}-ingestion-task" })
}
