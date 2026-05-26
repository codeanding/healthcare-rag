# Infrastructure (Terraform)

Deploys the patient-RAG application to AWS: VPC + RDS Postgres + ECR + ECS Fargate (query service + web service + ingestion task) + ALB (path-based routing: `/api/*` → query, else → web) + EventBridge ingestion trigger. **No NAT Gateway** — uses VPC endpoints. **No DynamoDB** — uses Terraform 1.10+ native S3 state locking.

> Region: `us-west-2` · Profile: `codeanding` (primary account) · Bedrock: separate account via Secrets Manager.

## Prerequisites

- Terraform `>= 1.10.0` (for `use_lockfile`)
- AWS CLI configured with the `codeanding` profile
- Docker (to build + push images)
- The local app working — you've completed the local demo and confirmed everything works at `localhost:5173`

## Layout

```
infra/
├── bootstrap/             — creates the S3 state bucket (one-time, local state)
├── modules/
│   ├── network/           — VPC, subnets, SGs, 5 interface VPC endpoints + S3 gateway
│   ├── ecr/               — query + ingestion + web repos with lifecycle
│   ├── storage/           — documents S3 bucket with EventBridge enabled
│   ├── database/          — RDS db.t3.micro Postgres 16 + Secrets Manager
│   ├── alb/               — ALB + HTTP listener + 2 target groups + /api/* rule (idle 300s for SSE)
│   ├── ecs/               — cluster, IAM, query/web/ingestion/migrate task defs, query+web services
│   └── ingestion_trigger/ — EventBridge rule on S3 → ECS RunTask
└── environments/dev/      — wires everything together
```

## Quick start (scripted)

The whole flow below is wrapped in `infra/deploy.sh` — one script with subcommands. Skip to the manual sections if you want to understand each step or run them à la carte.

```bash
./infra/deploy.sh all       # bootstrap → apply → secrets → push → migrate → redeploy → smoke (~10 min)
./infra/deploy.sh smoke     # re-run the curl checks anytime
./infra/deploy.sh destroy   # tear down (state bucket preserved)
./infra/deploy.sh help      # all subcommands
```

The script reads `BEDROCK_AWS_ACCESS_KEY_ID` / `BEDROCK_AWS_SECRET_ACCESS_KEY` from `.env` at the repo root (or from your shell env). Everything else uses Terraform outputs.

## One-time: bootstrap state

```bash
cd infra/bootstrap
terraform init
terraform apply -auto-approve \
  -var="bucket_name=codeanding-aws-rag-tfstate" \
  -var="profile=codeanding" \
  -var="region=us-west-2"
```

Bootstrap state stays local (gitignored). Re-runs are no-op.

## Per-environment workflow

```bash
cd infra/environments/dev
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars if you want to change anything

terraform init                # picks up the S3 backend with use_lockfile=true
terraform plan -out=tfplan
terraform apply tfplan        # ~5 min
```

Save the outputs:

```bash
terraform output
```

Key outputs you'll use:

- `alb_dns_name` — the demo URL (the SPA loads here, the api lives under `/api/*`)
- `query_repo_url` / `ingestion_repo_url` / `web_repo_url` — push images here
- `cluster_name`, `query_service_name`, `web_service_name` — for `update-service`
- `migrate_task_definition_arn` — run this once to apply Prisma migrations
- `bedrock_secret_name` / `db_secret_name`

## After first apply: 4 manual steps

### 1. Populate Bedrock credentials

Terraform creates the secret with placeholder values. Replace with the real keys from your secondary AWS account:

```bash
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw bedrock_secret_name)" \
  --secret-string '{"BEDROCK_AWS_ACCESS_KEY_ID":"AKIA...","BEDROCK_AWS_SECRET_ACCESS_KEY":"..."}' \
  --profile codeanding --region us-west-2
```

The secret has `lifecycle { ignore_changes = [secret_string] }` — Terraform won't overwrite this on subsequent applies.

### 2. Build + push Docker images

