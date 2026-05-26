#!/usr/bin/env bash
# Orchestrates the AWS deploy → validate → destroy lifecycle for the demo.
# Each subcommand maps 1:1 to a step in infra/README.md.
#
#   ./infra/deploy.sh all        # full deploy (~10 min wall time)
#   ./infra/deploy.sh smoke      # quick health check via the ALB
#   ./infra/deploy.sh destroy    # tear everything down
#
# Designed for "deploy once, validate, destroy" — not a long-running CI/CD
# pipeline. Re-run individual phases as you iterate.

set -euo pipefail

# ---------- config ----------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BOOTSTRAP_DIR="$SCRIPT_DIR/bootstrap"
DEV_DIR="$SCRIPT_DIR/environments/dev"

AWS_PROFILE="${AWS_PROFILE:-codeanding}"
AWS_REGION="${AWS_REGION:-us-west-2}"
STATE_BUCKET="${STATE_BUCKET:-codeanding-aws-rag-tfstate}"

# ---------- helpers ----------

log()  { printf "\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m! %s\033[0m\n" "$*" >&2; }
err()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; }

require() {
  command -v "$1" >/dev/null 2>&1 || { err "Missing $1 — install it and retry."; exit 1; }
}

confirm() {
  local prompt="${1:-Continue?}"
  read -r -p "$prompt (y/N) " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { log "Aborted."; exit 0; }
}

tfout() {
  (cd "$DEV_DIR" && terraform output -raw "$1")
}

# Active account/identity for the configured profile. Cached after first call.
AWS_ACCOUNT_ID=""
AWS_IDENTITY_ARN=""

preflight() {
  [[ -n "$AWS_ACCOUNT_ID" ]] && return

  local identity
  if ! identity="$(aws sts get-caller-identity --profile "$AWS_PROFILE" --output json 2>&1)"; then
    err "Cannot authenticate with profile '$AWS_PROFILE'."
    err "Configure it first: aws configure --profile $AWS_PROFILE"
    err "Or override:        AWS_PROFILE=other ./infra/deploy.sh ..."
    err "----- raw sts error -----"
    err "$identity"
    exit 1
  fi

  AWS_ACCOUNT_ID="$(echo "$identity" | jq -r .Account)"
  AWS_IDENTITY_ARN="$(echo "$identity" | jq -r .Arn)"

  printf "\033[1;35m──────────────────────────────────────────────\033[0m\n"
  printf "  \033[1;35mProfile:\033[0m  %s\n" "$AWS_PROFILE"
  printf "  \033[1;35mAccount:\033[0m  %s\n" "$AWS_ACCOUNT_ID"
  printf "  \033[1;35mIdentity:\033[0m %s\n" "$AWS_IDENTITY_ARN"
  printf "  \033[1;35mRegion:\033[0m   %s\n" "$AWS_REGION"
  printf "\033[1;35m──────────────────────────────────────────────\033[0m\n"
}

# Common -var flags so Terraform's provider uses the same profile/region
# the script is driving (no relying on variable defaults).
tf_vars=(
  -var="aws_profile=$AWS_PROFILE"
  -var="aws_region=$AWS_REGION"
)

# ---------- commands ----------

cmd_bootstrap() {
  log "Bootstrapping state bucket: $STATE_BUCKET"
  cd "$BOOTSTRAP_DIR"
  terraform init -input=false
  terraform apply -auto-approve \
    -var="bucket_name=$STATE_BUCKET" \
    -var="profile=$AWS_PROFILE" \
    -var="region=$AWS_REGION"
  ok "State bucket ready"
}

