output "rule_arn" {
  value = aws_cloudwatch_event_rule.s3_object_created.arn
}

output "rule_name" {
  value = aws_cloudwatch_event_rule.s3_object_created.name
}

output "events_role_arn" {
  value = aws_iam_role.events.arn
}
