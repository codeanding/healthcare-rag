variable "aws_region" {
  description = "Region everything lives in (except Bedrock, which uses its own creds and region)."
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "Local AWS CLI profile used for the primary account."
  type        = string
  default     = "codeanding"
}

variable "name_prefix" {
  description = "Prefix for every resource. Example: aws-rag-dev → aws-rag-dev-vpc, aws-rag-dev-cluster, etc."
  type        = string
  default     = "aws-rag-dev"
}

variable "documents_bucket_name" {
  description = "Globally unique name for the documents bucket."
  type        = string
  default     = "codeanding-aws-rag-dev-docs"
}

variable "documents_bucket_force_destroy" {
  description = "Allow terraform destroy to drop the bucket even with objects. Dev: true, prod: false."
  type        = bool
  default     = true
}

variable "image_tag" {
  description = "Tag of the query+ingestion images in ECR. Bump this and re-apply after pushing a new image."
  type        = string
  default     = "latest"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "az_count" {
  type    = number
  default = 2
}

variable "bedrock_llm_model_id" {
  type    = string
  default = "us.anthropic.claude-sonnet-4-6"
}

variable "tags" {
  description = "Tags applied to every resource via provider default_tags."
  type        = map(string)
  default = {
    Project     = "aws-rag"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
