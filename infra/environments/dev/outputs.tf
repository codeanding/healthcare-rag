output "alb_dns_name" {
  description = "Public DNS name of the ALB. The demo URL is http://<this>/."
  value       = module.alb.alb_dns_name
}

output "alb_zone_id" {
  description = "Use this for Route53 alias if you point a custom domain at the ALB."
  value       = module.alb.alb_zone_id
}

output "query_repo_url" {
  description = "ECR repo URL for the query image. Tag and push with this prefix."
  value       = module.ecr.query_repository_url
}

output "ingestion_repo_url" {
  value = module.ecr.ingestion_repository_url
}

output "web_repo_url" {
  description = "ECR repo URL for the web (nginx) image."
  value       = module.ecr.web_repository_url
}

output "cluster_name" {
  value = module.ecs.cluster_name
}

output "query_service_name" {
  value = module.ecs.query_service_name
}

output "web_service_name" {
  value = module.ecs.web_service_name
}

output "migrate_task_definition_arn" {
  description = "Run this once after deploy with `aws ecs run-task --task-definition ...`"
  value       = module.ecs.migrate_task_definition_arn
}

output "ingestion_task_definition_arn" {
  value = module.ecs.ingestion_task_definition_arn
}

output "db_secret_name" {
  description = "Secrets Manager secret holding DATABASE_URL + raw fields."
  value       = module.database.secret_name
}

output "db_secret_arn" {
  value = module.database.secret_arn
}

output "documents_bucket_name" {
  value = module.storage.bucket_name
}

output "vpc_id" {
  value = module.network.vpc_id
}

output "private_subnet_ids" {
  value = module.network.private_subnet_ids
}

output "ecs_security_group_id" {
  description = "Pass to `aws ecs run-task --network-configuration` when running the migrate or ingestion task ad-hoc."
  value       = module.network.ecs_security_group_id
}

output "run_migration_command" {
  description = "Copy-paste this to apply Prisma migrations after the first deploy."
  value = format(
    "aws ecs run-task --cluster %s --task-definition %s --launch-type FARGATE --network-configuration 'awsvpcConfiguration={subnets=[%s],securityGroups=[%s],assignPublicIp=DISABLED}' --profile %s --region %s",
    module.ecs.cluster_name,
    module.ecs.migrate_task_definition_arn,
    join(",", module.network.private_subnet_ids),
    module.network.ecs_security_group_id,
    var.aws_profile,
    var.aws_region,
  )
}
