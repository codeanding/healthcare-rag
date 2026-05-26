import 'reflect-metadata';
import '../load-env';
import { Logger } from '@aws-lambda-powertools/logger';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { S3Service } from '../aws/s3/s3.service';
import { SyntheaIngestionService } from '../synthea/synthea-ingestion.service';

const logger = new Logger({ serviceName: 'healthcare-rag-ingest-bundle-from-s3' });

async function main(): Promise<void> {
  // EventBridge passes S3_INGEST_BUCKET and S3_INGEST_KEY via the input
  // transformer. CLI args are accepted as a fallback so the same script can be
  // invoked manually with `aws ecs run-task --overrides ...` for testing.
  const bucket = process.env.S3_INGEST_BUCKET ?? process.argv[2];
  const key = process.env.S3_INGEST_KEY ?? process.argv[3];

  if (!bucket || !key) {
    logger.error(
      'Missing S3_INGEST_BUCKET / S3_INGEST_KEY env vars. Usage: node ingest-bundle-from-s3.js <bucket> <key>',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  try {
    const s3 = app.get(S3Service);
    const synthea = app.get(SyntheaIngestionService);

    logger.info({ message: 'downloading bundle from S3', bucket, key });
    const buffer = await s3.getObject(key, bucket);

    logger.info({ message: 'parsing FHIR bundle', bytes: buffer.length });
    const bundle = JSON.parse(buffer.toString('utf-8'));

    logger.info({ message: 'ingesting bundle into Postgres' });
    const result = await synthea.ingestBundle(bundle);

    logger.info({ message: 'ingestion complete', ...result });
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  logger.error({ message: 'ingestion failed', err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
