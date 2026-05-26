terraform {
  required_version = ">= 1.10.0"

  # Native S3 state locking — Terraform 1.10+ writes a sibling .tflock object
  # using S3 conditional writes. No DynamoDB required.
  backend "s3" {
    bucket       = "codeanding-aws-rag-tfstate"
    key          = "dev/terraform.tfstate"
    region       = "us-west-2"
    profile      = "codeanding"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = var.tags
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
}

# ----- Network -----

module "network" {
  source      = "../../modules/network"
  name_prefix = var.name_prefix
  vpc_cidr    = var.vpc_cidr
  az_count    = var.az_count
}

# ----- ECR -----

module "ecr" {
  source      = "../../modules/ecr"
  name_prefix = var.name_prefix
}

# ----- S3 documents bucket -----

module "storage" {
  source        = "../../modules/storage"
  bucket_name   = var.documents_bucket_name
  force_destroy = var.documents_bucket_force_destroy
}

# ----- RDS Postgres + pgvector -----

module "database" {
  source               = "../../modules/database"
  name_prefix          = var.name_prefix
  subnet_ids           = module.network.private_subnet_ids
  db_security_group_id = module.network.db_security_group_id
}

# ----- ALB -----

module "alb" {
  source            = "../../modules/alb"
  name_prefix       = var.name_prefix
  vpc_id            = module.network.vpc_id
  subnet_ids        = module.network.public_subnet_ids
  security_group_id = module.network.alb_security_group_id
}

# ----- ECS cluster + tasks + service -----

module "ecs" {
  source                 = "../../modules/ecs"
  name_prefix            = var.name_prefix
  subnet_ids             = module.network.private_subnet_ids
  ecs_security_group_id  = module.network.ecs_security_group_id
  query_target_group_arn = module.alb.query_target_group_arn
  web_target_group_arn   = module.alb.web_target_group_arn

  # Image references — first apply, these images don't exist yet. Services
  # will be unhealthy until you `docker push` and force a new deployment.
  query_image     = "${module.ecr.query_repository_url}:${var.image_tag}"
  ingestion_image = "${module.ecr.ingestion_repository_url}:${var.image_tag}"
  web_image       = "${module.ecr.web_repository_url}:${var.image_tag}"

  db_secret_arn         = module.database.secret_arn
  documents_bucket_name = module.storage.bucket_name
  documents_bucket_arn  = module.storage.bucket_arn

  aws_region           = var.aws_region
  bedrock_llm_model_id = var.bedrock_llm_model_id
}

# ----- EventBridge → ECS RunTask for ingestion -----

module "ingestion_trigger" {
  source                        = "../../modules/ingestion_trigger"
  name_prefix                   = var.name_prefix
  documents_bucket_name         = module.storage.bucket_name
  documents_bucket_arn          = module.storage.bucket_arn
  ecs_cluster_arn               = module.ecs.cluster_arn
  ingestion_task_definition_arn = module.ecs.ingestion_task_definition_arn
  ecs_task_role_arn             = module.ecs.task_role_arn
  ecs_execution_role_arn        = module.ecs.execution_role_arn
  subnet_ids                    = module.network.private_subnet_ids
  security_group_id             = module.network.ecs_security_group_id

  # Only ingest objects under patients/. Lets you upload non-trigger files
  # (e.g., utility scripts, dataset dumps) to the same bucket without firing
  # the ingestion task.
  key_prefix = "patients/"
}
