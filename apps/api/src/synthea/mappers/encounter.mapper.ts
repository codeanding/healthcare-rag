import type { Prisma } from '@prisma/client';
import { EncounterResource } from '../fhir-types';
import type { MapperContext } from './context';
import { toDate } from './context';

export function mapEncounter(
  resource: unknown,
  ctx: MapperContext,
  dbId: string,
): Prisma.EncounterCreateManyInput {
  const enc = EncounterResource.parse(resource);
  const reasonCoding = enc.reasonCode?.[0]?.coding?.[0];
  return {
    id: dbId,
    patientId: ctx.patientDbId,
    syntheaId: enc.id,
    type: enc.type?.[0]?.coding?.[0]?.display ?? enc.type?.[0]?.text,
    class: typeof enc.class === 'string' ? enc.class : enc.class?.code,
    periodStart: toDate(enc.period?.start),
    periodEnd: toDate(enc.period?.end),
    reasonCode: reasonCoding?.code,
    reasonDisplay: reasonCoding?.display ?? enc.reasonCode?.[0]?.text,
  };
}
