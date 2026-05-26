import 'reflect-metadata';
import '../load-env';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { Logger } from '@aws-lambda-powertools/logger';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IngestionService } from '../ingestion/ingestion.service';
import { S3Service } from '../aws/s3/s3.service';

const logger = new Logger({ serviceName: 'healthcare-rag-ingest' });

interface ResolvedSource {
  buffer: Buffer;
  identifier: string;
}

async function loadSource(target: string, s3: S3Service): Promise<ResolvedSource> {
  if (target.startsWith('s3://')) {
    const url = new URL(target);
    const bucket = url.hostname;
    const key = url.pathname.replace(/^\//, '');
    return { buffer: await s3.getObject(key, bucket), identifier: target };
  }
  return { buffer: await readFile(target), identifier: basename(target) };
}

async function main(): Promise<void> {
  const target = process.argv[2];
  const patientId = process.argv[3];
  const source = process.argv[4] ?? 'manual-upload';

  if (!target || !patientId) {
    logger.error('Usage: pnpm ingest <s3://bucket/key | local-path> <patientId> [source]');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  try {
    const ingestion = app.get(IngestionService);
    const s3 = app.get(S3Service);
    const { buffer, identifier } = await loadSource(target, s3);

    logger.info({ message: 'starting ingestion', identifier, patientId, bytes: buffer.length });
    const result = await ingestion.ingestFromBuffer(buffer, identifier, source, patientId);
    logger.info({ message: 'ingestion complete', ...result });
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  logger.error('ingestion failed', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
