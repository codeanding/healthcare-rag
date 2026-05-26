// Per-bundle transaction timeout. Geriatric Synthea bundles can have 5k+
// resources; default Prisma timeout (5s) is not enough.
export const TX_TIMEOUT_MS = 60_000;

// US-Core extension URLs for race/ethnicity demographics. Synthea wraps the
// race/ethnicity coding inside one of these outer extensions on the Patient.
export const US_CORE_RACE = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race';
export const US_CORE_ETHNICITY =
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity';
