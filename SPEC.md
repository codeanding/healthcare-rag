# Technical Spec: Healthcare RAG on AWS

**Author:** Julissa Rodriguez
**Date:** 2026-05-06
**Status:** Draft
**Stack:** TypeScript, NestJS, AWS (ECS Fargate, Bedrock, Aurora pgvector, ALB, S3, ECR)

---

## 1. Overview

A patient-scoped clinical Q&A system over **synthetic EHR data** (Synthea). For a given patient, the user asks natural-language questions about medications, conditions, labs, allergies, encounters, and clinical-note context. The system answers via an **agentic loop**: Claude (Bedrock Converse) decides which tool to invoke — structured SQL tools for facts (`get_medications`, `get_labs`, etc.) or a vector-search tool over per-patient clinical notes — then synthesizes a cited answer.

Containerized with ECS Fargate — the backend runs as a NestJS service behind an ALB.

**Why this shape** (vs. pure RAG): real clinical AI systems (Glass Health, OpenEvidence) split structured EHR data from narrative notes. Vector search over notes is the right tool for "describe the assessment from the last hospitalization"; SQL is the right tool for "list active meds". The agent picks per question.

This project serves as:

- Follow-up blog post on codeanding.com (promised after the One Piece RAG post)
- AWS Community Builder contribution (containers category)
- Foundation for a GCP port (future post)

### Out of scope

- Authentication / authorization
- Multi-tenancy
- CI/CD pipeline (future iteration)
- Go implementation (future iteration)
- GCP implementation (future post)

---

## 2. Architecture

### 2.1 Ingestion pipeline (async, runs on-demand)

```
S3 bucket           →  EventBridge rule  →  ECS Fargate task    →  Bedrock Embeddings  →  Aurora pgvector
(clinical docs)        (S3 PutObject)       (parse + chunk)        (Titan v2)              (store vectors)
```

**Flow:**

1. Upload PDF/markdown clinical guidelines to S3 bucket
2. S3 event → EventBridge rule triggers a standalone ECS Fargate task
3. Task downloads document, parses PDF → text, chunks by semantic sections
4. For each chunk: call Bedrock Titan Embeddings v2 → get vector (1024 dimensions)
5. Store chunk text + vector + metadata in Aurora PostgreSQL (pgvector)

The ingestion task runs as a separate ECS task definition — it spins up, processes the document, and shuts down. No long-running cost.

### 2.2 Query flow (sync, user-facing — agentic with tool-use)

```
Browser  →  ALB  →  ECS Fargate (NestJS)  →  Bedrock Converse (Claude + tools)
                       │                              │
                       │  ┌─────── stopReason='tool_use' ───────┐
                       │  ▼                                      │
                       │  ToolsService.execute(toolName, input, patientId)
                       │     ├── SQL tools: get_medications, get_conditions, get_labs,
                       │     │   get_allergies, get_encounters, get_immunizations
                       │     └── search_notes: embed query → pgvector ANN scoped by patient_id
                       │  │
                       │  └──> append toolResult to messages, loop (max 6 iters)
                       │
                       ▼
                  stopReason='end_turn'
                       │
                       ▼
Browser  ←  ALB  ←  { answer: string, toolCalls: [...] }
```

**Flow:**

1. User picks a patient in the UI, types a question
2. POST `/api/patients/:patientId/query` → NestJS controller validates patient exists, loads chat
3. `QueryService.askAboutPatient(patientId, question)` invokes Bedrock `ConverseCommand` with `toolConfig` (the 7 tools above) and a system prompt scoping the conversation to the patient
4. Loop:
   - If `stopReason === 'tool_use'`: execute each `toolUse` block (parallel tool-use supported), append `toolResult` content blocks to a `user` message, echo the assistant turn back verbatim including its `toolUse` block, and call Converse again
   - If `stopReason === 'end_turn'`: return `{ answer, toolCalls }` to the controller
5. Iteration cap: 6 (prevents runaway loops). Output token cap per turn.
6. **Streaming (deferred to next milestone):** swap to `ConverseStreamCommand`; accumulate `contentBlockDelta` events keyed by `contentBlockIndex` (deltas can interleave a text block and a `toolUse` block).

**Security boundary:** `patientId` is **never a tool input** — it's bound by the controller from the URL path and passed to the tool executor server-side. Tool input schemas exposed to Claude don't include `patient_id`, so prompt-injection can't exfiltrate other patients' data.

### 2.3 Observability

- **AWS X-Ray** via ADOT sidecar container in ECS task definition
- Custom segments for each RAG phase:
  - `embedding_latency` — time to generate query embedding
  - `retrieval_latency` — time for pgvector similarity search
  - `retrieval_relevance` — cosine similarity scores of returned chunks
  - `generation_latency` — time for Bedrock LLM response
