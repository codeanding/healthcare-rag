import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import pLimit from 'p-limit';
import { toSql } from 'pgvector';
import { BedrockService } from '../aws/bedrock/bedrock.service';
import { PrismaService } from '../db/prisma.service';
import { ChunkerService } from './chunker.service';
import { EMBEDDING_CONCURRENCY } from './ingestion.constants';
import type { IngestionResult, PdfPage } from './ingestion.types';
import { PdfParserService } from './pdf-parser.service';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly bedrock: BedrockService,
    private readonly chunker: ChunkerService,
    private readonly parser: PdfParserService,
    private readonly prisma: PrismaService,
  ) {}

  async ingestFromBuffer(
    buffer: Buffer,
    identifier: string,
    source: string,
    patientId: string,
  ): Promise<IngestionResult> {
    const { text, documentTitle, pages } = await this.parser.parse(buffer, identifier);
    return this.persist(text, pages, identifier, source, patientId, documentTitle);
  }

  async ingestTextDocument(
    text: string,
    identifier: string,
    source: string,
    patientId: string,
    titleOverride?: string,
  ): Promise<IngestionResult | { skipped: true; documentId: string }> {
    const existing = await this.prisma.document.findFirst({
      where: { s3Key: identifier },
      select: { id: true },
    });
    if (existing) {
      return { skipped: true, documentId: existing.id };
    }

    const fallback = identifier;
    const documentTitle =
      titleOverride ??
      text
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0) ??
      fallback;
    const pages: PdfPage[] = [{ pageNumber: 1, startOffset: 0, endOffset: text.length }];
    return this.persist(text, pages, identifier, source, patientId, documentTitle);
  }

  private async persist(
    text: string,
    pages: PdfPage[],
    identifier: string,
    source: string,
    patientId: string,
    documentTitle: string,
  ): Promise<IngestionResult> {
    const chunks = this.chunker.chunk(text, pages);
    if (chunks.length === 0) {
      throw new Error(`No usable chunks extracted from ${identifier}`);
    }

    this.logger.log(`Embedding ${chunks.length} chunks for ${identifier}`);
    const limit = pLimit(EMBEDDING_CONCURRENCY);
    const embeddings = await Promise.all(
      chunks.map((chunk) => limit(() => this.bedrock.embed(chunk.content))),
    );

    const documentId = await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          patientId,
          s3Key: identifier,
          title: documentTitle,
          source,
          totalChunks: chunks.length,
        },
        select: { id: true },
      });

      // vector(1024) cannot go through Prisma's typed API (Unsupported column type),
      // so chunks are inserted via parameterized raw SQL with pgvector's toSql helper.
      await Promise.all(
        chunks.map((chunk, i) =>
          tx.$executeRaw(Prisma.sql`
						INSERT INTO chunks (document_id, patient_id, content, section, page_number, chunk_index, embedding)
						VALUES (
							${document.id}::uuid,
							${patientId}::uuid,
							${chunk.content},
							${chunk.section},
							${chunk.pageNumber},
							${chunk.chunkIndex},
							${toSql(embeddings[i] ?? [])}::vector
						)
					`),
        ),
      );

      return document.id;
    });

    return { documentId, chunkCount: chunks.length, documentTitle };
  }
}
