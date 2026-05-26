import 'reflect-metadata';
import '../load-env';
import { Logger } from '@aws-lambda-powertools/logger';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../db/prisma.service';
import { ToolsService } from '../tools/tools.service';

const logger = new Logger({ serviceName: 'healthcare-rag-smoke-tools' });

async function main(): Promise<void> {
  let patientId = process.argv[2];

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  try {
    const tools = app.get(ToolsService);
    const prisma = app.get(PrismaService);

    if (!patientId) {
      const first = await prisma.patient.findFirst({ select: { id: true } });
      if (!first) {
        logger.error('no patients in db — run pnpm ingest:synthea first');
        process.exit(1);
      }
      patientId = first.id;
      logger.info({ message: 'no patientId arg; using first patient', patientId });
    }

    const checks = [
      ['get_medications', { active_only: true }],
      ['get_conditions', {}],
      ['get_labs', { latest_only: true }],
      ['get_allergies', {}],
      ['get_encounters', {}],
      ['get_immunizations', {}],
      ['search_notes', { query: 'asthma management plan', k: 3 }],
    ] as const;

    for (const [name, input] of checks) {
      const start = Date.now();
      try {
        const result = await tools.execute(name, input as Record<string, unknown>, patientId);
        const count = Array.isArray(result) ? result.length : 1;
        logger.info({
          message: 'tool ok',
          tool: name,
          rows: count,
          ms: Date.now() - start,
        });
        if (count > 0 && Array.isArray(result)) {
          console.log(
            `  sample[0]:`,
            JSON.stringify(result[0], null, 2).split('\n').slice(0, 8).join('\n'),
          );
        }
      } catch (err) {
        logger.error({
          message: 'tool failed',
          tool: name,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  logger.error('smoke-tools failed', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
