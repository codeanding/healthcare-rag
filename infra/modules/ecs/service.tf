resource "aws_ecs_service" "query" {
  name            = "${var.name_prefix}-query"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.query.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false # tasks live in private subnets, reach out via VPC endpoints
  }

  load_balancer {
    target_group_arn = var.query_target_group_arn
    container_name   = "query"
    container_port   = var.container_port
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  enable_execute_command = true # `aws ecs execute-command` for in-container debug

  # The task definition's revision changes every apply; the service should
  # update on those changes. ECS deployment circuit breaker auto-rolls back
  # failures.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # ALB target group must exist before the service starts attaching tasks.
  depends_on = [aws_iam_role_policy.task_app]

  tags = merge(var.tags, { Name = "${var.name_prefix}-query-service" })
}
