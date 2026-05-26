import 'reflect-metadata';
import '../load-env';
import { Logger } from '@aws-lambda-powertools/logger';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BedrockService } from '../aws/bedrock/bedrock.service';

const logger = new Logger({ serviceName: 'healthcare-rag-smoke' });

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  try {
    const bedrock = app.get(BedrockService);
    const text = process.argv[2] ?? 'Hello from healthcare RAG smoke test';
    const start = Date.now();
    const embedding = await bedrock.embed(text);
    logger.info({
      message: 'embedding ok',
      dims: embedding.length,
      latencyMs: Date.now() - start,
      region: process.env.AWS_REGION,
      profile: process.env.AWS_PROFILE ?? 'access-keys',
    });
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  logger.error('smoke failed', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
