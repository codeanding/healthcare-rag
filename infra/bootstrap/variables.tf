variable "bucket_name" {
  description = "Globally-unique S3 bucket name for Terraform state. Suggested: codeanding-aws-rag-tfstate."
  type        = string
}

variable "region" {
  description = "AWS region for the state bucket. Should match where the rest of the infra lives."
  type        = string
  default     = "us-west-2"
}

variable "profile" {
  description = "AWS CLI named profile with permissions to create the state bucket."
  type        = string
  default     = "codeanding"
}
