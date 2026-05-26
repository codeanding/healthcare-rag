import type { PatientDetail, PatientSummary } from '@aws-rag/shared';
import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { TOP_CONDITIONS_LIMIT } from './patients.constants';

@Controller('api/patients')
export class PatientsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(): Promise<PatientSummary[]> {
    const patients = await this.prisma.patient.findMany({
      orderBy: [{ familyName: 'asc' }, { givenName: 'asc' }],
      select: {
        id: true,
        givenName: true,
        familyName: true,
        birthDate: true,
        gender: true,
        _count: {
          select: { encounters: true, medications: true, conditions: true },
        },
      },
    });

    const topByPatient = await this.fetchTopActiveConditions(patients.map((p) => p.id));

    return patients.map((p) => ({
      id: p.id,
      givenName: p.givenName,
      familyName: p.familyName,
      birthDate: toIsoDate(p.birthDate),
      gender: p.gender,
      encounterCount: p._count.encounters,
      medicationCount: p._count.medications,
      conditionCount: p._count.conditions,
      topConditions: topByPatient.get(p.id) ?? [],
    }));
  }

  @Get(':patientId/summary')
  async summary(
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
  ): Promise<PatientDetail> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: {
        id: true,
        givenName: true,
        familyName: true,
        birthDate: true,
        gender: true,
        race: true,
        ethnicity: true,
      },
    });
    if (!patient) throw new NotFoundException(`Patient ${patientId} not found`);

    const [activeMeds, activeConditions, allergies, recentEncounter] = await Promise.all([
      // "Active" matches the get_medications tool: workflow status='active'
      // AND the prescribed period covers today. Otherwise the banner
      // over-reports vs what the chat shows.
      this.prisma.medication.count({
        where: {
          patientId,
          AND: [
            { status: 'active' },
            { OR: [{ periodEnd: null }, { periodEnd: { gt: new Date() } }] },
          ],
        },
      }),
      this.prisma.condition.count({
        where: { patientId, abatementDate: null },
      }),
      this.prisma.allergy.count({ where: { patientId } }),
      this.prisma.encounter.findFirst({
        where: { patientId },
        orderBy: { periodStart: 'desc' },
        select: { type: true, periodStart: true },
      }),
    ]);

    return {
      id: patient.id,
      givenName: patient.givenName,
      familyName: patient.familyName,
      birthDate: toIsoDate(patient.birthDate),
      gender: patient.gender,
      race: patient.race,
      ethnicity: patient.ethnicity,
      activeMedications: activeMeds,
      activeConditions: activeConditions,
      allergies,
      latestEncounter: recentEncounter
        ? {
            type: recentEncounter.type,
            date: recentEncounter.periodStart ? toIsoDate(recentEncounter.periodStart) : null,
          }
        : null,
    };
  }

  private async fetchTopActiveConditions(patientIds: string[]): Promise<Map<string, string[]>> {
    if (patientIds.length === 0) return new Map();

    const rows = await this.prisma.condition.findMany({
      where: {
        patientId: { in: patientIds },
        abatementDate: null,
        display: { not: null },
      },
      orderBy: { onsetDate: 'desc' },
      select: { patientId: true, display: true },
    });

    const byPatient = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.display) continue;
      const list = byPatient.get(row.patientId) ?? [];
      if (list.length < TOP_CONDITIONS_LIMIT) {
        list.push(row.display);
        byPatient.set(row.patientId, list);
      }
    }
    return byPatient;
  }
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
