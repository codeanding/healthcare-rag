terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

data "aws_caller_identity" "current" {}

# ----- Cluster -----

resource "aws_ecs_cluster" "this" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled" # cheap (~$0 at this scale), gives ECS dashboards
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-cluster" })
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

# ----- Log groups (one per task type) -----

resource "aws_cloudwatch_log_group" "query" {
  name              = "/ecs/${var.name_prefix}/query"
  retention_in_days = var.log_retention_days
  tags              = merge(var.tags, { Component = "query" })
}

resource "aws_cloudwatch_log_group" "ingestion" {
  name              = "/ecs/${var.name_prefix}/ingestion"
  retention_in_days = var.log_retention_days
  tags              = merge(var.tags, { Component = "ingestion" })
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/${var.name_prefix}/migrate"
  retention_in_days = var.log_retention_days
  tags              = merge(var.tags, { Component = "migrate" })
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${var.name_prefix}/web"
  retention_in_days = var.log_retention_days
  tags              = merge(var.tags, { Component = "web" })
}
