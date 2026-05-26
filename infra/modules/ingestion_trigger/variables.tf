variable "name_prefix" {
  type = string
}

variable "documents_bucket_name" {
  description = "Bucket whose ObjectCreated events trigger ingestion."
  type        = string
}

variable "documents_bucket_arn" {
  type = string
}

variable "ecs_cluster_arn" {
  type = string
}

variable "ingestion_task_definition_arn" {
  description = "Versioned task definition ARN. EventBridge invokes this with RunTask."
  type        = string
}

variable "ecs_task_role_arn" {
  description = "Task role ARN - EventBridge needs PassRole on this."
  type        = string
}

variable "ecs_execution_role_arn" {
  description = "Execution role ARN - EventBridge also needs PassRole on this."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs to launch the ingestion task in."
  type        = list(string)
}

variable "security_group_id" {
  description = "ECS security group for the ingestion task."
  type        = string
}

variable "key_prefix" {
  description = "Only objects with keys starting with this prefix trigger ingestion. Defaults to all objects."
  type        = string
  default     = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
