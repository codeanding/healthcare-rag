variable "name_prefix" {
  description = "Prefix for resource Name tags. Example: aws-rag-dev."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "az_count" {
  description = "Number of AZs to span. Two is the minimum for an ALB."
  type        = number
  default     = 2
}

variable "tags" {
  description = "Extra tags to merge into every resource."
  type        = map(string)
  default     = {}
}
