terraform {
  required_version = ">= 1.10.0"
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

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db"
  subnet_ids = var.subnet_ids
  tags       = merge(var.tags, { Name = "${var.name_prefix}-db-subnet-group" })
}

# pgvector requires no shared_preload_libraries. The extension is created at
# runtime by Prisma migration: `CREATE EXTENSION vector`. The master user has
# permission to do so out of the box on RDS Postgres 16.
resource "aws_db_parameter_group" "this" {
  name        = "${var.name_prefix}-pg16"
  family      = "postgres16"
  description = "Custom params for ${var.name_prefix} Postgres 16"

  # Allow non-SSL connections in dev. In prod, set rds.force_ssl=1 and
  # require sslmode=verify-full on the client.
  parameter {
    name  = "rds.force_ssl"
    value = "0"
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-pg16" })
}

resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_db_instance" "this" {
  identifier = "${var.name_prefix}-postgres"

  engine                      = "postgres"
  engine_version              = var.engine_version
  instance_class              = var.instance_class
  allocated_storage           = var.allocated_storage
  max_allocated_storage       = var.allocated_storage * 2 # autoscale storage up to 2x
  storage_type                = "gp3"
  storage_encrypted           = true
  allow_major_version_upgrade = false
  auto_minor_version_upgrade  = true

  db_name  = var.database_name
  username = var.master_username
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.db_security_group_id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false

  multi_az                = false # single-AZ in dev (multi-AZ doubles the cost)
  backup_retention_period = 7
  backup_window           = "07:00-08:00"
  maintenance_window      = "Sun:08:00-Sun:09:00"

  # Demo posture - easy teardown. In prod use deletion_protection=true,
  # skip_final_snapshot=false.
  deletion_protection      = false
  skip_final_snapshot      = true
  delete_automated_backups = true

  performance_insights_enabled = false

  tags = merge(var.tags, { Name = "${var.name_prefix}-postgres" })
}

# ----- Secrets Manager: DATABASE_URL + raw fields -----

resource "aws_secretsmanager_secret" "db" {
  name        = "${var.name_prefix}/database"
  description = "Postgres credentials + DATABASE_URL for the ECS task"
  # Recovery window 0 lets us recreate immediately during dev iteration.
  # In prod, set this to 7-30 days for accidental-delete protection.
  recovery_window_in_days = 0

  tags = merge(var.tags, { Name = "${var.name_prefix}-db-secret" })
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    username = var.master_username
    password = random_password.db.result
    host     = aws_db_instance.this.address
    port     = aws_db_instance.this.port
    dbname   = var.database_name
    # Prisma URL - the ECS task injects this directly as DATABASE_URL.
    DATABASE_URL = "postgresql://${var.master_username}:${urlencode(random_password.db.result)}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${var.database_name}?schema=public&sslmode=prefer"
  })
}
