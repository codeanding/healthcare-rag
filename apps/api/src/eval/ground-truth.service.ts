import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import type { GroundTruth } from './eval.types';

@Injectable()
export class GroundTruthService {
  constructor(private readonly prisma: PrismaService) {}

  async forPatient(patientId: string): Promise<GroundTruth> {
    const patient = await this.prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
      select: { id: true, givenName: true, familyName: true },
    });

    const now = new Date();
    const [meds, conds, allergies, latestLab, latestEncounter] = await Promise.all([
      this.prisma.medication.findMany({
        where: {
          patientId,
          AND: [{ status: 'active' }, { OR: [{ periodEnd: null }, { periodEnd: { gt: now } }] }],
        },
        select: { display: true },
        orderBy: { periodStart: 'desc' },
      }),
      this.prisma.condition.findMany({
        where: { patientId, abatementDate: null, display: { not: null } },
        select: { display: true },
        orderBy: { onsetDate: 'desc' },
      }),
      this.prisma.allergy.findMany({
        where: { patientId, substanceDisplay: { not: null } },
        select: { substanceDisplay: true },
      }),
      this.prisma.observation.findFirst({
        where: {
          patientId,
          category: 'laboratory',
          valueNumeric: { not: null },
        },
        orderBy: { effectiveDate: 'desc' },
        select: {
          code: true,
          display: true,
          valueNumeric: true,
          unit: true,
          effectiveDate: true,
        },
      }),
      this.prisma.encounter.findFirst({
        where: { patientId },
        orderBy: { periodStart: 'desc' },
        select: { type: true, periodStart: true },
      }),
    ]);

    return {
      patientId: patient.id,
      patientName: `${patient.givenName} ${patient.familyName}`,
      activeMedications: dedupe(meds.map((m) => m.display ?? '').filter(Boolean)),
      activeConditions: dedupe(conds.map((c) => c.display ?? '').filter(Boolean)),
      allergies: dedupe(allergies.map((a) => a.substanceDisplay ?? '').filter(Boolean)),
      latestObservation:
        latestLab && latestLab.valueNumeric && latestLab.effectiveDate
          ? {
              code: latestLab.code ?? '',
              display: latestLab.display ?? '',
              value: Number(latestLab.valueNumeric),
              unit: latestLab.unit ?? '',
              date: latestLab.effectiveDate.toISOString().slice(0, 10),
            }
          : undefined,
      latestEncounter:
        latestEncounter?.type && latestEncounter.periodStart
          ? {
              type: latestEncounter.type,
              date: latestEncounter.periodStart.toISOString().slice(0, 10),
            }
          : undefined,
    };
  }
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}
