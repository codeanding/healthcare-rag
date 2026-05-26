resource "aws_ecs_task_definition" "web" {
  family                   = "${var.name_prefix}-web"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  # Reuses the api task role even though nginx doesn't call AWS APIs - the
  # ECS service API rejects task defs without a task_role_arn at create time.
  task_role_arn = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64" # match `docker build --platform linux/amd64`
  }

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = var.web_image
      essential = true

      portMappings = [
        {
          containerPort = var.web_container_port
          hostPort      = var.web_container_port
          protocol      = "tcp"
        }
      ]

      # nginx itself needs no env vars. The Vite bundle is built with relative
      # /api paths so it talks to whatever origin served the page - the same
      # ALB routes /api/* to the query service.
      environment = []

      healthCheck = {
        command     = ["CMD-SHELL", "wget -qO- http://localhost:${var.web_container_port}/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.web.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "web"
        }
      }
    }
  ])

  tags = merge(var.tags, { Name = "${var.name_prefix}-web-task" })
}
