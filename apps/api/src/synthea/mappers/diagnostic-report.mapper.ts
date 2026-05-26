import type { Prisma } from '@prisma/client';
import { DiagnosticReportResource } from '../fhir-types';
import { type MapperContext, pickCoding, resolveRef, toDate } from './context';

export function mapDiagnosticReport(
  resource: unknown,
  ctx: MapperContext,
): Prisma.DiagnosticReportCreateManyInput {
  const r = DiagnosticReportResource.parse(resource);
  const { code, codeSystem, display } = pickCoding(r.code);
  return {
    patientId: ctx.patientDbId,
    encounterId: resolveRef(ctx, r.encounter),
    code,
    codeSystem,
    display,
    category: r.category?.[0]?.coding?.[0]?.code,
    issued: toDate(r.issued),
    conclusion: r.conclusion,
  };
}
