variable "name_prefix" {
  description = "Prefix for resource names. Stays under the 32-char ALB limit."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Public subnet IDs for the internet-facing ALB."
  type        = list(string)
}

variable "security_group_id" {
  description = "ALB security group (created by the network module)."
  type        = string
}

variable "query_container_port" {
  description = "Port the query container listens on. Matches Dockerfile EXPOSE."
  type        = number
  default     = 3000
}

variable "query_health_check_path" {
  type    = string
  default = "/health"
}

variable "web_container_port" {
  description = "Port nginx listens on inside the web container."
  type        = number
  default     = 80
}

variable "web_health_check_path" {
  type    = string
  default = "/health"
}

variable "idle_timeout_seconds" {
  description = "ALB idle timeout. SSE streams need ≥ max expected response time."
  type        = number
  default     = 300
}

variable "tags" {
  type    = map(string)
  default = {}
}
