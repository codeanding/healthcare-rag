variable "name_prefix" {
  description = "Prefix for cluster, service, task def, log group, IAM role names."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs for ECS tasks."
  type        = list(string)
}

variable "ecs_security_group_id" {
  description = "Security group attached to all ECS tasks."
  type        = string
}

variable "query_target_group_arn" {
  description = "ALB target group the query service registers with."
  type        = string
}

variable "web_target_group_arn" {
  description = "ALB target group the web service registers with."
  type        = string
}

variable "query_image" {
  description = "Full ECR image URI for the query service. Example: 123.dkr.ecr.us-west-2.amazonaws.com/aws-rag-dev-query:latest"
  type        = string
}

variable "ingestion_image" {
  description = "Full ECR image URI for the ingestion task."
  type        = string
}

variable "web_image" {
  description = "Full ECR image URI for the web (nginx) service."
  type        = string
}

variable "container_port" {
  type    = number
  default = 3000
}

variable "web_container_port" {
  description = "Port nginx listens on inside the web container."
  type        = number
  default     = 80
}

variable "query_cpu" {
  description = "Fargate CPU units for the query service. 512 = 0.5 vCPU."
  type        = number
  default     = 512
}

variable "query_memory" {
  description = "Fargate memory MiB. 1024 = 1 GB."
  type        = number
  default     = 1024
}

variable "ingestion_cpu" {
  type    = number
  default = 512
}

variable "ingestion_memory" {
  type    = number
  default = 1024
}

variable "web_cpu" {
  description = "Fargate CPU for the web (nginx) service. 256 = 0.25 vCPU is plenty."
  type        = number
  default     = 256
}

variable "web_memory" {
  description = "Fargate memory MiB. 512 MiB is the minimum for 0.25 vCPU."
  type        = number
  default     = 512
}

variable "db_secret_arn" {
  description = "ARN of the Secrets Manager entry holding DATABASE_URL."
  type        = string
}

variable "documents_bucket_name" {
  description = "S3 bucket the ingestion task reads documents from."
  type        = string
}

variable "documents_bucket_arn" {
  description = "S3 bucket ARN - used in the task role policy."
  type        = string
}

variable "aws_region" {
  description = "Region the cluster runs in. Set as AWS_REGION env var on tasks."
  type        = string
}

variable "bedrock_llm_model_id" {
  description = "Cross-region inference profile id, e.g. us.anthropic.claude-sonnet-4-6"
  type        = string
  default     = "us.anthropic.claude-sonnet-4-6"
}

variable "bedrock_embedding_model_id" {
  type    = string
  default = "amazon.titan-embed-text-v2:0"
}

variable "bedrock_note_synth_model_id" {
  type    = string
  default = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "bedrock_aws_region" {
  description = "Region for the Bedrock client (may differ from cluster region)."
  type        = string
  default     = "us-west-2"
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "tags" {
  type    = map(string)
  default = {}
}