```bash
# Auth Docker to ECR
aws ecr get-login-password --region us-west-2 --profile codeanding | \
  docker login --username AWS --password-stdin \
  "$(terraform output -raw query_repo_url | cut -d/ -f1)"

cd ../../..   # back to repo root

# --- API image (query + ingestion share one image, only entrypoint differs) ---
docker build --platform linux/amd64 -t healthcare-rag-api -f apps/api/Dockerfile .

docker tag healthcare-rag-api:latest "$(cd infra/environments/dev && terraform output -raw query_repo_url):latest"
docker push "$(cd infra/environments/dev && terraform output -raw query_repo_url):latest"

docker tag healthcare-rag-api:latest "$(cd infra/environments/dev && terraform output -raw ingestion_repo_url):latest"
docker push "$(cd infra/environments/dev && terraform output -raw ingestion_repo_url):latest"

# --- Web image (nginx serving the Vite static dist) ---
# VITE_API_URL is empty so the bundle uses relative /api paths — same ALB
# routes /api/* to the query target group.
docker build --platform linux/amd64 -t healthcare-rag-web -f apps/web/Dockerfile .

docker tag healthcare-rag-web:latest "$(cd infra/environments/dev && terraform output -raw web_repo_url):latest"
docker push "$(cd infra/environments/dev && terraform output -raw web_repo_url):latest"
```

### 3. Run the migration task

```bash
cd infra/environments/dev

eval "$(terraform output -raw run_migration_command)"
```

That output renders the full `aws ecs run-task` command with all the right network config plumbed through. Watch it complete:

```bash
aws ecs list-tasks --cluster "$(terraform output -raw cluster_name)" --profile codeanding --region us-west-2
# Wait until the migrate task is gone from the list (it's run-to-completion).
# Check exit code:
aws logs tail "/ecs/$(terraform output -raw cluster_name | sed 's/-cluster$//')-migrate" --profile codeanding --region us-west-2
```

If the migration task fails, inspect the log group `/ecs/aws-rag-dev/migrate` in CloudWatch.

### 4. Force new deployments

The first apply created both services before their images existed, so they're stuck in failed deployments. Force both now:

```bash
CLUSTER="$(terraform output -raw cluster_name)"

aws ecs update-service --cluster "$CLUSTER" \
  --service "$(terraform output -raw query_service_name)" \
  --force-new-deployment --profile codeanding --region us-west-2

aws ecs update-service --cluster "$CLUSTER" \
  --service "$(terraform output -raw web_service_name)" \
  --force-new-deployment --profile codeanding --region us-west-2
```

Wait ~2 min for both tasks to start and pass ALB health checks:

```bash
ALB="http://$(terraform output -raw alb_dns_name)"
curl "$ALB/health"            # → "ok"  (web nginx)
curl "$ALB/api/patients"      # → []    (api, empty until ingestion)
```

## Smoke tests

```bash
ALB="http://$(terraform output -raw alb_dns_name)"

curl "$ALB/health"                       # web nginx → "ok"
curl "$ALB/" -I                          # 200, text/html (the SPA)
curl "$ALB/api/patients" | head -c 200   # api → []  (or list once ingested)
```

Open `$ALB` in a browser → React app loads → patient list populates from `/api/patients`.

## Ingesting data into the deployed system

Two options, your choice:

### A. EventBridge-triggered (production pattern)

