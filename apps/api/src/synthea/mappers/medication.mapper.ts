import type { Prisma } from '@prisma/client';
import { MedicationRequestResource } from '../fhir-types';
import { type MapperContext, pickCoding, resolveRef, toDate } from './context';

export function mapMedication(
  resource: unknown,
  ctx: MapperContext,
): Prisma.MedicationCreateManyInput {
  const r = MedicationRequestResource.parse(resource);
  const { code, codeSystem, display } = pickCoding(r.medicationCodeableConcept);
  return {
    patientId: ctx.patientDbId,
    encounterId: resolveRef(ctx, r.encounter),
    code,
    codeSystem,
    display,
    status: r.status,
    authoredOn: toDate(r.authoredOn),
    periodStart: toDate(r.dispenseRequest?.validityPeriod?.start),
    periodEnd: toDate(r.dispenseRequest?.validityPeriod?.end),
    dosageText: r.dosageInstruction?.[0]?.text,
  };
}
