import type { Prisma } from '@prisma/client';
import { ConditionResource } from '../fhir-types';
import { type MapperContext, pickCoding, resolveRef, toDate } from './context';

export function mapCondition(
  resource: unknown,
  ctx: MapperContext,
): Prisma.ConditionCreateManyInput {
  const r = ConditionResource.parse(resource);
  const { code, codeSystem, display } = pickCoding(r.code);
  return {
    patientId: ctx.patientDbId,
    encounterId: resolveRef(ctx, r.encounter),
    code,
    codeSystem,
    display,
    onsetDate: toDate(r.onsetDateTime),
    abatementDate: toDate(r.abatementDateTime),
    clinicalStatus: r.clinicalStatus?.coding?.[0]?.code,
  };
}