Upload an FHIR bundle under `patients/<patient-id>/...` in the docs bucket. The EventBridge rule fires → ECS RunTask launches the ingestion task → it processes the file. **Requires**: an `ingest-from-event` script in the application that reads `S3_INGEST_BUCKET`/`S3_INGEST_KEY` env vars (the task def expects this entrypoint, but it's not implemented yet — the trigger fires, the task starts, fails fast). This is a follow-up.

### B. Run-to-completion task with the existing CLI

```bash
aws ecs run-task \
  --cluster "$(terraform output -raw cluster_name)" \
  --task-definition "$(terraform output -raw ingestion_task_definition_arn)" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$(terraform output -json private_subnet_ids | jq -r 'join(",")')],securityGroups=[$(terraform output -raw ecs_security_group_id)],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"ingestion","command":["node","dist/scripts/ingest.js","s3://my-bucket/file.pdf","<patient-uuid>"]}]}' \
  --profile codeanding --region us-west-2
```

For bulk Synthea ingestion, you'd typically run the existing `ingest:synthea` script locally against an SSH tunnel or a bastion (out of scope for the demo).

## Updating the application

Each app code change → new image tag → push → force redeploy:

```bash
docker build --platform linux/amd64 -t healthcare-rag-api -f apps/api/Dockerfile .

REPO=$(cd infra/environments/dev && terraform output -raw query_repo_url)
TAG=$(date +%Y%m%d-%H%M%S)

docker tag healthcare-rag-api:latest "$REPO:$TAG"
docker tag healthcare-rag-api:latest "$REPO:latest"
docker push "$REPO:$TAG"
docker push "$REPO:latest"

# (If schema changed) re-run migrate task:
eval "$(cd infra/environments/dev && terraform output -raw run_migration_command)"

# Roll the service:
aws ecs update-service \
  --cluster "$(cd infra/environments/dev && terraform output -raw cluster_name)" \
  --service "$(cd infra/environments/dev && terraform output -raw query_service_name)" \
  --force-new-deployment \
  --profile codeanding --region us-west-2
```

## Cost (rough monthly)

| Component                           | Monthly                               |
| ----------------------------------- | ------------------------------------- |
| RDS db.t3.micro                     | ~$13 (free 12 mo if eligible)         |
| ECS Fargate query (24/7)            | ~$18                                  |
| ECS Fargate web (24/7, 0.25 vCPU)   | ~$9                                   |
| ECS Fargate ingestion (per run)     | ~$0.01                                |
| ALB                                 | ~$16                                  |
| 5 interface VPC endpoints           | ~$35                                  |
| S3, EventBridge, ECR, Secrets, Logs | ~$2                                   |
| **Total**                           | **~$93/mo** (or ~$80/mo on free tier) |

If too expensive: `terraform destroy` when you're not actively demoing — it tears down everything in ~5 min.

## Destroy

```bash
cd infra/environments/dev
terraform destroy
```

S3 docs bucket has `force_destroy = true` in the example tfvars — change to `false` before any prod use.

The state bucket (`codeanding-aws-rag-tfstate`) is **not** managed by the dev environment and won't be touched. If you want to nuke everything: empty the state bucket manually, then `cd infra/bootstrap && terraform destroy`.

## Things to know

- **First apply leaves both query + web services unhealthy** — that's expected. The images don't exist yet. Manual steps 2-4 above fix both.
- **Routing**: ALB listener default forwards to the web target group; a single rule sends `/api/*` to the query target group. NestJS controllers already mount under `api/` (`api/patients`, `api/patients/:id/...`), so no app changes needed.
- **Bedrock permissions** are not on the ECS task role — the application uses `BEDROCK_AWS_ACCESS_KEY_ID`/`SECRET` from Secrets Manager (separate account). If you instead grant Bedrock access to the codeanding account and want to use the task role, drop `BEDROCK_AWS_*` from the secret and add `bedrock:InvokeModel` to the task role policy in `modules/ecs/iam.tf`.
- **State locking** is via S3 conditional writes (`use_lockfile = true`). If you see `Error: Error acquiring the state lock`, an old apply might have crashed mid-write — check the bucket for a `.tflock` object next to the state file and delete it manually if needed.
- **No HTTPS** — HTTP only. To add HTTPS later: provision an ACM cert (DNS-validated), add an HTTPS listener on the ALB, and an `aws_route53_record` aliased at the ALB.
- **No autoscaling** — query service is fixed at 1 desired task. Add `aws_appautoscaling_*` resources if you want CPU-based scaling.
