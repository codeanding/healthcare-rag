-- Initial migration: pgvector extension, documents/chunks tables, FK + HNSW indexes.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "s3_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "total_chunks" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "documents_s3_key_key" ON "documents"("s3_key");

CREATE TABLE "chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "section" TEXT,
    "page_number" INTEGER,
    "chunk_index" INTEGER NOT NULL,
    "embedding" vector(1024),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK index: Postgres doesn't auto-index FK columns; ON DELETE CASCADE would
-- otherwise full-scan chunks on every document delete.
CREATE INDEX "chunks_document_id_idx" ON "chunks"("document_id");

-- HNSW vector index. Tune ef_search per query (SET LOCAL hnsw.ef_search = 40).
CREATE INDEX "chunks_embedding_idx" ON "chunks"
    USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
