import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { FhirBundle } from './fhir-types';
import { mapAllergy } from './mappers/allergy.mapper';
import { mapCondition } from './mappers/condition.mapper';
import { mapDiagnosticReport } from './mappers/diagnostic-report.mapper';
import { mapEncounter } from './mappers/encounter.mapper';
import { mapImmunization } from './mappers/immunization.mapper';
import { mapMedication } from './mappers/medication.mapper';
import { mapObservation } from './mappers/observation.mapper';
import { mapPatient } from './mappers/patient.mapper';
import { mapProcedure } from './mappers/procedure.mapper';
import type { MapperContext } from './mappers/context';
import { TX_TIMEOUT_MS } from './synthea.constants';
import type { ResourceBuckets, SyntheaBundleResult } from './synthea.types';

@Injectable()
export class SyntheaIngestionService {
  private readonly logger = new Logger(SyntheaIngestionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingestBundle(bundle: unknown): Promise<SyntheaBundleResult> {
    const parsed = FhirBundle.parse(bundle);

    const patientEntry = parsed.entry.find((e) => getResourceType(e.resource) === 'Patient');
    if (!patientEntry?.resource) {
      throw new Error('Bundle has no Patient resource');
    }

    // First pass: pre-allocate db_uuids for every resource so cross-references
    // resolve regardless of entry order.
    const urnToDbId = this.buildUrnMap(parsed.entry);
    const patientDbId = urnToDbId.get(patientEntry.fullUrl ?? '');
    if (!patientDbId) throw new Error('Patient db id not pre-allocated');

    const { row: patientRow, syntheaId: syntheaPatientId } = mapPatient(
      patientEntry.resource,
      patientDbId,
    );

    // Idempotency: skip if we've already ingested this patient.
    const existing = await this.prisma.patient.findUnique({
      where: { syntheaId: syntheaPatientId },
      select: { id: true },
    });
    if (existing) {
      this.logger.log(`patient ${syntheaPatientId} already ingested, skipping`);
      return { patientId: existing.id, syntheaPatientId, skipped: true, counts: {} };
    }

    const ctx: MapperContext = { patientDbId, urnToDbId };
    const buckets = this.collectResources(parsed.entry, urnToDbId, ctx);

    // One transaction wraps the patient insert + all bulk inserts. If
    // anything fails partway through, the whole bundle rolls back.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.patient.create({ data: patientRow });
        if (buckets.encounters.length) await tx.encounter.createMany({ data: buckets.encounters });
        if (buckets.conditions.length) await tx.condition.createMany({ data: buckets.conditions });
        if (buckets.medications.length)
          await tx.medication.createMany({ data: buckets.medications });
        if (buckets.observations.length)
          await tx.observation.createMany({ data: buckets.observations });
        if (buckets.procedures.length) await tx.procedure.createMany({ data: buckets.procedures });
        if (buckets.allergies.length) await tx.allergy.createMany({ data: buckets.allergies });
        if (buckets.immunizations.length)
          await tx.immunization.createMany({ data: buckets.immunizations });
        if (buckets.diagnosticReports.length)
          await tx.diagnosticReport.createMany({ data: buckets.diagnosticReports });
      },
      { timeout: TX_TIMEOUT_MS },
    );

    const counts: Record<string, number> = {
      patients: 1,
      encounters: buckets.encounters.length,
      conditions: buckets.conditions.length,
      medications: buckets.medications.length,
      observations: buckets.observations.length,
      procedures: buckets.procedures.length,
      allergies: buckets.allergies.length,
      immunizations: buckets.immunizations.length,
      diagnosticReports: buckets.diagnosticReports.length,
    };

    return { patientId: patientDbId, syntheaPatientId, skipped: false, counts };
  }

  // First pass — allocate a stable db_uuid per FHIR entry so references
  // (e.g., observation.encounter → "urn:uuid:enc-...") resolve even when
  // the referenced entry appears later in the bundle.
  private buildUrnMap(
    entries: readonly { fullUrl?: string; resource: unknown }[],
  ): Map<string, string> {
    const urnToDbId = new Map<string, string>();
    for (const entry of entries) {
      const resourceType = getResourceType(entry.resource);
      const id = getResourceId(entry.resource);
      if (!resourceType) continue;
      const dbId = randomUUID();
      if (entry.fullUrl) urnToDbId.set(entry.fullUrl, dbId);
      if (id) urnToDbId.set(`${resourceType}/${id}`, dbId);
    }
    return urnToDbId;
  }

  // Second pass — dispatch each entry to the appropriate mapper and collect
  // rows into per-resource-type buckets.
  private collectResources(
    entries: readonly { fullUrl?: string; resource: unknown }[],
    urnToDbId: Map<string, string>,
    ctx: MapperContext,
  ): ResourceBuckets {
    const buckets: ResourceBuckets = {
      encounters: [],
      conditions: [],
      medications: [],
      observations: [],
      procedures: [],
      allergies: [],
      immunizations: [],
      diagnosticReports: [],
    };

    for (const entry of entries) {
      const resourceType = getResourceType(entry.resource);
      if (!resourceType) continue;

      switch (resourceType) {
        case 'Encounter': {
          const dbId = urnToDbId.get(entry.fullUrl ?? '');
          if (!dbId) continue;
          buckets.encounters.push(mapEncounter(entry.resource, ctx, dbId));
          break;
        }
        case 'Condition':
          buckets.conditions.push(mapCondition(entry.resource, ctx));
          break;
        case 'MedicationRequest':
          buckets.medications.push(mapMedication(entry.resource, ctx));
          break;
        case 'Observation':
          buckets.observations.push(mapObservation(entry.resource, ctx));
          break;
        case 'Procedure':
          buckets.procedures.push(mapProcedure(entry.resource, ctx));
          break;
        case 'AllergyIntolerance':
          buckets.allergies.push(mapAllergy(entry.resource, ctx));
          break;
        case 'Immunization':
          buckets.immunizations.push(mapImmunization(entry.resource, ctx));
          break;
        case 'DiagnosticReport':
          buckets.diagnosticReports.push(mapDiagnosticReport(entry.resource, ctx));
          break;
        // Patient is handled separately; everything else is intentionally ignored.
      }
    }

    return buckets;
  }
}

// ----------------------------------------------------------------------------
// Local helpers — narrow the unsafe `unknown` from FhirBundle.entry without
// per-call zod parsing.
// ----------------------------------------------------------------------------

function getResourceType(resource: unknown): string | undefined {
  if (resource && typeof resource === 'object' && 'resourceType' in resource) {
    const t = (resource as { resourceType?: unknown }).resourceType;
    return typeof t === 'string' ? t : undefined;
  }
  return undefined;
}

function getResourceId(resource: unknown): string | undefined {
  if (resource && typeof resource === 'object' && 'id' in resource) {
    const id = (resource as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}
