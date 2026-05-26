variable "name_prefix" {
  description = "Prefix for repo names. Example: aws-rag-dev to aws-rag-dev-query, aws-rag-dev-ingestion."
  type        = string
}

variable "tags" {
  description = "Extra tags."
  type        = map(string)
  default     = {}
}
