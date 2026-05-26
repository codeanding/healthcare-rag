import type { Prisma } from '@prisma/client';
import { ProcedureResource } from '../fhir-types';
import { type MapperContext, pickCoding, resolveRef, toDate } from './context';

export function mapProcedure(
  resource: unknown,
  ctx: MapperContext,
): Prisma.ProcedureCreateManyInput {
  const r = ProcedureResource.parse(resource);
  const { code, codeSystem, display } = pickCoding(r.code);
  const performed = r.performedDateTime ?? r.performedPeriod?.start;
  return {
    patientId: ctx.patientDbId,
    encounterId: resolveRef(ctx, r.encounter),
    code,
    codeSystem,
    display,
    performedDate: toDate(performed),
  };
}
