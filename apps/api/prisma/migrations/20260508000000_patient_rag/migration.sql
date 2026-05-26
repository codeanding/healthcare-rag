-- Patient-RAG migration: adds 9 FHIR-aligned tables, modifies documents/chunks
-- for patient scoping, replaces the documents.s3_key UNIQUE constraint with a
-- partial unique index (s3_key is now nullable).

-- ----- Patients & encounters -----

CREATE TABLE "patients" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "synthea_id" TEXT NOT NULL,
  "given_name" TEXT NOT NULL,
  "family_name" TEXT NOT NULL,
  "birth_date" DATE NOT NULL,
  "gender" TEXT,
  "race" TEXT,
  "ethnicity" TEXT,
  "marital_status" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "patients_synthea_id_key" ON "patients"("synthea_id");

CREATE TABLE "encounters" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "patient_id" UUID NOT NULL,
  "synthea_id" TEXT,
  "type" TEXT,
  "class" TEXT,
  "period_start" TIMESTAMPTZ,
  "period_end" TIMESTAMPTZ,
  "reason_code" TEXT,
  "reason_display" TEXT,
  CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "encounters_patient_idx" ON "encounters"("patient_id", "period_start" DESC);

-- ----- Coded clinical resources -----

CREATE TABLE "conditions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "patient_id" UUID NOT NULL,
  "encounter_id" UUID,
  "code" TEXT,
  "code_system" TEXT,
  "display" TEXT,
  "onset_date" DATE,
  "abatement_date" DATE,
  "clinical_status" TEXT,
  CONSTRAINT "conditions_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_encounter_id_fkey"
  FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "conditions_patient_idx" ON "conditions"("patient_id", "onset_date" DESC);

CREATE TABLE "medications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "patient_id" UUID NOT NULL,
  "encounter_id" UUID,
  "code" TEXT,
  "code_system" TEXT,
  "display" TEXT,
  "status" TEXT,
  "authored_on" DATE,
  "period_start" DATE,
  "period_end" DATE,
  "dosage_text" TEXT,
  CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "medications" ADD CONSTRAINT "medications_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medications" ADD CONSTRAINT "medications_encounter_id_fkey"
  FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "medications_patient_idx" ON "medications"("patient_id", "period_start" DESC);

CREATE TABLE "observations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "patient_id" UUID NOT NULL,
  "encounter_id" UUID,
  "code" TEXT,
  "code_system" TEXT,
  "display" TEXT,
  "category" TEXT,
  "value_numeric" DECIMAL,
  "value_string" TEXT,
  "unit" TEXT,
  "effective_date" TIMESTAMPTZ,
  CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "observations" ADD CONSTRAINT "observations_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "observations" ADD CONSTRAINT "observations_encounter_id_fkey"
  FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "observations_patient_idx" ON "observations"("patient_id", "effective_date" DESC);
CREATE INDEX "observations_code_idx" ON "observations"("patient_id", "code", "effective_date" DESC);

CREATE TABLE "procedures" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "patient_id" UUID NOT NULL,
  "encounter_id" UUID,
  "code" TEXT,
  "code_system" TEXT,
  "display" TEXT,
  "performed_date" DATE,
  CONSTRAINT "procedures_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_encounter_id_fkey"
  FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "procedures_patient_idx" ON "procedures"("patient_id", "performed_date" DESC);

CREATE TABLE "allergies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "patient_id" UUID NOT NULL,
  "substance_code" TEXT,
  "substance_display" TEXT,
  "criticality" TEXT,
  "recorded_date" DATE,
  CONSTRAINT "allergies_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "allergies_patient_idx" ON "allergies"("patient_id");

CREATE TABLE "immunizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "patient_id" UUID NOT NULL,
  "vaccine_code" TEXT,
  "vaccine_display" TEXT,
  "occurrence_date" DATE,
  CONSTRAINT "immunizations_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "immunizations" ADD CONSTRAINT "immunizations_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "immunizations_patient_idx" ON "immunizations"("patient_id", "occurrence_date" DESC);

CREATE TABLE "diagnostic_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "patient_id" UUID NOT NULL,
  "encounter_id" UUID,
  "code" TEXT,
  "code_system" TEXT,
  "display" TEXT,
  "category" TEXT,
  "issued" TIMESTAMPTZ,
  "conclusion" TEXT,
  CONSTRAINT "diagnostic_reports_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT "diagnostic_reports_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT "diagnostic_reports_encounter_id_fkey"
  FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "diagnostic_reports_patient_idx" ON "diagnostic_reports"("patient_id", "issued" DESC);

-- ----- Documents & chunks: add patient scoping -----

-- 1. Drop the old s3_key UNIQUE (column-level constraint replaced with partial index)
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_s3_key_key";
DROP INDEX IF EXISTS "documents_s3_key_key";

-- 2. Make s3_key nullable
ALTER TABLE "documents" ALTER COLUMN "s3_key" DROP NOT NULL;

-- 3. Add patient_id to documents (NOT NULL with CASCADE FK)
ALTER TABLE "documents" ADD COLUMN "patient_id" UUID;
-- (No backfill needed: ingestion has not run yet on the patient-RAG path,
--  and any rows created during the previous PDF demo are local dev only.)
DELETE FROM "chunks";
DELETE FROM "documents";
ALTER TABLE "documents" ALTER COLUMN "patient_id" SET NOT NULL;
ALTER TABLE "documents" ADD CONSTRAINT "documents_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Re-add s3_key uniqueness as a partial index (only enforced when s3_key IS NOT NULL)
CREATE UNIQUE INDEX "documents_s3_key_unique" ON "documents"("s3_key") WHERE "s3_key" IS NOT NULL;

-- 5. Add patient_id to chunks (denormalized for cheap pre-filter on vector ANN)
ALTER TABLE "chunks" ADD COLUMN "patient_id" UUID NOT NULL;
CREATE INDEX "chunks_patient_id_idx" ON "chunks"("patient_id");
