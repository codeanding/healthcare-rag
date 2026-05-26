// Shared helpers for FHIR-resource mappers.
//
// Each mapper is a pure function — no DI, no Prisma calls — so it can be
// unit-tested by feeding a parsed FHIR resource and asserting the row shape.

import type { Coding, Reference } from '../fhir-types';

export interface MapperContext {
  patientDbId: string;
  urnToDbId: ReadonlyMap<string, string>;
}

// FHIR references in Synthea bundles take two forms:
//   - "urn:uuid:abc-123-..."  (used inside transaction bundles)
//   - "Encounter/abc-123"     (used between resource collections)
// The orchestrator maps both forms to the same db_uuid in a first pass, so
// resolveRef just looks them up.
export function resolveRef(ctx: MapperContext, ref: Reference | undefined): string | null {
  const lookup = ref?.reference;
  if (!lookup) return null;
  return ctx.urnToDbId.get(lookup) ?? null;
}

// Normalise the wide variety of FHIR coding-system URLs to the short label we
// store in `code_system`. New systems just slot in here.
export function codeSystemName(coding: Coding | undefined): string | undefined {
  const sys = coding?.system?.toLowerCase();
  if (!sys) return undefined;
  if (sys.includes('snomed')) return 'SNOMED';
  if (sys.includes('loinc')) return 'LOINC';
  if (sys.includes('rxnorm')) return 'RxNorm';
  if (sys.includes('icd-10') || sys.includes('icd10')) return 'ICD10';
  if (sys.includes('cvx')) return 'CVX';
  return coding?.system;
}

// Helper used by every coded resource: pull the first coding + display, falling
// back to the human-readable text on the CodeableConcept itself.
export function pickCoding(codeable: { coding?: Coding[]; text?: string } | undefined): {
  code: string | undefined;
  codeSystem: string | undefined;
  display: string | undefined;
} {
  const coding = codeable?.coding?.[0];
  return {
    code: coding?.code,
    codeSystem: codeSystemName(coding),
    display: coding?.display ?? codeable?.text,
  };
}

export function toDate(input: string | undefined | null): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}
