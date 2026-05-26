# Bedrock credentials live in Secrets Manager so they don't appear in the task
# definition (which is visible to anyone with ecs:DescribeTaskDefinition).
#
# Terraform creates the secret with placeholder values. The user populates the
# real keys after first apply with:
#
#   aws secretsmanager put-secret-value \
#     --secret-id <secret-name> \
#     --secret-string '{"BEDROCK_AWS_ACCESS_KEY_ID":"AKIA...","BEDROCK_AWS_SECRET_ACCESS_KEY":"..."}' \
#     --profile codeanding --region <region>
#
# `lifecycle { ignore_changes = [secret_string] }` on the version resource
# ensures terraform won't overwrite the user-set value on subsequent applies.

resource "aws_secretsmanager_secret" "bedrock" {
  name                    = "${var.name_prefix}/bedrock"
  description             = "Inline access keys for the secondary AWS account hosting Bedrock model access"
  recovery_window_in_days = 0

  tags = merge(var.tags, { Name = "${var.name_prefix}-bedrock-secret" })
}

resource "aws_secretsmanager_secret_version" "bedrock" {
  secret_id = aws_secretsmanager_secret.bedrock.id

  secret_string = jsonencode({
    BEDROCK_AWS_ACCESS_KEY_ID     = "REPLACE_ME"
    BEDROCK_AWS_SECRET_ACCESS_KEY = "REPLACE_ME"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}
