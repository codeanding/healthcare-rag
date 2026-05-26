import 'reflect-metadata';
import '../load-env';
import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@aws-lambda-powertools/logger';
import { NestFactory } from '@nestjs/core';
import pLimit from 'p-limit';
import { AppModule } from '../app.module';
import { BedrockService } from '../aws/bedrock/bedrock.service';

const logger = new Logger({ serviceName: 'healthcare-rag-synthesize-notes' });

// Haiku is cheap and fast for synthesis. Override via BEDROCK_NOTE_SYNTH_MODEL_ID
// if your account doesn't have access to this exact model id.
const NOTE_MODEL =
  process.env.BEDROCK_NOTE_SYNTH_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const SYSTEM = `
You write realistic clinical narrative notes from FHIR data.
Output ONE SOAP-style note in Markdown with sections:

  # Encounter <date>
  ## HPI (History of Present Illness)
  ## Physical Exam
  ## Assessment
  ## Plan

Be concise (200-400 words). Use clinical phrasing. Cite specific medications,
labs, and conditions by name. Do not invent values not present in the data.
This is synthetic data — do not add disclaimers.
`.trim();

const SYNTHESIS_CONCURRENCY = 4;

interface SyntheaResource {
  resourceType?: string;
  id?: string;
  subject?: { reference?: string };
  encounter?: { reference?: string };
  [key: string]: unknown;
}

function shorten(resource: SyntheaResource): Record<string, unknown> {
  // Strip Synthea bloat: drop subject/encounter/meta, keep the rest.
  const { subject: _s, encounter: _e, meta: _m, ...rest } = resource;
  return rest;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const outputDir = process.argv[2] ?? 'synthea-output';
  const fhirDir = join(outputDir, 'fhir');
  const notesDir = join(outputDir, 'notes');

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  try {
    const bedrock = app.get(BedrockService);

    const fhirFiles = (await readdir(fhirDir)).filter(
      (f) =>
        f.endsWith('.json') &&
        !f.startsWith('hospitalInformation') &&
        !f.startsWith('practitionerInformation'),
    );

    const limit = pLimit(SYNTHESIS_CONCURRENCY);
    let synthesized = 0;
    let cached = 0;

    await Promise.all(
      fhirFiles.map((file) =>
        limit(async () => {
          const bundle = JSON.parse(await readFile(join(fhirDir, file), 'utf-8')) as {
            entry?: Array<{ resource?: SyntheaResource }>;
          };
          const entries = bundle.entry ?? [];
          const patient = entries.find((e) => e.resource?.resourceType === 'Patient')?.resource;
          if (!patient?.id) return;
          const patientId = patient.id;

          const encounters = entries
            .map((e) => e.resource)
            .filter((r): r is SyntheaResource => r?.resourceType === 'Encounter');

          await mkdir(join(notesDir, patientId), { recursive: true });

          for (const encounter of encounters) {
            if (!encounter.id) continue;
            const outFile = join(notesDir, patientId, `${encounter.id}.txt`);
            if (await exists(outFile)) {
              cached += 1;
              continue;
            }

            // Gather resources tied to this encounter
            const encRef = `urn:uuid:${encounter.id}`;
            const encRefAlt = `Encounter/${encounter.id}`;
            const related = entries
              .map((e) => e.resource)
              .filter(
                (r): r is SyntheaResource =>
                  r != null &&
                  (r.encounter?.reference === encRef || r.encounter?.reference === encRefAlt),
              );

            const context = {
              patient: shorten(patient),
              encounter: shorten(encounter),
              related: related.slice(0, 40).map(shorten),
            };

            try {
              const response = await bedrock.converse({
                modelId: NOTE_MODEL,
                system: [{ text: SYSTEM }],
                messages: [
                  {
                    role: 'user',
                    content: [
                      {
                        text: `FHIR context:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``,
                      },
                    ],
                  },
                ],
                inferenceConfig: { maxTokens: 700, temperature: 0.4 },
              });
              const text = (response.output?.message?.content ?? [])
                .flatMap((b) => ('text' in b && b.text ? [b.text] : []))
                .join('\n')
                .trim();
              if (text) {
                await writeFile(outFile, text);
                synthesized += 1;
              }
            } catch (err) {
              logger.error({
                message: 'synthesis failed',
                patientId,
                encounterId: encounter.id,
                err: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }),
      ),
    );

    logger.info({ message: 'note synthesis complete', synthesized, cached, model: NOTE_MODEL });
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  logger.error('synthesize-notes failed', {
    err: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