- CloudWatch Embedded Metrics for aggregate dashboards
- ALB access logs for request-level visibility

---

## 3. Data

### 3.1 Dataset

**Primary: Synthea synthetic EHR**

- 50 synthetic patients generated by [Synthea](https://github.com/synthetichealth/synthea) (MITRE) with **pinned seeds** (`-s 1 -cs 1 -p 50`) for byte-identical re-runs (eval ground truth depends on this).
- Synthea outputs FHIR R4 Bundles per patient — the canonical source of structured data (patients, encounters, conditions, medications, observations, procedures, allergies, immunizations, diagnostic reports).
- Synthea's text export is structured-prose, not narrative. We **synthesize SOAP-style clinical notes** per encounter using Claude Haiku (Bedrock Converse) seeded from the FHIR data, cached idempotently to disk.
- Synthetic ⇒ no HIPAA concerns for the demo. Production deployment with real PHI requires BAA with AWS, KMS encryption, audit logging, etc. — out of scope for this build, mentioned in the blog post.

**Evaluation: auto-generated Q&A from Synthea ground truth** (Milestone 11 — done)

- Three tiers, all graded by Haiku-as-judge for fairness against paraphrased / brand-name responses:
  - **Factoid** — list active meds / conditions / allergies. Truth = SQL set against structured tables.
  - **Temporal** — most recent lab value+date, latest encounter date+type. Truth = `findFirst` ordered by date desc.
  - **Reasoning** — drug-allergy contraindications. Truth = active meds + allergies as context for LLM-as-judge.
- 5 questions per patient max; runs against the same agentic endpoint the UI uses.
- **Results on a 10-patient sample (40 questions):**

| Tier      | Pass rate        | Avg score | Notes                                                                                                                                                                                           |
| --------- | ---------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| factoid   | **100% (19/19)** | 1.00      | After fixing `get_medications` to filter by both `status='active'` AND active period.                                                                                                           |
| temporal  | **80% (16/20)**  | 0.82      | Remaining failures are LOINC mismatches (e.g. model picks `2345-7` glucose-serum vs Synthea's `2339-0` glucose-blood) — system **fails safely** with "no data found" rather than hallucinating. |
| reasoning | **100% (1/1)**   | 1.00      | Limited sample because only patients with both meds AND allergies generate this question.                                                                                                       |

- **Latency:** P50 5.2s · P95 6.8s (Sonnet 4.6, agentic loop with avg 2.0 iterations)
- **Cost:** ~$0.34 for 40 questions (~$0.008/question all-in: Sonnet for the agent, Haiku for the judge)
- Replaces BioASQ from earlier draft (BioASQ is generic biomedical Q&A, doesn't fit patient-scoped queries).

### 3.2 Chunking strategy

| Rule           | Detail                                                             |
| -------------- | ------------------------------------------------------------------ |
| Method         | Semantic sections (split on headers/sections in the PDF structure) |
| Fallback       | If no headers detected, recursive character splitter at 512 tokens |
| Overlap        | 10-15% of chunk size (~50-75 tokens) between contiguous chunks     |
| Tables         | Keep complete — never split a dosage/contraindication table        |
| Max chunk size | 512 tokens                                                         |
| Min chunk size | 50 tokens (discard shorter fragments)                              |

### 3.3 Metadata per chunk

```typescript
interface ChunkMetadata {
  documentId: string;
  patientId: string; // denormalized; drives the WHERE filter before vector ANN
  documentTitle: string; // e.g., 'Encounter SOAP note 2018-04-12'
  section: string; // 'HPI' | 'Assessment' | 'Plan' | 'Physical Exam' | etc.
  source: string; // 'synthea-note' | 'CDC' (legacy) | etc.
  pageNumber: number | null; // null for synthesized notes (not paged)
  chunkIndex: number;
  createdAt: Date;
}
```

### 3.4 Database schema

Hybrid: structured FHIR-aligned tables for SQL tools + the existing `documents`/`chunks` for vector search over synthesized clinical notes. `patient_id` is denormalized onto `chunks` so the patient pre-filter is cheap.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- ----- Patients & encounters -----
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  synthea_id TEXT UNIQUE NOT NULL,
  given_name TEXT NOT NULL,
  family_name TEXT NOT NULL,
  birth_date DATE NOT NULL,
  gender TEXT,
  race TEXT,
  ethnicity TEXT,
  marital_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  synthea_id TEXT,
  type TEXT,
  class TEXT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  reason_code TEXT,
  reason_display TEXT
);
CREATE INDEX encounters_patient_idx ON encounters (patient_id, period_start DESC);

-- ----- Coded clinical resources (each carries a code_system: SNOMED/LOINC/RxNorm/CVX) -----
CREATE TABLE conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES encounters(id) ON DELETE SET NULL,
  code TEXT, code_system TEXT, display TEXT,
  onset_date DATE, abatement_date DATE,
  clinical_status TEXT
);
CREATE INDEX conditions_patient_idx ON conditions (patient_id, onset_date DESC);

CREATE TABLE medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES encounters(id) ON DELETE SET NULL,
  code TEXT, code_system TEXT, display TEXT,
  status TEXT,
  authored_on DATE,
  period_start DATE, period_end DATE,
  dosage_text TEXT
);
CREATE INDEX medications_patient_idx ON medications (patient_id, period_start DESC);