cmd_apply() {
  log "Applying dev environment (~5 min)"

  # Chicken-and-egg: dev uses the state bucket as its backend, so bootstrap
  # must have created it already. Fail fast with a clear pointer otherwise.
  if ! aws s3api head-bucket \
        --bucket "$STATE_BUCKET" \
        --profile "$AWS_PROFILE" \
        --region "$AWS_REGION" \
        2>/dev/null; then
    err "State bucket '$STATE_BUCKET' doesn't exist in account $AWS_ACCOUNT_ID."
    err "Run this first: $0 bootstrap"
    exit 1
  fi

  cd "$DEV_DIR"
  [[ -f terraform.tfvars ]] || {
    log "No terraform.tfvars — copying from example"
    cp terraform.tfvars.example terraform.tfvars
  }
  terraform init -input=false
  terraform plan -input=false "${tf_vars[@]}" -out=tfplan
  terraform apply -input=false tfplan
  rm -f tfplan
  warn "Services will be unhealthy until images are pushed (next step)"
  ok "Infrastructure applied"
}

cmd_push() {
  log "Building + pushing 3 images (api → query, api → ingestion, web)"

  local query_repo ingestion_repo web_repo registry
  query_repo="$(tfout query_repo_url)"
  ingestion_repo="$(tfout ingestion_repo_url)"
  web_repo="$(tfout web_repo_url)"
  registry="${query_repo%%/*}"

  log "Logging in to $registry"
  aws ecr get-login-password --region "$AWS_REGION" --profile "$AWS_PROFILE" \
    | docker login --username AWS --password-stdin "$registry"

  cd "$REPO_ROOT"

  log "Building api image"
  docker build --platform linux/amd64 -t healthcare-rag-api -f apps/api/Dockerfile .

  log "Pushing api → query repo"
  docker tag healthcare-rag-api:latest "$query_repo:latest"
  docker push "$query_repo:latest"

  log "Pushing api → ingestion repo (same image, different entrypoint at runtime)"
  docker tag healthcare-rag-api:latest "$ingestion_repo:latest"
  docker push "$ingestion_repo:latest"

  log "Building web image"
  docker build --platform linux/amd64 -t healthcare-rag-web -f apps/web/Dockerfile .

  log "Pushing web → web repo"
  docker tag healthcare-rag-web:latest "$web_repo:latest"
  docker push "$web_repo:latest"

  ok "All 3 images pushed with :latest"
}

cmd_migrate() {
  log "Running Prisma migration as a one-shot ECS task"

  local cluster task_def subnet_ids sg
  cluster="$(tfout cluster_name)"
  task_def="$(tfout migrate_task_definition_arn)"
  subnet_ids="$(cd "$DEV_DIR" && terraform output -json private_subnet_ids | jq -r 'join(",")')"
  sg="$(tfout ecs_security_group_id)"

  local task_arn
  task_arn="$(aws ecs run-task \
    --cluster "$cluster" \
    --task-definition "$task_def" \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$subnet_ids],securityGroups=[$sg],assignPublicIp=DISABLED}" \
    --profile "$AWS_PROFILE" --region "$AWS_REGION" \
    --query 'tasks[0].taskArn' --output text)"

  log "Task started: ${task_arn##*/}"
  log "Waiting for it to finish (up to ~2 min)..."
  aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task_arn" \
    --profile "$AWS_PROFILE" --region "$AWS_REGION"

  local exit_code
  exit_code="$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" \
    --profile "$AWS_PROFILE" --region "$AWS_REGION" \
    --query 'tasks[0].containers[0].exitCode' --output text)"

  if [[ "$exit_code" != "0" ]]; then
    err "Migration failed (exit $exit_code). Check CloudWatch: /ecs/aws-rag-dev/migrate"
    exit 1
  fi
  ok "Migration applied"
}

cmd_redeploy() {
  log "Forcing new deployments of query + web services"

  local cluster query_service web_service
  cluster="$(tfout cluster_name)"
  query_service="$(tfout query_service_name)"
  web_service="$(tfout web_service_name)"

  aws ecs update-service --cluster "$cluster" --service "$query_service" --force-new-deployment \
    --profile "$AWS_PROFILE" --region "$AWS_REGION" >/dev/null
  aws ecs update-service --cluster "$cluster" --service "$web_service" --force-new-deployment \
    --profile "$AWS_PROFILE" --region "$AWS_REGION" >/dev/null

  log "Waiting for both services to reach steady state (~2 min)..."
  aws ecs wait services-stable \
    --cluster "$cluster" \
    --services "$query_service" "$web_service" \
    --profile "$AWS_PROFILE" --region "$AWS_REGION"
  ok "Both services healthy"
}

