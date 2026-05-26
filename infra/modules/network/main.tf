terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_region" "current" {}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  # /20 subnets give 4096 IPs each - overkill but trivially future-proof.
  public_subnet_cidrs  = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 4, i)]
  private_subnet_cidrs = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 4, i + 8)]
}

# ----- VPC + IGW -----

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true # required for VPC interface endpoints with PrivateDNS

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpc" })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(var.tags, { Name = "${var.name_prefix}-igw" })
}

# ----- Subnets -----

resource "aws_subnet" "public" {
  count                   = var.az_count
  vpc_id                  = aws_vpc.main.id
  cidr_block              = local.public_subnet_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true # only used by the ALB; ECS runs in private subnets

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-public-${local.azs[count.index]}"
    Tier = "public"
  })
}

resource "aws_subnet" "private" {
  count             = var.az_count
  vpc_id            = aws_vpc.main.id
  cidr_block        = local.private_subnet_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-private-${local.azs[count.index]}"
    Tier = "private"
  })
}

# ----- Route tables -----

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = merge(var.tags, { Name = "${var.name_prefix}-public-rt" })
}

resource "aws_route" "public_default" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count          = var.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Private route table has no default route - there's no NAT. Egress for ECS
# tasks happens via VPC endpoints (interface endpoints attach ENIs to these
# subnets; the S3 gateway endpoint adds a prefix-list route here).
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = merge(var.tags, { Name = "${var.name_prefix}-private-rt" })
}

resource "aws_route_table_association" "private" {
  count          = var.az_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# ----- Security groups -----

# ALB: HTTP from internet, egress to ECS only.
resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb"
  description = "ALB ingress from internet, egress to ECS tasks"
  vpc_id      = aws_vpc.main.id
  tags        = merge(var.tags, { Name = "${var.name_prefix}-alb" })
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
  description       = "HTTP from internet"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_ecs" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.ecs.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
  description                  = "ALB to ECS query container port"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_ecs_web" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.ecs.id
  from_port                    = 80
  to_port                      = 80
  ip_protocol                  = "tcp"
  description                  = "ALB to ECS web (nginx) container port"
}

# ECS tasks: ingress from ALB only, egress to DB + VPC endpoints.
resource "aws_security_group" "ecs" {
  name        = "${var.name_prefix}-ecs"
  description = "ECS Fargate tasks (query + ingestion)"
  vpc_id      = aws_vpc.main.id
  tags        = merge(var.tags, { Name = "${var.name_prefix}-ecs" })
}

resource "aws_vpc_security_group_ingress_rule" "ecs_from_alb" {
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
  description                  = "ALB to query container"
}

resource "aws_vpc_security_group_ingress_rule" "ecs_from_alb_web" {
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 80
  to_port                      = 80
  ip_protocol                  = "tcp"
  description                  = "ALB to web (nginx) container"
}

resource "aws_vpc_security_group_egress_rule" "ecs_to_db" {
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = aws_security_group.db.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "ECS to RDS Postgres"
}

resource "aws_vpc_security_group_egress_rule" "ecs_to_vpce" {
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = aws_security_group.vpce.id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "ECS to VPC endpoints (Bedrock, ECR, Secrets, Logs)"
}

# ECR image pulls fetch layers from S3, which goes through the S3 Gateway
# endpoint - but the Gateway endpoint has no SG of its own, so the source SG
# must permit egress to the S3 prefix list directly. Without this rule the
# ECR pull stalls trying to reach public S3 IPs from a private subnet.
resource "aws_vpc_security_group_egress_rule" "ecs_to_s3" {
  security_group_id = aws_security_group.ecs.id
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "ECS to S3 gateway endpoint (ECR layer storage)"
}

# RDS: ingress from ECS only.
resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db"
  description = "RDS Postgres - accepts from ECS tasks only"
  vpc_id      = aws_vpc.main.id
  tags        = merge(var.tags, { Name = "${var.name_prefix}-db" })
}

resource "aws_vpc_security_group_ingress_rule" "db_from_ecs" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.ecs.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "ECS to Postgres"
}

# VPC endpoints: ingress :443 from ECS only.
resource "aws_security_group" "vpce" {
  name        = "${var.name_prefix}-vpce"
  description = "VPC interface endpoints - accepts HTTPS from ECS only"
  vpc_id      = aws_vpc.main.id
  tags        = merge(var.tags, { Name = "${var.name_prefix}-vpce" })
}

resource "aws_vpc_security_group_ingress_rule" "vpce_from_ecs" {
  security_group_id            = aws_security_group.vpce.id
  referenced_security_group_id = aws_security_group.ecs.id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "ECS to endpoint TLS"
}

# ----- VPC endpoints -----
# S3 is a gateway endpoint (free, route-table based). The rest are interface
# endpoints (~$7/mo each + per-GB processed). Without these we'd need a NAT
# Gateway (~$32/mo + per-GB), so the trade-off favours endpoints at any
# meaningful traffic volume.

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-s3" })
}

locals {
  interface_endpoints = {
    bedrock_runtime = "com.amazonaws.${data.aws_region.current.name}.bedrock-runtime"
    ecr_api         = "com.amazonaws.${data.aws_region.current.name}.ecr.api"
    ecr_dkr         = "com.amazonaws.${data.aws_region.current.name}.ecr.dkr"
    secretsmanager  = "com.amazonaws.${data.aws_region.current.name}.secretsmanager"
    logs            = "com.amazonaws.${data.aws_region.current.name}.logs"
  }
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.interface_endpoints

  vpc_id              = aws_vpc.main.id
  service_name        = each.value
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpce.id]
  private_dns_enabled = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-${each.key}" })
}