CREATE TABLE observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES encounters(id) ON DELETE SET NULL,
  code TEXT, code_system TEXT, display TEXT,
  category TEXT,                -- 'vital-signs' | 'laboratory'
  value_numeric NUMERIC,        -- separate from value_string so range queries work
  value_string TEXT,
  unit TEXT,
  effective_date TIMESTAMPTZ
);
CREATE INDEX observations_patient_idx ON observations (patient_id, effective_date DESC);
CREATE INDEX observations_code_idx ON observations (patient_id, code, effective_date DESC);

CREATE TABLE procedures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES encounters(id) ON DELETE SET NULL,
  code TEXT, code_system TEXT, display TEXT,
  performed_date DATE
);
CREATE INDEX procedures_patient_idx ON procedures (patient_id, performed_date DESC);

CREATE TABLE allergies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  substance_code TEXT, substance_display TEXT,
  criticality TEXT,
  recorded_date DATE
);
CREATE INDEX allergies_patient_idx ON allergies (patient_id);

CREATE TABLE immunizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  vaccine_code TEXT, vaccine_display TEXT,
  occurrence_date DATE
);
CREATE INDEX immunizations_patient_idx ON immunizations (patient_id, occurrence_date DESC);

CREATE TABLE diagnostic_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES encounters(id) ON DELETE SET NULL,
  code TEXT, code_system TEXT, display TEXT,
  category TEXT,
  issued TIMESTAMPTZ,
  conclusion TEXT
);
CREATE INDEX diagnostic_reports_patient_idx ON diagnostic_reports (patient_id, issued DESC);

-- ----- Documents & chunks (existing, with patient scoping) -----
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  s3_key TEXT,                  -- nullable: synthesized notes use synthea:// URIs instead of S3
  title TEXT NOT NULL,
  source TEXT NOT NULL,         -- 'synthea-note' | 'CDC' | etc.
  total_chunks INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX documents_s3_key_unique ON documents (s3_key) WHERE s3_key IS NOT NULL;

CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL,     -- denormalized for cheap pre-filter on vector search
  content TEXT NOT NULL,
  section TEXT,
  page_number INTEGER,
  chunk_index INTEGER NOT NULL,
  embedding vector(1024),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX chunks_document_id_idx ON chunks (document_id);
CREATE INDEX chunks_patient_id_idx ON chunks (patient_id);

-- HNSW index — at ~50 patients × ~50 chunks (~2500 total), the planner picks
-- seq scan or post-filter when WHERE patient_id = $1 is present. Both are fine.
-- Skip per-patient partial indexes: operational overhead, no benefit at this scale.
CREATE INDEX chunks_embedding_idx ON chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

Tune `hnsw.ef_search` per query (`SET LOCAL hnsw.ef_search = 40`) for recall/latency trade-off.

---

## 4. Container Architecture

### 4.1 Docker images

**Query service (long-running):**

```dockerfile
# Multi-stage build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/main.js"]
```

**Ingestion task (run-to-completion):**

- Same base Dockerfile, different entrypoint
- Receives S3 key as environment variable from EventBridge
- Exits 0 on success, 1 on failure (ECS handles retries)

### 4.2 ECR repositories

```
<account-id>.dkr.ecr.<region>.amazonaws.com/healthcare-rag/query-service
<account-id>.dkr.ecr.<region>.amazonaws.com/healthcare-rag/ingestion-task
```

### 4.3 ECS configuration

**Cluster:** `healthcare-rag` (Fargate capacity provider)

**Query service — ECS Service:**
| Setting | Value |
|---------|-------|
| Launch type | Fargate |
| CPU | 0.5 vCPU |
| Memory | 1 GB |
| Desired count | 1 |
| Health check | GET /health |
| Port | 3000 |
| ADOT sidecar | Yes (X-Ray daemon) |

**Ingestion — ECS Task (standalone, triggered by EventBridge):**
| Setting | Value |
|---------|-------|
| Launch type | Fargate |
| CPU | 0.5 vCPU |
| Memory | 1 GB |
| Timeout | 15 minutes |
| Retries | 2 |

### 4.4 ALB configuration

