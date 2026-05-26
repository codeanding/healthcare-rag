output "query_repository_url" {
  value = aws_ecr_repository.this["query"].repository_url
}

output "ingestion_repository_url" {
  value = aws_ecr_repository.this["ingestion"].repository_url
}

output "query_repository_arn" {
  value = aws_ecr_repository.this["query"].arn
}

output "ingestion_repository_arn" {
  value = aws_ecr_repository.this["ingestion"].arn
}

output "web_repository_url" {
  value = aws_ecr_repository.this["web"].repository_url
}

output "web_repository_arn" {
  value = aws_ecr_repository.this["web"].arn
}

output "repository_arns" {
  description = "Both ARNs as a list - handy for IAM policies."
  value       = [for r in aws_ecr_repository.this : r.arn]
}
