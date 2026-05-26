import type { Prisma } from '@prisma/client';
import { PatientResource } from '../fhir-types';
import { US_CORE_ETHNICITY, US_CORE_RACE } from '../synthea.constants';
import type { ExtensionWithDisplay } from '../synthea.types';

export function mapPatient(
  resource: unknown,
  dbId: string,
): {
  row: Prisma.PatientCreateInput;
  syntheaId: string;
} {
  const p = PatientResource.parse(resource);
  return {
    syntheaId: p.id,
    row: {
      id: dbId,
      syntheaId: p.id,
      givenName: p.name?.[0]?.given?.[0] ?? 'Unknown',
      familyName: p.name?.[0]?.family ?? 'Unknown',
      birthDate: new Date(p.birthDate ?? '1970-01-01'),
      gender: p.gender,
      race: extensionDisplay(p.extension as ExtensionWithDisplay[] | undefined, US_CORE_RACE),
      ethnicity: extensionDisplay(
        p.extension as ExtensionWithDisplay[] | undefined,
        US_CORE_ETHNICITY,
      ),
      maritalStatus: p.maritalStatus?.coding?.[0]?.display ?? p.maritalStatus?.coding?.[0]?.code,
    },
  };
}

// US-Core race/ethnicity are nested extensions: the outer extension holds
// `url=<race>`, its inner array holds `{ url: 'ompCategory', valueCoding: {...} }`.
function extensionDisplay(
  extensions: ExtensionWithDisplay[] | undefined,
  url: string,
): string | undefined {
  const root = extensions?.find((e) => e.url === url);
  if (!root?.extension) return undefined;
  for (const inner of root.extension) {
    if (inner.valueCoding?.display) return inner.valueCoding.display;
  }
  return undefined;
}
