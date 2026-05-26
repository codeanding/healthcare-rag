import 'reflect-metadata';
import '../load-env';
import { Logger } from '@aws-lambda-powertools/logger';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../db/prisma.service';

const logger = new Logger({ serviceName: 'healthcare-rag-smoke-stream' });

const DEFAULT_QUESTION =
  "List this patient's active medications and any conditions they are being treated for.";

async function main(): Promise<void> {
  const patientArg = process.argv[2];
  const question = process.argv.slice(3).join(' ') || DEFAULT_QUESTION;
  const baseUrl = process.env.API_URL ?? 'http://localhost:3000';

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  let patientId = patientArg;
  try {
    if (!patientId) {
      const prisma = app.get(PrismaService);
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
  } finally {
    await app.close();
  }

  const url = `${baseUrl}/api/patients/${patientId}/query/stream`;
  console.log(`POST ${url}`);
  console.log(`Q: ${question}\n`);
  console.log('A: ');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ question }),
  });

  if (!response.ok || !response.body) {
    const body = response.body ? await response.text() : '';
    throw new Error(`stream failed: ${response.status} ${body}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const start = Date.now();
  let firstTokenAt: number | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events: blank line (\n\n) terminates each event.
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = parseSseEvent(raw);
      if (!event) continue;
      handleEvent(event, () => {
        if (!firstTokenAt) firstTokenAt = Date.now() - start;
      });
    }
  }

  console.log(`\n\n  ttft: ${firstTokenAt}ms · total: ${Date.now() - start}ms`);
}

function parseSseEvent(raw: string): { event?: string; data: string } | null {
  const lines = raw.split('\n');
  let event: string | undefined;
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  return { event, data: data.join('\n') };
}

function handleEvent(event: { event?: string; data: string }, onToken: () => void): void {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(event.data);
  } catch {
    return;
  }
  switch (parsed.type) {
    case 'iteration':
      process.stderr.write(`\n[iter ${parsed.n}]`);
      break;
    case 'tool_use_start':
      process.stderr.write(`\n  → calling ${parsed.name}…`);
      break;
    case 'tool_call':
      process.stderr.write(
        `\n  ← ${parsed.name}: ${
          Array.isArray((parsed.result as { count?: number }) ?? parsed.result) ? 'array' : 'ok'
        }\n`,
      );
      break;
    case 'token':
      onToken();
      process.stdout.write(typeof parsed.text === 'string' ? parsed.text : '');
      break;
    case 'done':
      process.stderr.write(
        `\n  iterations=${parsed.iterations} ` +
          `in=${(parsed.usage as { inputTokens?: number } | undefined)?.inputTokens} ` +
          `out=${(parsed.usage as { outputTokens?: number } | undefined)?.outputTokens}\n`,
      );
      break;
    case 'error':
      process.stderr.write(`\n  ERROR: ${parsed.message}\n`);
      break;
  }
}

main().catch((err) => {
  logger.error('smoke-stream failed', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
