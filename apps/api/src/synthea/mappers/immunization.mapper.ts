import type { Prisma } from '@prisma/client';
import { ImmunizationResource } from '../fhir-types';
import { type MapperContext, pickCoding, toDate } from './context';

export function mapImmunization(
  resource: unknown,
  ctx: MapperContext,
): Prisma.ImmunizationCreateManyInput {
  const r = ImmunizationResource.parse(resource);
  const { code, display } = pickCoding(r.vaccineCode);
  return {
    patientId: ctx.patientDbId,
    vaccineCode: code,
    vaccineDisplay: display,
    occurrenceDate: toDate(r.occurrenceDateTime),
  };
}
