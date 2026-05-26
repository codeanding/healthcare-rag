locals {
  # Plain env vars (non-secret). Secrets are injected via the `secrets` block.
  common_env = [
    { name = "AWS_REGION", value = var.aws_region },
    { name = "NODE_ENV", value = "production" },
    { name = "BEDROCK_LLM_MODEL_ID", value = var.bedrock_llm_model_id },
    { name = "BEDROCK_EMBEDDING_MODEL_ID", value = var.bedrock_embedding_model_id },
    { name = "BEDROCK_NOTE_SYNTH_MODEL_ID", value = var.bedrock_note_synth_model_id },
    { name = "BEDROCK_AWS_REGION", value = var.bedrock_aws_region },
    { name = "S3_DOCUMENTS_BUCKET", value = var.documents_bucket_name },
  ]

  # Secrets injected from Secrets Manager. ECS pulls these and exposes as env
  # vars - the application reads them via process.env.
  common_secrets = [
    { name = "DATABASE_URL", valueFrom = "${var.db_secret_arn}:DATABASE_URL::" },
    { name = "BEDROCK_AWS_ACCESS_KEY_ID", valueFrom = "${aws_secretsmanager_secret.bedrock.arn}:BEDROCK_AWS_ACCESS_KEY_ID::" },
    { name = "BEDROCK_AWS_SECRET_ACCESS_KEY", valueFrom = "${aws_secretsmanager_secret.bedrock.arn}:BEDROCK_AWS_SECRET_ACCESS_KEY::" },
  ]
}

resource "aws_ecs_task_definition" "query" {
  family                   = "${var.name_prefix}-query"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.query_cpu
  memory                   = var.query_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64" # match `docker build --platform linux/amd64`
  }

  container_definitions = jsonencode([
    {
      name      = "query"
      image     = var.query_image
      essential = true

      portMappings = [
        {
          containerPort = var.container_port
          hostPort      = var.container_port
          protocol      = "tcp"
        }
      ]

      environment = local.common_env
      secrets     = local.common_secrets

      healthCheck = {
        command     = ["CMD-SHELL", "wget -qO- http://localhost:${var.container_port}/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.query.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "query"
        }
      }
    }
  ])

  tags = merge(var.tags, { Name = "${var.name_prefix}-query-task" })
}
