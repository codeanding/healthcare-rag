"""
Architecture diagram for the Healthcare RAG on AWS demo.

Generates docs/architecture.png from this Python description.

Prereqs:
    brew install graphviz                 # or: apt-get install graphviz
    pip install diagrams                  # mingrammer/diagrams

Usage:
    python docs/architecture.py
    open docs/architecture.png
"""

from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import ECR, Fargate
from diagrams.aws.database import RDS
from diagrams.aws.integration import Eventbridge
from diagrams.aws.management import Cloudwatch
from diagrams.aws.ml import Bedrock
from diagrams.aws.network import ALB, Endpoint
from diagrams.aws.security import IAM, SecretsManager
from diagrams.aws.storage import S3
from diagrams.onprem.client import User

OUTPUT = "docs/architecture"

graph_attr = {
    "fontsize": "18",
    "splines": "spline",
    "pad": "0.6",
    "ranksep": "1.1",
    "nodesep": "0.7",
    "bgcolor": "white",
    "labelloc": "t",
}

edge_attr = {
    "fontsize": "11",
    "color": "#555555",
}

with Diagram(
    "Healthcare RAG on AWS",
    filename=OUTPUT,
    show=False,
    direction="TB",
    graph_attr=graph_attr,
    edge_attr=edge_attr,
):
    user = User("Browser")

    with Cluster("AWS account (us-west-2)"):

        # ----------- VPC: networking + compute -----------
        with Cluster("VPC 10.20.0.0/16  (no NAT Gateway)"):

            with Cluster("Public subnets (2 AZ)"):
                alb = ALB("ALB :80\nidle 300s for SSE\n+ /api/* listener rule")

            with Cluster("Private subnets (2 AZ)"):

                with Cluster("ECS Fargate cluster"):
                    web = Fargate("web service\nnginx + Vite SPA\n0.25 vCPU / 0.5 GB")
                    query = Fargate("query service\nNestJS + Bedrock\n0.5 vCPU / 1 GB")
                    ingestion = Fargate("ingestion task\nFHIR / PDF parser\n(run-to-completion)")

                rds = RDS("Postgres 16\n+ pgvector HNSW")

                with Cluster("VPC endpoints (no NAT)"):
                    vpce_if = Endpoint("Interface\nECR / Secrets / Logs / Bedrock")
                    vpce_s3 = Endpoint("Gateway\nS3")

        # ----------- Account-level managed services -----------
        with Cluster("Managed services (account-level)"):

            with Cluster("Storage + intelligence"):
                bedrock = Bedrock("Bedrock\nClaude Sonnet 4.6\n+ Titan Embed v2")
                s3_docs = S3("docs bucket\n(FHIR + PDFs)")

            with Cluster("Ingestion trigger"):
                events = Eventbridge("EventBridge rule\non s3:ObjectCreated")

            with Cluster("Operational"):
                ecr = ECR("3 image repos\nquery / ingestion / web")
                secrets = SecretsManager("DB credentials")
                logs = Cloudwatch("CloudWatch Logs\nper-service group")
                iam = IAM("IAM\ntask role + execution role")

    # ----------- Request flow (solid lines) -----------
    user >> Edge(label="HTTP", color="#1f77b4", style="bold") >> alb
    alb >> Edge(label="default", color="#1f77b4") >> web
    alb >> Edge(label="/api/*", color="#1f77b4") >> query

    # ----------- Data plane (solid, distinct color) -----------
    query >> Edge(label="SQL + vector\nsearch", color="#2ca02c") >> rds
    ingestion >> Edge(label="writes", color="#2ca02c") >> rds

    # ----------- Egress through VPC endpoints (dashed) -----------
    query >> Edge(label="invoke", style="dashed", color="#d62728") >> vpce_if
    vpce_if >> Edge(style="dashed", color="#d62728") >> bedrock

    [query, ingestion] >> Edge(label="read docs", style="dashed", color="#9467bd") >> vpce_s3
    vpce_s3 >> Edge(style="dashed", color="#9467bd") >> s3_docs

    # ----------- Ingestion trigger flow -----------
    s3_docs >> Edge(label="ObjectCreated", color="#ff7f0e") >> events
    events >> Edge(label="RunTask", color="#ff7f0e") >> ingestion

    # ----------- Operational integrations (dotted, faded) -----------
    vpce_if >> Edge(style="dotted", color="#bbbbbb") >> ecr
    vpce_if >> Edge(style="dotted", color="#bbbbbb") >> secrets
    vpce_if >> Edge(style="dotted", color="#bbbbbb") >> logs
