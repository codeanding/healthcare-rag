terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

resource "aws_lb" "this" {
  name               = "${var.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.security_group_id]
  subnets            = var.subnet_ids

  idle_timeout               = var.idle_timeout_seconds
  enable_deletion_protection = false
  drop_invalid_header_fields = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-alb" })
}

# ----- Target groups -----

resource "aws_lb_target_group" "query" {
  name        = "${var.name_prefix}-query-tg"
  port        = var.query_container_port
  protocol    = "HTTP"
  target_type = "ip" # Fargate awsvpc tasks attach by ENI IP, not instance
  vpc_id      = var.vpc_id

  deregistration_delay = 30 # quick deploys for the demo

  health_check {
    enabled             = true
    path                = var.query_health_check_path
    port                = "traffic-port"
    protocol            = "HTTP"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-query-tg" })
}

resource "aws_lb_target_group" "web" {
  name        = "${var.name_prefix}-web-tg"
  port        = var.web_container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  deregistration_delay = 30

  health_check {
    enabled             = true
    path                = var.web_health_check_path
    port                = "traffic-port"
    protocol            = "HTTP"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-web-tg" })
}

# ----- Listener + rules -----
# Routing strategy:
#   /api/*  to query target group (NestJS api)
#   else    to web target group (nginx serving the SPA)

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.query.arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-api-rule" })
}