| Setting           | Value                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| Scheme            | Internet-facing                                                             |
| Listener          | HTTP :80 (HTTPS for production)                                             |
| Target group      | ECS query service, port 3000                                                |
| Health check path | /health                                                                     |
| Idle timeout      | 300s (for SSE streaming)                                                    |
| DNS               | Auto-generated (e.g., `healthcare-rag-alb-123.us-east-1.elb.amazonaws.com`) |

**Important:** ALB idle timeout must be ≥ max expected SSE stream duration. 300s is generous for RAG responses.

### 4.5 Networking

```
VPC
├── Public subnets (2 AZs)
│   └── ALB
├── Private subnets (2 AZs)
│   ├── ECS Fargate tasks (query service + ingestion)
│   └── Aurora PostgreSQL
└── VPC endpoints (no NAT Gateway)
    ├── S3 (gateway endpoint, free)
    ├── Bedrock runtime (interface)
    ├── ECR api + dkr (interface)
    ├── Secrets Manager (interface)
    └── CloudWatch Logs (interface)
```

Fargate tasks in private subnets reach Bedrock, S3, and ECR through VPC endpoints — no NAT Gateway, no per-GB egress charges.

---

## 5. AWS Services

| Service                                         | Purpose                             | Estimated Cost                                   |
| ----------------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| ECR                                             | Docker image registry               | Free tier (500MB/mo)                             |
| ECS Fargate (query)                             | NestJS API (0.5 vCPU, 1GB, 24/7)    | ~$18/mo                                          |
| ECS Fargate (ingestion)                         | On-demand tasks (~5 min/doc)        | ~$0.01/run                                       |
| ALB                                             | Public endpoint for API             | ~$16/mo + traffic                                |
| S3                                              | Document storage                    | Free tier (5GB)                                  |
| EventBridge                                     | S3 → ECS task trigger               | Free tier                                        |
| Bedrock — Titan Embeddings v2                   | Embedding generation                | ~$0.00002/1K tokens                              |
| Bedrock — Claude Sonnet                         | Response generation                 | ~$0.003/1K in, $0.015/1K out                     |
| Aurora Serverless v2                            | Vector store (pgvector)             | ~$12/mo (0.5 ACU min)                            |
| X-Ray                                           | Tracing (via ADOT sidecar)          | Free tier (100K traces/mo)                       |
| CloudWatch                                      | Logs + metrics                      | Free tier                                        |
| VPC endpoints (S3, Bedrock, ECR, Secrets, Logs) | Private access, no NAT data charges | ~$0 (S3 gateway) + ~$7/mo per interface endpoint |

**Estimated total for development/demo:** $65-75/mo (with VPC endpoints; no NAT Gateway)

**Networking cost note:** A NAT Gateway is **~$32/mo** ($0.045/hr × 730 hr) plus $0.045/GB processed — not $3/mo. We avoid it entirely by using VPC endpoints: an S3 gateway endpoint (free) plus interface endpoints for Bedrock runtime, ECR (api + dkr), Secrets Manager, and CloudWatch Logs. Interface endpoints are ~$7/mo each but eliminate per-GB NAT charges, which dominate at any real ingestion volume.

**Cost reduction option:** Replace Aurora Serverless with RDS free tier PostgreSQL (db.t3.micro). Drops ~$12/mo. pgvector works identically on standard RDS.

---

## 6. Tech Stack

### 6.1 Backend (NestJS)

```
Runtime: Node.js 22
Language: TypeScript 5.x
Framework: NestJS 11

Dependencies:
  @nestjs/common, @nestjs/core      — NestJS framework
  @aws-sdk/client-bedrock-runtime   — Bedrock API (embeddings + LLM)
  @aws-sdk/client-s3                — S3 document access
  prisma / @prisma/client           — ORM (Aurora pgvector)
  pgvector                          — pgvector support for Prisma
  pdf-parse                         — PDF text extraction
  p-limit                           — bounded concurrency for Bedrock embedding calls
  @aws-lambda-powertools/tracer     — X-Ray instrumentation
  @aws-lambda-powertools/metrics    — CloudWatch embedded metrics
  @aws-lambda-powertools/logger     — Structured logging
```

### 6.2 Frontend

```
Framework: React 19 (Vite)
Key libraries:
  @tanstack/react-query  — server state, mutation for chat
  eventsource-parser     — SSE stream parsing
  tailwindcss            — styling
```

### 6.3 Infrastructure

```
Docker + Docker Compose (local development)
Terraform (VPC, ECS, ALB, ECR, Aurora, S3, EventBridge)
```

---

## 7. Implementation Details

### 7.1 NestJS — Ingestion (Synthea + text documents)

Two ingestion paths:

