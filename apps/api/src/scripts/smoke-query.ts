import 'reflect-metadata';
import '../load-env';
import { Logger } from '@aws-lambda-powertools/logger';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../db/prisma.service';
import { QueryService } from '../query/query.service';

const logger = new Logger({ serviceName: 'healthcare-rag-smoke-query' });

const DEFAULT_QUESTIONS = [
  "List this patient's active medications.",
  'What was the most recent A1c value, and when was it measured?',
  "Are any current medications contraindicated by this patient's allergies?",
];

async function main(): Promise<void> {
  const patientArg = process.argv[2];
  const customQuestion = process.argv.slice(3).join(' ');

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  try {
    const queryService = app.get(QueryService);
    const prisma = app.get(PrismaService);

    let patientId = patientArg;
    if (!patientId) {
      const first = await prisma.patient.findFirst({
        select: { id: true, givenName: true, familyName: true },
      });
      if (!first) {
        logger.error('no patients in db — run pnpm ingest:synthea first');
        process.exit(1);
      }
      patientId = first.id;
      logger.info({
        message: 'using first patient',
        patientId,
        name: `${first.givenName} ${first.familyName}`,
      });
    }

    const questions = customQuestion ? [customQuestion] : DEFAULT_QUESTIONS;

    for (const question of questions) {
      console.log('\n──────────────────────────────────────────────────────');
      console.log(`Q: ${question}`);
      const start = Date.now();
      try {
        const result = await queryService.askAboutPatient(patientId, question);
        console.log(`A: ${result.answer}`);
        console.log(`  iterations: ${result.iterations}`);
        console.log(`  tools called:`);
        for (const tc of result.toolCalls) {
          console.log(`    - ${tc.name}(${JSON.stringify(tc.input)})`);
        }
        console.log(`  total: ${Date.now() - start}ms`);
        console.log(`  tokens: in=${result.usage?.inputTokens} out=${result.usage?.outputTokens}`);
      } catch (err) {
        logger.error({
          message: 'query failed',
          question,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  logger.error('smoke-query failed', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
