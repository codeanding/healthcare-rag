import type { Prisma } from '@prisma/client';
import { AllergyIntoleranceResource } from '../fhir-types';
import { type MapperContext, pickCoding, toDate } from './context';

export function mapAllergy(resource: unknown, ctx: MapperContext): Prisma.AllergyCreateManyInput {
  const r = AllergyIntoleranceResource.parse(resource);
  const { code, display } = pickCoding(r.code);
  return {
    patientId: ctx.patientDbId,
    substanceCode: code,
    substanceDisplay: display,
    criticality: r.criticality,
    recordedDate: toDate(r.recordedDate),
  };
}
