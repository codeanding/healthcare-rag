"""
Application-layer architecture diagram for Post 1.

Generates docs/post1-app-architecture.png. Focuses on the request flow + the
agentic loop, NOT the AWS infrastructure (that's the Post 2 diagram).

Prereqs (same as architecture.py):
    brew install graphviz
    pip install diagrams

Usage:
    python docs/post1-app-architecture.py
"""

from diagrams import Cluster, Diagram, Edge
from diagrams.aws.ml import Bedrock
from diagrams.onprem.client import User
from diagrams.onprem.database import Postgresql
from diagrams.programming.framework import React
from diagrams.programming.language import Nodejs

OUTPUT = "docs/post1-app-architecture"

graph_attr = {
    "fontsize": "17",
    "splines": "spline",
    "pad": "0.5",
    "ranksep": "1.0",
    "nodesep": "0.7",
    "bgcolor": "white",
    "labelloc": "t",
}

edge_attr = {
    "fontsize": "11",
    "color": "#555555",
}

with Diagram(
    "Healthcare RAG - application layer",
    filename=OUTPUT,
    show=False,
    direction="LR",
    graph_attr=graph_attr,
    edge_attr=edge_attr,
):
    user = User("Browser")

    with Cluster("Frontend"):
        spa = React("React + Vite\nstreaming UI")

    with Cluster("NestJS API"):
        controller = Nodejs("/query/stream\ncontroller (SSE)")

        with Cluster("Agentic loop"):
            loop = Nodejs("orchestrator\n(async generator)")

        with Cluster("Tools (4)"):
            t_summary = Nodejs("get_patient_summary")
            t_labs = Nodejs("get_labs")
            t_meds = Nodejs("get_medications")
            t_notes = Nodejs("search_notes")

    bedrock = Bedrock("Bedrock Converse\nClaude Sonnet 4.6")

    with Cluster("Postgres 16 + pgvector"):
        sql_data = Postgresql("Structured tables\npatients, labs,\nmedications, conditions")
        vec_data = Postgresql("Clinical notes\n+ embeddings (HNSW)")

    # ----- Request flow -----
    user >> Edge(label="HTTP", color="#1f77b4") >> spa
    spa >> Edge(label="POST /query/stream", color="#1f77b4") >> controller
    controller >> loop

    # ----- Agentic loop with Bedrock -----
    loop >> Edge(label="invoke + tool defs", color="#d62728") >> bedrock
    bedrock >> Edge(label="tool_use / text", color="#d62728", style="dashed") >> loop

    # ----- Tool execution -----
    loop >> Edge(label="SQL", color="#2ca02c") >> t_summary
    loop >> Edge(color="#2ca02c") >> t_labs
    loop >> Edge(color="#2ca02c") >> t_meds
    loop >> Edge(label="vector search", color="#9467bd") >> t_notes

    [t_summary, t_labs, t_meds] >> Edge(label="SELECT", color="#2ca02c") >> sql_data
    t_notes >> Edge(label="embed + <->", color="#9467bd") >> vec_data

    # ----- Response streaming back to the user -----
    controller >> Edge(label="SSE stream", color="#1f77b4", style="bold") >> spa