cmd_smoke() {
  local alb
  alb="$(tfout alb_dns_name)"

  log "Smoke testing http://$alb"

  local failed=0
  check_path() {
    local path="$1" label="$2"
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "http://$alb$path")
    if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
      printf "  \033[1;32m✓\033[0m  %-22s %s\n" "$path ($label)" "$code"
    else
      printf "  \033[1;31m✗\033[0m  %-22s %s\n" "$path ($label)" "$code"
      failed=1
    fi
  }

  check_path "/health" "web nginx"
  check_path "/" "SPA"
  check_path "/api/patients" "api"

  if [[ $failed -eq 1 ]]; then
    err "One or more endpoints returned non-2xx. Check target group health and service events."
    exit 1
  fi
  ok "Open http://$alb in a browser"
}

cmd_destroy() {
  warn "About to destroy ALL dev infrastructure in account $AWS_ACCOUNT_ID (profile: $AWS_PROFILE)."
  warn "RDS, ECS, ALB, VPC, ECR images — all gone. State bucket is preserved."
  confirm "Proceed with destroy?"
  cd "$DEV_DIR"
  terraform destroy -input=false -auto-approve "${tf_vars[@]}"
  ok "Infrastructure destroyed"
}

cmd_all() {
  warn "Full deploy creates real AWS resources. Estimated cost: ~\$0.12/hr running."
  warn "Run '$0 destroy' when done — typical validate-and-destroy runs ~\$0.30-0.50 total."
  confirm "Proceed?"
  cmd_bootstrap
  cmd_apply
  cmd_push
  cmd_migrate
  cmd_redeploy
  cmd_smoke
  echo
  ok "Deploy complete. Demo at http://$(tfout alb_dns_name)"
  log "When finished: $0 destroy"
}

cmd_help() {
  cat <<EOF
deploy.sh — orchestrates the AWS deploy → validate → destroy lifecycle

Usage: $0 <command>

Commands:
  bootstrap   Create the S3 state bucket (one-time per AWS account)
  apply       terraform apply the dev environment (VPC, RDS, ECR, ALB, ECS, EventBridge)
  push        Build + push 3 images: api → query, api → ingestion, web → web
  migrate     Run Prisma migration as a one-shot ECS task, wait for exit code
  redeploy    Force new deployment of query + web services, wait for stable
  smoke       Curl /health, /, /api/patients via the ALB DNS name
  destroy     terraform destroy the dev environment (state bucket preserved)
  all         Run: bootstrap → apply → push → migrate → redeploy → smoke
  help        Show this message

Environment overrides:
  AWS_PROFILE    (default: codeanding)
  AWS_REGION     (default: us-west-2)
  STATE_BUCKET   (default: codeanding-aws-rag-tfstate)

Prereqs: terraform >= 1.10, aws CLI, docker, jq
EOF
}

# ---------- main ----------

case "${1:-help}" in
  help|--help|-h) cmd_help; exit 0 ;;
esac

require aws
require docker
require terraform
require jq

# Confirms which AWS account/profile we're about to act on. Prints once.
preflight

case "${1:-help}" in
  bootstrap)        cmd_bootstrap ;;
  apply)            cmd_apply ;;
  push)             cmd_push ;;
  migrate)          cmd_migrate ;;
  redeploy)         cmd_redeploy ;;
  smoke)            cmd_smoke ;;
  destroy)          cmd_destroy ;;
  all)              cmd_all ;;
  *)                err "Unknown command: $1"; echo; cmd_help; exit 1 ;;
esac
