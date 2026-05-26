"""
Agentic loop diagram for Post 1.

Shows the cyclic dance between the API orchestrator, Bedrock (Claude), and the
tools/Postgres. Numbered edges tell the order of operations in one turn; a
caption in the post explains the cycle repeats until Bedrock returns text
instead of a tool_use.

Generates docs/post1-agentic-loop.png.
"""

from diagrams import Cluster, Diagram, Edge
from diagrams.aws.ml import Bedrock
from diagrams.onprem.database import Postgresql
from diagrams.programming.language import Nodejs

OUTPUT = "docs/post1-agentic-loop"

graph_attr = {
    "fontsize": "17",
    "splines": "spline",
    "pad": "0.6",
    "ranksep": "1.4",
    "nodesep": "1.0",
    "bgcolor": "white",
    "labelloc": "t",
}

edge_attr = {
    "fontsize": "12",
}

with Diagram(
    "Agentic loop (one turn) - repeats until Bedrock returns text",
    filename=OUTPUT,
    show=False,
    direction="LR",
    graph_attr=graph_attr,
    edge_attr=edge_attr,
):
    api = Nodejs("API orchestrator\n(async generator)")
    bedrock = Bedrock("Bedrock Converse\nClaude Sonnet 4.6")

    with Cluster("Tool execution (1 of 4 tools per turn)"):
        tool = Nodejs("Tool handler\n(get_labs / get_medications /\nget_patient_summary / search_notes)")
        db = Postgresql("Postgres 16\n+ pgvector HNSW")
        tool >> Edge(label="SELECT or\n<-> embedding", color="#2ca02c") >> db

    # The cycle, numbered to convey order
    api >> Edge(label="1. invoke\n+ tool defs", color="#d62728") >> bedrock
    bedrock >> Edge(label="2. tool_use\n(name + args)", color="#d62728", style="dashed") >> api
    api >> Edge(label="3. execute", color="#2ca02c") >> tool
    tool >> Edge(label="4. result rows", color="#2ca02c", style="dashed") >> api
    api >> Edge(label="5. tool_result back\n(go to 1 if more tools needed,\nelse Bedrock returns text)", color="#d62728") >> bedrock
