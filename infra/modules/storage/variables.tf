variable "bucket_name" {
  description = "Name for the documents S3 bucket. Must be globally unique."
  type        = string
}

variable "force_destroy" {
  description = "If true, terraform destroy will delete the bucket even if it contains objects. Useful in dev, dangerous in prod."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Extra tags."
  type        = map(string)
  default     = {}
}