- **Structured FHIR** (`SyntheaIngestionService.ingestBundle`): stream-parses a Synthea FHIR Bundle, builds a `urn:uuid:* → db_uuid` map in a first pass to handle out-of-order resources, then batch-inserts into the structured tables (patients, encounters, conditions, medications, observations, procedures, allergies, immunizations, diagnostic_reports). Validated with `zod` before insert; large bundles streamed via `stream-json`.
- **Synthesized notes** (`IngestionService.ingestTextDocument`): for SOAP notes generated by Haiku, skips the PDF parser and goes straight to chunker → Titan v2 embeddings (bounded with `p-limit(8)`) → `documents` + `chunks` insert. Both rows carry `patient_id`. Chunks insert via parameterized `$executeRaw` + `pgvector` `toSql` (vector(1024) is `Unsupported` in Prisma's typed API).

```typescript
// ingestion/ingestion.service.ts (excerpt)
async ingestTextDocument(
	text: string,
	identifier: string,   // synthea://patient/<id>/encounter/<id>
	source: string,        // 'synthea-note'
	patientId: string
): Promise<IngestionResult> {
	const fakePages: PdfPage[] = [{ pageNumber: 1, startOffset: 0, endOffset: text.length }];
	const documentTitle = text.split('\n').find((l) => l.trim().length > 0) ?? identifier;
	const chunks = this.chunker.chunk(text, fakePages);

	const limit = pLimit(8);
	const embeddings = await Promise.all(
		chunks.map((c) => limit(() => this.bedrock.embed(c.content)))
	);

	return this.prisma.$transaction(async (tx) => {
		const doc = await tx.document.create({
			data: { patientId, s3Key: identifier, title: documentTitle, source, totalChunks: chunks.length },
			select: { id: true },
		});

		await Promise.all(chunks.map((chunk, i) =>
			tx.$executeRaw(Prisma.sql`
				INSERT INTO chunks (document_id, patient_id, content, section, page_number, chunk_index, embedding)
				VALUES (${doc.id}::uuid, ${patientId}::uuid, ${chunk.content}, ${chunk.section}, NULL, ${i}, ${toSql(embeddings[i])}::vector)
			`)
		));

		return { documentId: doc.id, chunkCount: chunks.length, documentTitle };
	});
}
```

### 7.2 NestJS — Query controller (patient-scoped, agentic, with SSE)

Two endpoints share the same patient-existence + boundary check:

```typescript
// query/query.controller.ts
@Controller('api/patients/:patientId')
export class QueryController {
  @Post('query')
  async query(@Param('patientId', new ParseUUIDPipe()) patientId: string, @Body() dto: QueryDto) {
    await this.assertPatientExists(patientId, dto);
    return this.queryService.askAboutPatient(patientId, dto.question);
  }

  @Post('query/stream')
  @Sse() // POST + @Sse() works in NestJS — pipe an Observable<MessageEvent>
  async queryStream(
    @Param('patientId', new ParseUUIDPipe()) patientId: string,
    @Body() dto: QueryDto,
  ): Promise<Observable<MessageEvent>> {
    await this.assertPatientExists(patientId, dto);
    const stream = this.queryService.streamAboutPatient(patientId, dto.question);
    return new Observable<MessageEvent>((subscriber) => {
      let cancelled = false;
      (async () => {
        try {
          for await (const event of stream) {
            if (cancelled) return;
            subscriber.next({ type: event.type, data: event });
          }
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();
      return () => {
        cancelled = true;
      };
    });
  }
}
```

### 7.3 NestJS — Query service (Bedrock Converse + tool loop)

```typescript
// query/query.service.ts
const MAX_TOOL_ITERATIONS = 6;

@Injectable()
export class QueryService {
  constructor(
    private readonly bedrock: BedrockService,
    private readonly tools: ToolsService,
  ) {}

  async askAboutPatient(patientId: string, question: string) {
    const messages: Message[] = [{ role: 'user', content: [{ text: question }] }];
    const toolCalls: Array<{ name: string; input: unknown; result: unknown }> = [];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await this.bedrock.converse({
        system: [{ text: CLINICAL_SYSTEM_PROMPT }],
        messages,
        toolConfig: { tools: TOOL_DEFINITIONS, toolChoice: { auto: {} } },
        inferenceConfig: { maxTokens: 1024, temperature: 0.2 },
      });

      messages.push(response.output.message); // echo assistant turn back verbatim

      if (response.stopReason !== 'tool_use') {
        const answer = response.output.message.content
          .filter((b) => 'text' in b)
          .map((b) => b.text)
          .join('\n');
        return { answer, toolCalls };
      }

      // Parallel tool-use is supported — handle the list, not a single call
      const toolUses = response.output.message.content.filter((b) => 'toolUse' in b);
      const toolResults = await Promise.all(
        toolUses.map(async ({ toolUse }) => {
          const result = await this.tools.execute(toolUse.name, toolUse.input, patientId);
          toolCalls.push({ name: toolUse.name, input: toolUse.input, result });
          return { toolResult: { toolUseId: toolUse.toolUseId, content: [{ json: result }] } };
        }),
      );

      messages.push({ role: 'user', content: toolResults });
    }

    throw new Error(`Tool loop exceeded ${MAX_TOOL_ITERATIONS} iterations`);
  }
}
```

System prompt scopes the conversation to the given patient and explicitly mentions the data is synthetic (reduces over-cautious refusals on edge cases like pediatric or oncology):

```
You are a clinical assistant working with synthetic patient data (Synthea-generated).
The current patient is patient_id={patientId}; all tool calls are scoped to this patient
automatically — you never need to specify a patient id. Cite the tool you used to obtain
each fact (e.g., "per get_medications(...)"). When unsure, say so. Never invent data.
```

#### Streaming with `ConverseStreamCommand`

Same agentic loop, but `streamAboutPatient(patientId, question)` is an `async function*` that yields events suitable for SSE:

```typescript
type StreamEvent =
  | { type: 'iteration'; n: number }
  | { type: 'token'; text: string }
  | { type: 'tool_use_start'; name: string; toolUseId: string }
  | { type: 'tool_call'; name: string; input: unknown; result: unknown }
  | { type: 'done'; toolCalls: ToolCallTrace[]; iterations: number; usage: Usage }
  | { type: 'error'; message: string };
```

The implementation walks `response.stream` (`AsyncIterable<ConverseStreamOutput>`) and accumulates per `contentBlockIndex` because **a single assistant turn can interleave a text block and one or more `toolUse` blocks**. Three gotchas the implementation handles:

1. `contentBlockDelta` events are keyed by `contentBlockIndex` — text and toolUse can interleave. Accumulate per-index in a `Map`.
2. `delta.toolUse.input` is a STRING containing partial JSON. Concatenate strings across deltas, then `JSON.parse` once at `contentBlockStop`.
3. `messageStop.stopReason` and `metadata.usage` arrive before the iterator finishes — capture both before deciding whether to loop.

When the model emits multiple `toolUse` blocks in a single turn (parallel tool-use), they all stream concurrently with different `contentBlockIndex` values. The reconstructed assistant message is echoed back verbatim so the model can match its tool results on the next turn.

Verified TTFT ~1.7s, total ~13s for a 2-iteration parallel-tool-use question against the 54-patient Synthea dataset.

### 7.4 Frontend — Chat with streaming

```typescript
// hooks/useRAGChat.ts
export function useRAGChat() {
  const [streamingText, setStreamingText] = useState('');

  const mutation = useMutation({
    mutationFn: async (question: string) => {
      setStreamingText('');

      const response = await fetch(`${API_URL}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      // eventsource-parser handles cross-chunk boundaries and partial UTF-8
      const parser = createParser((event) => {
        if (event.type === 'event' && event.data) {
          const { text } = JSON.parse(event.data);
          fullText += text;
          setStreamingText(fullText);
        }
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }

      return fullText;
    },
  });

  return { ...mutation, streamingText };
}
```

---

## 8. Observability Details

### 8.1 ADOT sidecar in ECS

The ADOT collector runs as a sidecar container in the ECS task definition:

```json
{
  "name": "adot-collector",
  "image": "public.ecr.aws/aws-observability/aws-otel-collector:latest",
  "essential": false,
  "command": ["--config=/etc/ecs/ecs-xray.yaml"],
  "portMappings": [{ "containerPort": 2000, "protocol": "udp" }]
}
```

### 8.2 Trace structure

Each query request produces a trace with one converse-loop subsegment per iteration plus per-tool subsegments:

```
[POST /api/patients/:id/query]
├── annotation: patient_id
├── annotation: tool_use_count = 3
├── annotation: tool_names_called = ["get_medications", "search_notes", "get_allergies"]
├── [converse:iter-0]            — 800-1500ms (LLM decides which tool)
│   └── annotation: stop_reason = "tool_use"
├── [tool:get_medications]       — 5-30ms (SQL)
├── [tool:search_notes]          — 70-200ms
│   ├── [embedding]              — 50-150ms (Titan v2 on the query)
│   ├── [retrieval]              — 20-80ms (pgvector ANN, patient-filtered)
│   │   └── annotation: top_similarity_score = 0.87
│   │   └── annotation: chunks_returned = 5
│   └── annotation: chunks_above_threshold = 3
├── [tool:get_allergies]         — 5-30ms
└── [converse:iter-1]            — 1-3s (LLM synthesizes final answer)
    └── annotation: stop_reason = "end_turn"
    └── annotation: input_tokens = 2340  output_tokens = 412
