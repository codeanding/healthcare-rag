import 'reflect-metadata';
import '../load-env';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@aws-lambda-powertools/logger';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IngestionService } from '../ingestion/ingestion.service';
import { SyntheaIngestionService } from '../synthea/synthea-ingestion.service';

const logger = new Logger({ serviceName: 'healthcare-rag-ingest-synthea' });

// Synthea text-export filenames are "{First}{N}_{Last}{N}_{uuid}.txt".
// We match files to bundles by the trailing UUID — that's the patient's synthea id.
function extractSyntheaId(filename: string): string | null {
  const match = filename.match(/_([0-9a-f-]{36})\.(txt|json)$/i);
  return match ? (match[1] ?? null) : null;
}

async function main(): Promise<void> {
  const outputDir = process.argv[2] ?? 'synthea-output';
  const fhirDir = join(outputDir, 'fhir');
  const textDir = join(outputDir, 'text');
  const notesDir = join(outputDir, 'notes');

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  try {
    const synthea = app.get(SyntheaIngestionService);
    const ingestion = app.get(IngestionService);

    // Build a syntheaId → text-export-filename map up front.
    let textFilesBySyntheaId = new Map<string, string>();
    try {
      for (const f of await readdir(textDir)) {
        const id = extractSyntheaId(f);
        if (id) textFilesBySyntheaId.set(id, f);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    const fhirFiles = (await readdir(fhirDir)).filter(
      // Skip non-patient files Synthea generates (org/practitioner registries)
      (f) =>
        f.endsWith('.json') &&
        !f.startsWith('hospitalInformation') &&
        !f.startsWith('practitionerInformation'),
    );
    logger.info({
      message: 'starting structured ingestion',
      bundles: fhirFiles.length,
      textExports: textFilesBySyntheaId.size,
    });

    const totals = { patients: 0, skipped: 0, baselineDocs: 0, synthesizedNotes: 0 };
    const counts: Record<string, number> = {};

    for (const file of fhirFiles) {
      const path = join(fhirDir, file);
      const bundle = JSON.parse(await readFile(path, 'utf-8'));
      const result = await synthea.ingestBundle(bundle);
      if (result.skipped) {
        totals.skipped += 1;
        // Don't `continue` here — still process any new notes for this
        // patient. ingestTextDocument is idempotent on s3_key, so already-
        // ingested docs are no-ops.
      } else {
        totals.patients += 1;
        for (const [k, v] of Object.entries(result.counts)) {
          counts[k] = (counts[k] ?? 0) + v;
        }
      }

      // 1. Baseline: ingest the Synthea text export as a single document.
      //    Gives search_notes something to retrieve even before SOAP synthesis runs.
      //    ingestTextDocument is idempotent — re-runs are no-ops.
      const textFile = textFilesBySyntheaId.get(result.syntheaPatientId);
      if (textFile) {
        const text = await readFile(join(textDir, textFile), 'utf-8');
        const identifier = `synthea://patient/${result.syntheaPatientId}/summary`;
        const r = await ingestion.ingestTextDocument(
          text,
          identifier,
          'synthea-summary',
          result.patientId,
          `Patient summary: ${result.syntheaPatientId}`,
        );
        if (!('skipped' in r)) totals.baselineDocs += 1;
      }

      // 2. Synthesized SOAP-style notes per encounter (if previously generated)
      const patientNotesDir = join(notesDir, result.syntheaPatientId);
      try {
        const noteFiles = await readdir(patientNotesDir);
        for (const note of noteFiles.filter((f) => f.endsWith('.txt'))) {
          const text = await readFile(join(patientNotesDir, note), 'utf-8');
          const encounterId = note.replace(/\.txt$/, '');
          const identifier = `synthea://patient/${result.syntheaPatientId}/encounter/${encounterId}`;
          const r = await ingestion.ingestTextDocument(
            text,
            identifier,
            'synthea-note',
            result.patientId,
            `Encounter note: ${encounterId}`,
          );
          if (!('skipped' in r)) totals.synthesizedNotes += 1;
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        // No synthesized notes for this patient — that's fine.
      }
    }

    logger.info({ message: 'synthea ingestion complete', ...totals, ...counts });
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  logger.error('synthea ingestion failed', {
    err: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
