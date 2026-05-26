# One-shot migration task. Same image as query, different command. Run after
# every image push that includes new Prisma migrations:
#
#   aws ecs run-task \
#     --cluster <cluster> \
#     --task-definition <migrate-task-arn> \
#     --launch-type FARGATE \
#     --network-configuration 'awsvpcConfiguration={subnets=[...],securityGroups=[...],assignPublicIp=DISABLED}' \
#     --profile codeanding --region us-west-2

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name_prefix}-migrate"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.query_cpu
  memory                   = var.query_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = var.query_image # same image as query - Prisma CLI is in node_modules
      essential = true

      command = [
        "node_modules/.bin/prisma",
        "migrate",
        "deploy",
        "--schema=prisma/schema.prisma"
      ]

      environment = local.common_env
      secrets     = local.common_secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.migrate.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "migrate"
        }
      }
    }
  ])

  tags = merge(var.tags, { Name = "${var.name_prefix}-migrate-task" })
}