```

### 8.3 CloudWatch custom metrics

```typescript
metrics.addMetric('ConverseIterations', MetricUnit.Count, iterationCount);
metrics.addMetric('ToolCallCount', MetricUnit.Count, toolCalls.length);
metrics.addMetric('SqlToolLatency', MetricUnit.Milliseconds, sqlMs);
metrics.addMetric('SearchNotesLatency', MetricUnit.Milliseconds, searchNotesMs);
metrics.addMetric('EmbeddingLatency', MetricUnit.Milliseconds, embeddingMs);
metrics.addMetric('RetrievalLatency', MetricUnit.Milliseconds, retrievalMs);
metrics.addMetric('TopSimilarityScore', MetricUnit.None, topScore);
metrics.addMetric('ChunksAboveThreshold', MetricUnit.Count, aboveThreshold);
metrics.addMetric('GenerationLatency', MetricUnit.Milliseconds, generationMs);
metrics.addMetric('InputTokens', MetricUnit.Count, inputTokens);
metrics.addMetric('OutputTokens', MetricUnit.Count, outputTokens);
```

### 8.4 Blog-worthy insight

The observability section of the blog post shows how to diagnose bad agentic responses:

- **Loop runaway** (`ConverseIterations` near cap) → ambiguous question or model picking the wrong tool repeatedly
- **No tool calls** (`ToolCallCount = 0`) → model answering from prior knowledge instead of grounding in patient data; system prompt or tool descriptions need tightening
- **Low `TopSimilarityScore` on `search_notes`** → chunking problem or no narrative covers the topic (note synthesis gap)
- **High `SqlToolLatency`** → missing index on the structured tables (verify composite indexes per §3.4)
- **Tool calls made but final answer ignores them** → system prompt isn't enforcing "must cite tool results"

This maps directly to the JSConf MX talk on evals/observability for LLMs in production.

---

## 9. Project Structure

```
healthcare-rag-aws/
├── apps/
│   ├── api/                        — NestJS query + ingestion service
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── ingestion/
│   │   │   │   ├── ingestion.module.ts
│   │   │   │   ├── ingestion.service.ts        — ingestFromBuffer (PDFs) + ingestTextDocument (notes)
│   │   │   │   ├── chunker.service.ts
│   │   │   │   └── pdf-parser.service.ts
│   │   │   ├── synthea/
│   │   │   │   ├── synthea.module.ts
│   │   │   │   ├── synthea-ingestion.service.ts  — FHIR Bundle → structured tables
│   │   │   │   └── fhir-types.ts                 — zod schemas
│   │   │   ├── tools/
│   │   │   │   ├── tools.module.ts
│   │   │   │   ├── tools.service.ts              — get_meds, get_conditions, get_labs, search_notes, ...
│   │   │   │   └── tool-definitions.ts           — Bedrock Converse toolConfig
│   │   │   ├── query/
│   │   │   │   ├── query.module.ts
│   │   │   │   ├── query.controller.ts           — POST /api/patients/:id/query
│   │   │   │   └── query.service.ts              — Converse + tool loop (max 6 iters)
│   │   │   ├── bedrock/
│   │   │   │   ├── bedrock.module.ts
│   │   │   │   └── bedrock.service.ts            — embed() + converse()
│   │   │   ├── db/
│   │   │   │   ├── prisma.module.ts
│   │   │   │   └── prisma.service.ts
│   │   │   ├── s3/
│   │   │   │   ├── s3.module.ts
│   │   │   │   └── s3.service.ts
│   │   │   ├── observability/
│   │   │   │   ├── tracer.service.ts
│   │   │   │   └── metrics.service.ts
│   │   │   ├── scripts/
│   │   │   │   ├── ingest.ts                     — single PDF/text via S3 or local path
│   │   │   │   ├── ingest-synthea.ts             — walk Synthea output dir
│   │   │   │   ├── synthesize-notes.ts           — Haiku per encounter, cached to disk
│   │   │   │   ├── smoke-bedrock.ts
│   │   │   │   ├── smoke-tools.ts
│   │   │   │   └── smoke-query.ts
│   │   │   └── health/
│   │   │       └── health.controller.ts
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                        — React frontend
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── ChatInput.tsx
│       │   │   ├── ChatMessage.tsx
│       │   │   └── ChatWindow.tsx
│       │   ├── hooks/
│       │   │   └── useRAGChat.ts
│       │   └── main.tsx
│       ├── package.json
│       └── vite.config.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── synthea-output/                 — Synthea-generated FHIR + synthesized notes (gitignored)
│   ├── fhir/                       — one bundle per patient
│   ├── text/                       — Synthea text export
│   └── notes/<patientId>/<encounterId>.txt   — Haiku-synthesized SOAP notes (cached)
├── infra/                          — Terraform
│   ├── main.tf                     — Provider + backend config
│   ├── variables.tf
│   ├── outputs.tf
│   ├── modules/
│   │   ├── vpc/                    — VPC, subnets, NAT
│   │   ├── database/               — Aurora/RDS pgvector
│   │   ├── ecr/                    — ECR repositories
│   │   ├── ecs/                    — Cluster, service, task defs, ALB
│   │   └── ingestion/              — EventBridge + S3 trigger
│   └── environments/
│       └── dev/
│           ├── main.tf
│           └── terraform.tfvars
├── docker-compose.yml              — Local dev (Postgres + app)
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

