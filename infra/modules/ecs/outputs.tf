output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "query_service_name" {
  value = aws_ecs_service.query.name
}

output "query_task_definition_arn" {
  value = aws_ecs_task_definition.query.arn
}

output "web_service_name" {
  value = aws_ecs_service.web.name
}

output "web_task_definition_arn" {
  value = aws_ecs_task_definition.web.arn
}

output "ingestion_task_definition_arn" {
  value = aws_ecs_task_definition.ingestion.arn
}

output "ingestion_task_definition_family" {
  value = aws_ecs_task_definition.ingestion.family
}

output "migrate_task_definition_arn" {
  value = aws_ecs_task_definition.migrate.arn
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}
