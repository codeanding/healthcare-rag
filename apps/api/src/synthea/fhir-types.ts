import { z } from 'zod';

// Minimal zod schemas for the FHIR R4 fields Synthea bundles us — only what
// the ingestion service reads, not the full spec.

const Coding = z.object({
  system: z.string().optional(),
  code: z.string().optional(),
  display: z.string().optional(),
});
export type Coding = z.infer<typeof Coding>;

const CodeableConcept = z.object({
  coding: z.array(Coding).optional(),
  text: z.string().optional(),
});

const Reference = z.object({
  reference: z.string().optional(),
  display: z.string().optional(),
});
export type Reference = z.infer<typeof Reference>;

const Period = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
});

const Quantity = z.object({
  value: z.number().optional(),
  unit: z.string().optional(),
  system: z.string().optional(),
  code: z.string().optional(),
});

// US-Core extensions for race/ethnicity show up as nested extensions.
const Extension = z
  .object({
    url: z.string(),
    extension: z.array(z.unknown()).optional(),
    valueString: z.string().optional(),
    valueCoding: Coding.optional(),
  })
  .passthrough();

const HumanName = z.object({
  use: z.string().optional(),
  family: z.string().optional(),
  given: z.array(z.string()).optional(),
});

export const PatientResource = z
  .object({
    resourceType: z.literal('Patient'),
    id: z.string(),
    name: z.array(HumanName).optional(),
    birthDate: z.string().optional(),
    gender: z.string().optional(),
    maritalStatus: CodeableConcept.optional(),
    extension: z.array(Extension).optional(),
  })
  .passthrough();

export const EncounterResource = z
  .object({
    resourceType: z.literal('Encounter'),
    id: z.string().optional(),
    subject: Reference,
    type: z.array(CodeableConcept).optional(),
    class: z.union([Coding, z.string()]).optional(),
    period: Period.optional(),
    reasonCode: z.array(CodeableConcept).optional(),
  })
  .passthrough();

export const ConditionResource = z
  .object({
    resourceType: z.literal('Condition'),
    id: z.string().optional(),
    subject: Reference,
    encounter: Reference.optional(),
    code: CodeableConcept.optional(),
    onsetDateTime: z.string().optional(),
    abatementDateTime: z.string().optional(),
    clinicalStatus: CodeableConcept.optional(),
  })
  .passthrough();

export const MedicationRequestResource = z
  .object({
    resourceType: z.literal('MedicationRequest'),
    id: z.string().optional(),
    subject: Reference,
    encounter: Reference.optional(),
    medicationCodeableConcept: CodeableConcept.optional(),
    status: z.string().optional(),
    authoredOn: z.string().optional(),
    dispenseRequest: z.object({ validityPeriod: Period.optional() }).passthrough().optional(),
    dosageInstruction: z.array(z.object({ text: z.string().optional() }).passthrough()).optional(),
  })
  .passthrough();

export const ObservationResource = z
  .object({
    resourceType: z.literal('Observation'),
    id: z.string().optional(),
    subject: Reference,
    encounter: Reference.optional(),
    code: CodeableConcept.optional(),
    category: z.array(CodeableConcept).optional(),
    valueQuantity: Quantity.optional(),
    valueString: z.string().optional(),
    effectiveDateTime: z.string().optional(),
  })
  .passthrough();

export const ProcedureResource = z
  .object({
    resourceType: z.literal('Procedure'),
    id: z.string().optional(),
    subject: Reference,
    encounter: Reference.optional(),
    code: CodeableConcept.optional(),
    performedDateTime: z.string().optional(),
    performedPeriod: Period.optional(),
  })
  .passthrough();

export const AllergyIntoleranceResource = z
  .object({
    resourceType: z.literal('AllergyIntolerance'),
    id: z.string().optional(),
    patient: Reference,
    code: CodeableConcept.optional(),
    criticality: z.string().optional(),
    recordedDate: z.string().optional(),
  })
  .passthrough();

export const ImmunizationResource = z
  .object({
    resourceType: z.literal('Immunization'),
    id: z.string().optional(),
    patient: Reference,
    vaccineCode: CodeableConcept.optional(),
    occurrenceDateTime: z.string().optional(),
  })
  .passthrough();

export const DiagnosticReportResource = z
  .object({
    resourceType: z.literal('DiagnosticReport'),
    id: z.string().optional(),
    subject: Reference,
    encounter: Reference.optional(),
    code: CodeableConcept.optional(),
    category: z.array(CodeableConcept).optional(),
    issued: z.string().optional(),
    conclusion: z.string().optional(),
  })
  .passthrough();

export const BundleEntry = z
  .object({
    fullUrl: z.string().optional(),
    resource: z.unknown(),
  })
  .passthrough();

export const FhirBundle = z
  .object({
    resourceType: z.literal('Bundle'),
    entry: z.array(BundleEntry),
  })
  .passthrough();

export type FhirBundle = z.infer<typeof FhirBundle>;