---

## 10. Local Development

```yaml
# docker-compose.yml
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports:
      - '5432:5432'
    environment:
      POSTGRES_DB: healthcare_rag
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    volumes:
      - pgdata:/var/lib/postgresql/data

  api:
    build:
      context: ./apps/api
      dockerfile: Dockerfile
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: postgresql://dev:dev@postgres:5432/healthcare_rag
      AWS_REGION: us-east-1
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
    depends_on:
      - postgres

volumes:
  pgdata:
```

Local dev uses the same Docker image as production. Bedrock calls go to AWS (no local emulation). Postgres runs locally with pgvector extension pre-installed.

---

## 11. Blog Post Outline

**Title:** "Patient-Scoped Clinical Q&A with AWS Bedrock, ECS Fargate, and Agentic Tool-Use"
**Series:** Follow-up to "RAG sobre One Piece" on codeanding.com

### Sections:

1. **Intro** — Why patient Q&A and not "chat with your docs" — what's different about clinical context
2. **Architecture** — Hybrid SQL + RAG, Bedrock Converse tool-use, why Synthea, security boundary on patient_id
3. **Generating synthetic patients** — Synthea jar, pinned seeds for reproducibility, synthesizing SOAP notes via Haiku
4. **Vector store + structured store** — Aurora/RDS + pgvector + FHIR-aligned tables, HNSW vs prefilter trade-offs
5. **Ingestion pipeline** — Stream-parsing FHIR bundles, urn → uuid resolution, batch inserts, idempotent note synthesis
6. **The agentic loop** — Bedrock Converse tool spec, multi-turn loop, parallel tool-use, iteration cap, system prompt scoping
7. **Streaming** — ConverseStream, accumulating contentBlockDelta by index, SSE to the browser
8. **Deploying to ECS Fargate** — Terraform (VPC, ECS, ALB), VPC endpoints (no NAT), task definition, health checks
9. **Observability** — ADOT sidecar, traces with per-tool subsegments, dashboards for loop iterations and tool latencies
10. **Frontend** — Patient selector + chat with tool-call trace visualization
11. **Evaluation** — Auto-generated Q&A from Synthea ground truth (factoid / temporal / reasoning); LLM-as-judge for the reasoning tier
12. **Results & lessons** — What worked, what failed, when the agent picks the wrong tool
13. **Next** — Teaser for GCP version

