import 'reflect-metadata';
import '../load-env';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Logger } from '@aws-lambda-powertools/logger';
import { NestFactory } from '@nestjs/core';
import pLimit from 'p-limit';
import { AppModule } from '../app.module';
import { PrismaService } from '../db/prisma.service';
import type { EvalResult } from '../eval/eval.types';
import { GraderService } from '../eval/grader.service';
import { GroundTruthService } from '../eval/ground-truth.service';
import { QuestionGeneratorService } from '../eval/question-generator.service';
import { QueryService } from '../query/query.service';

const logger = new Logger({ serviceName: 'healthcare-rag-eval' });

async function main(): Promise<void> {
  const sampleSize = Number(process.argv[2] ?? 10);
  const concurrency = Number(process.argv[3] ?? 3);

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  try {
    const prisma = app.get(PrismaService);
    const groundTruth = app.get(GroundTruthService);
    const generator = app.get(QuestionGeneratorService);
    const grader = app.get(GraderService);
    const queryService = app.get(QueryService);

    // Sample N patients deterministically (ordered by name for reproducibility).
    const patients = await prisma.patient.findMany({
      orderBy: { familyName: 'asc' },
      take: sampleSize,
      select: { id: true },
    });
    logger.info({ message: 'eval starting', patients: patients.length, concurrency });

    // Generate ground truth + questions for each patient
    const allQuestions = (
      await Promise.all(
        patients.map(async (p) => {
          const gt = await groundTruth.forPatient(p.id);
          return generator.generate(gt);
        }),
      )
    ).flat();

    logger.info({ message: 'questions generated', total: allQuestions.length });

    // Run questions through the agentic loop in parallel (bounded)
    const limit = pLimit(concurrency);
    const results: EvalResult[] = [];

    await Promise.all(
      allQuestions.map((question) =>
        limit(async () => {
          const patient = await prisma.patient.findUniqueOrThrow({
            where: { id: question.patientId },
            select: { givenName: true, familyName: true },
          });
          const start = Date.now();
          try {
            const out = await queryService.askAboutPatient(question.patientId, question.question);
            const latencyMs = Date.now() - start;
            const grade = await grader.grade(question, out.answer);
            results.push({
              questionId: question.id,
              patientId: question.patientId,
              patientName: `${patient.givenName} ${patient.familyName}`,
              tier: question.tier,
              kind: question.kind,
              question: question.question,
              groundTruth: question.groundTruth,
              answer: out.answer,
              pass: grade.pass,
              score: grade.score,
              reason: grade.reason,
              latencyMs,
              iterations: out.iterations,
              toolCalls: out.toolCalls.map((c) => ({ name: c.name, input: c.input })),
              tokens: { input: out.usage?.inputTokens, output: out.usage?.outputTokens },
            });
            process.stderr.write(grade.pass ? '✓' : '✗');
          } catch (err) {
            process.stderr.write('!');
            results.push({
              questionId: question.id,
              patientId: question.patientId,
              patientName: `${patient.givenName} ${patient.familyName}`,
              tier: question.tier,
              kind: question.kind,
              question: question.question,
              groundTruth: question.groundTruth,
              answer: `<error: ${err instanceof Error ? err.message : String(err)}>`,
              pass: false,
              score: 0,
              reason: 'invocation error',
              latencyMs: Date.now() - start,
              iterations: 0,
              toolCalls: [],
              tokens: {},
            });
          }
        }),
      ),
    );
    process.stderr.write('\n');

    // Report
    const summary = summarise(results);
    console.log('\n========== EVAL SUMMARY ==========');
    console.log(`Patients sampled: ${patients.length}`);
    console.log(`Questions:        ${results.length}`);
    console.log('');
    console.log('Per-tier accuracy:');
    for (const tier of ['factoid', 'temporal', 'reasoning'] as const) {
      const t = summary.byTier[tier];
      if (!t) continue;
      console.log(
        `  ${tier.padEnd(10)} ${t.passed}/${t.total} (${(t.passRate * 100).toFixed(1)}%) · avg score ${t.avgScore.toFixed(2)}`,
      );
    }
    console.log('');
    console.log(`Latency:          P50=${summary.latencyP50}ms · P95=${summary.latencyP95}ms`);
    console.log(
      `Iterations:       avg=${summary.avgIterations.toFixed(1)} (max=${summary.maxIterations})`,
    );
    console.log(
      `Tokens:           in=${summary.totalInputTokens} · out=${summary.totalOutputTokens}`,
    );
    console.log(`Estimated cost:   $${summary.estimatedCostUsd.toFixed(3)} (Sonnet 4.6 rates)`);
    console.log('===================================\n');

    // Save report
    const outDir = resolve(__dirname, '../../eval-results');
    await mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(outDir, `${stamp}.json`);
    await writeFile(file, JSON.stringify({ summary, results }, null, 2));
    logger.info({ message: 'eval complete', report: file });
  } finally {
    await app.close();
  }
}

function summarise(results: EvalResult[]) {
  const byTier: Record<
    string,
    { total: number; passed: number; passRate: number; avgScore: number }
  > = {};
  for (const r of results) {
    const t = (byTier[r.tier] ??= { total: 0, passed: 0, passRate: 0, avgScore: 0 });
    t.total += 1;
    if (r.pass) t.passed += 1;
    t.avgScore += r.score;
  }
  for (const k of Object.keys(byTier)) {
    const t = byTier[k]!;
    t.passRate = t.total === 0 ? 0 : t.passed / t.total;
    t.avgScore = t.total === 0 ? 0 : t.avgScore / t.total;
  }

  const sortedLatencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const totalIn = results.reduce((s, r) => s + (r.tokens.input ?? 0), 0);
  const totalOut = results.reduce((s, r) => s + (r.tokens.output ?? 0), 0);
  // Sonnet 4.6 Bedrock list price as of 2026: $3/M input, $15/M output.
  const estimatedCostUsd = (totalIn / 1_000_000) * 3 + (totalOut / 1_000_000) * 15;

  return {
    byTier,
    latencyP50: percentile(sortedLatencies, 0.5),
    latencyP95: percentile(sortedLatencies, 0.95),
    avgIterations: results.reduce((s, r) => s + r.iterations, 0) / Math.max(results.length, 1),
    maxIterations: Math.max(0, ...results.map((r) => r.iterations)),
    totalInputTokens: totalIn,
    totalOutputTokens: totalOut,
    estimatedCostUsd,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor(sorted.length * p), sorted.length - 1);
  return sorted[idx] ?? 0;
}

main().catch((err) => {
  logger.error('eval failed', {
    err: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
