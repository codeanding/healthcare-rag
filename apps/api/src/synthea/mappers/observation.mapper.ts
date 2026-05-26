import type { Prisma } from '@prisma/client';
import { ObservationResource } from '../fhir-types';
import { type MapperContext, pickCoding, resolveRef, toDate } from './context';

export function mapObservation(
  resource: unknown,
  ctx: MapperContext,
): Prisma.ObservationCreateManyInput {
  const r = ObservationResource.parse(resource);
  const { code, codeSystem, display } = pickCoding(r.code);
  return {
    patientId: ctx.patientDbId,
    encounterId: resolveRef(ctx, r.encounter),
    code,
    codeSystem,
    display,
    category: r.category?.[0]?.coding?.[0]?.code,
    valueNumeric: r.valueQuantity?.value !== undefined ? r.valueQuantity.value : null,
    valueString: r.valueString,
    unit: r.valueQuantity?.unit,
    effectiveDate: toDate(r.effectiveDateTime),
  };
}