### Differentiators vs existing RAG tutorials:

- **Patient-scoped, not document-scoped** — security boundary on patient_id, synthetic data, HIPAA caveat
- **Hybrid agentic** — Bedrock Converse tool-use orchestrates SQL + vector search; not "embed everything and pray"
- Containerized with ECS Fargate (most tutorials use Lambda)
- NestJS backend (relatable for Node.js developers)
- Stream-parsing large FHIR bundles without OOM
- Observability instrumented for the agentic loop, not just RAG
- **Auto-generated eval from Synthea ground truth** — measurable retrieval + reasoning accuracy without manual labeling
- Streaming end-to-end with the contentBlockDelta gotcha called out
- Spanish-language content on codeanding.com

---

## 12. Milestones

| #   | Milestone                         | Deliverable                                                           |
| --- | --------------------------------- | --------------------------------------------------------------------- |
| 1   | Local setup                       | Docker Compose with pgvector + NestJS running                         |
| 2   | Database schema                   | Prisma schema (patients + FHIR tables + vector chunks), migrations    |
| 3   | Ingestion (PDF + text)            | NestJS module that chunks text/PDFs and stores vectors                |
| 3.5 | Synthea + structured ingestion    | FHIR Bundle parser → structured tables; SOAP-note synthesis via Haiku |
| 4   | Tools + agentic query (no stream) | ToolsService + QueryService with Bedrock Converse loop ✓              |
| 5   | Streaming                         | ConverseStream + NestJS SSE end-to-end ✓                              |
| 6   | Containerize + ECR                | Dockerfile, push to ECR, test image locally                           |
| 7   | Deploy to ECS                     | Fargate service + ALB + health checks working                         |
| 8   | Ingestion task                    | EventBridge trigger → ECS task for document ingestion                 |
| 9   | Frontend                          | React + patient selector + chat with tool-call trace ✓                |
| 10  | Observability                     | ADOT sidecar + per-tool X-Ray subsegments + dashboards                |
| 11  | Evaluation                        | Auto-gen Q&A from Synthea ground truth; factoid/temporal/reasoning ✓  |
| 12  | Blog post                         | Draft on codeanding.com                                               |
