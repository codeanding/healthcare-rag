output "alb_arn" {
  value = aws_lb.this.arn
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_zone_id" {
  description = "For Route53 alias records when you add a custom domain."
  value       = aws_lb.this.zone_id
}

output "query_target_group_arn" {
  value = aws_lb_target_group.query.arn
}

output "web_target_group_arn" {
  value = aws_lb_target_group.web.arn
}
