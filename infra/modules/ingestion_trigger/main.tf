terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

# ----- EventBridge rule: matches S3 ObjectCreated on the docs bucket -----

resource "aws_cloudwatch_event_rule" "s3_object_created" {
  name        = "${var.name_prefix}-s3-ingest"
  description = "Fire ECS ingestion task when an object is created in the docs bucket"

  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
    detail = {
      bucket = { name = [var.documents_bucket_name] }
      object = var.key_prefix == "" ? null : {
        key = [{ prefix = var.key_prefix }]
      }
    }
  })

  tags = merge(var.tags, { Name = "${var.name_prefix}-s3-ingest-rule" })
}

# ----- IAM role for EventBridge to ECS RunTask -----

data "aws_iam_policy_document" "events_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "events" {
  name               = "${var.name_prefix}-events-runtask"
  assume_role_policy = data.aws_iam_policy_document.events_assume.json
  tags               = var.tags
}

# Permissions: RunTask on the ingestion task definition family + PassRole on
# both ECS roles (execution + task). PassRole is what bites people most often
# - without it, EventBridge can RunTask but the task fails to start.
data "aws_iam_policy_document" "events_runtask" {
  statement {
    sid     = "RunTask"
    actions = ["ecs:RunTask"]
    # Match all revisions of the ingestion task family (the version number
    # at the end changes on each apply).
    resources = ["${replace(var.ingestion_task_definition_arn, "/:[0-9]+$/", "")}:*"]
    condition {
      test     = "ArnLike"
      variable = "ecs:cluster"
      values   = [var.ecs_cluster_arn]
    }
  }

  statement {
    sid     = "PassRoles"
    actions = ["iam:PassRole"]
    resources = [
      var.ecs_task_role_arn,
      var.ecs_execution_role_arn,
    ]
    condition {
      test     = "StringLike"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "events_runtask" {
  name   = "${var.name_prefix}-events-runtask"
  role   = aws_iam_role.events.id
  policy = data.aws_iam_policy_document.events_runtask.json
}

# ----- Target: ECS RunTask with input transformer -----
# The input_transformer pulls the S3 bucket + key from the event and injects
# them as env vars on the ingestion container, so the script reads
# S3_INGEST_BUCKET / S3_INGEST_KEY at runtime.

resource "aws_cloudwatch_event_target" "ecs_runtask" {
  rule     = aws_cloudwatch_event_rule.s3_object_created.name
  arn      = var.ecs_cluster_arn
  role_arn = aws_iam_role.events.arn

  ecs_target {
    task_definition_arn = var.ingestion_task_definition_arn
    launch_type         = "FARGATE"
    task_count          = 1

    network_configuration {
      subnets          = var.subnet_ids
      security_groups  = [var.security_group_id]
      assign_public_ip = false
    }
  }

  input_transformer {
    input_paths = {
      bucket = "$.detail.bucket.name"
      key    = "$.detail.object.key"
    }

    # The container runtime sees these env vars merged with what's in the
    # task definition. The application script is responsible for parsing the
    # key (e.g., extracting patient_id from a path like patients/<id>/...).
    input_template = <<-EOT
      {
        "containerOverrides": [
          {
            "name": "ingestion",
            "environment": [
              { "name": "S3_INGEST_BUCKET", "value": <bucket> },
              { "name": "S3_INGEST_KEY", "value": <key> }
            ]
          }
        ]
      }
    EOT
  }
}
