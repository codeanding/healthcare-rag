variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs for the DB subnet group."
  type        = list(string)
}

variable "db_security_group_id" {
  description = "Security group attached to the DB instance (created by the network module)."
  type        = string
}

variable "instance_class" {
  description = "RDS instance class. db.t3.micro is free-tier eligible for 12 months."
  type        = string
  default     = "db.t3.micro"
}

variable "allocated_storage" {
  description = "Storage in GB. 20 is the minimum for gp3 on db.t3.micro."
  type        = number
  default     = 20
}

variable "engine_version" {
  description = "Postgres major.minor.patch. RDS deprecates older patch versions over time - check `aws rds describe-db-engine-versions --engine postgres` for current options."
  type        = string
  default     = "16.13"
}

variable "database_name" {
  description = "Database name created on the instance."
  type        = string
  default     = "healthcare_rag"
}

variable "master_username" {
  description = "Master username. Application uses this directly in the demo."
  type        = string
  default     = "rag_app"
}

variable "tags" {
  description = "Extra tags."
  type        = map(string)
  default     = {}
}
