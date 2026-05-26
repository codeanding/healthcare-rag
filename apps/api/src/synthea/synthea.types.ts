import type { Prisma } from '@prisma/client';

export interface SyntheaBundleResult {
  patientId: string;
  syntheaPatientId: string;
  skipped: boolean;
  counts: Record<string, number>;
}

// All resource-row buckets accumulated during a bundle scan. One createMany
// per non-empty bucket fires inside the ingestion transaction.
export interface ResourceBuckets {
  encounters: Prisma.EncounterCreateManyInput[];
  conditions: Prisma.ConditionCreateManyInput[];
  medications: Prisma.MedicationCreateManyInput[];
  observations: Prisma.ObservationCreateManyInput[];
  procedures: Prisma.ProcedureCreateManyInput[];
  allergies: Prisma.AllergyCreateManyInput[];
  immunizations: Prisma.ImmunizationCreateManyInput[];
  diagnosticReports: Prisma.DiagnosticReportCreateManyInput[];
}

// Used by the patient mapper to walk US-Core race/ethnicity nested extensions.
export interface ExtensionWithDisplay {
  url: string;
  extension?: Array<{ valueCoding?: { display?: string } }>;
}
