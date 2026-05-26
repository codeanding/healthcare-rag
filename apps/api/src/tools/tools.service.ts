import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toSql } from 'pgvector';
import { BedrockService } from '../aws/bedrock/bedrock.service';
import { PrismaService } from '../db/prisma.service';
import {
  ENCOUNTER_TAKE,
  HNSW_EF_SEARCH,
  LAB_TAKE_LATEST,
  LAB_TAKE_TREND,
  SEARCH_NOTES_DEFAULT_K,
  SEARCH_NOTES_MAX_K,
  STRUCTURED_TAKE,
} from './tools.constants';
import type { RawSearchRow, ToolInput } from './tools.types';

@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bedrock: BedrockService,
  ) {}

  // Tool dispatcher used by QueryService. patientId is bound from the URL,
  // never derived from the model's input — this is the security boundary.
  async execute(toolName: string, input: ToolInput, patientId: string): Promise<unknown> {
    switch (toolName) {
      case 'get_medications':
        return this.getMedications(patientId, input);
      case 'get_conditions':
        return this.getConditions(patientId, input);
      case 'get_labs':
        return this.getLabs(patientId, input);
      case 'get_allergies':
        return this.getAllergies(patientId);
      case 'get_encounters':
        return this.getEncounters(patientId, input);
      case 'get_immunizations':
        return this.getImmunizations(patientId);
      case 'search_notes':
        return this.searchNotes(patientId, input);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async getMedications(patientId: string, input: ToolInput) {
    const activeOnly = input.active_only !== false; // default true
    const since = parseDate(input.since);

    const where: Prisma.MedicationWhereInput = { patientId };
    if (activeOnly) {
      // "Active" = both the workflow status is 'active' AND the prescribed
      // period covers today. Synthea sometimes leaves period_end in the
      // future on completed prescriptions, so filtering on period alone
      // over-reports.
      where.AND = [
        { status: 'active' },
        { OR: [{ periodEnd: null }, { periodEnd: { gt: new Date() } }] },
      ];
    }
    if (since) {
      where.periodStart = { gte: since };
    }

    const rows = await this.prisma.medication.findMany({
      where,
      orderBy: { periodStart: 'desc' },
      take: STRUCTURED_TAKE,
    });

    return rows.map((m) => ({
      id: m.id,
      display: m.display,
      code: m.code,
      codeSystem: m.codeSystem,
      status: m.status,
      authoredOn: toIsoDateOrNull(m.authoredOn),
      periodStart: toIsoDateOrNull(m.periodStart),
      periodEnd: toIsoDateOrNull(m.periodEnd),
      dosage: m.dosageText,
    }));
  }

  private async getConditions(patientId: string, input: ToolInput) {
    const activeOnly = input.active_only === true;
    const codeSystem = typeof input.code_system === 'string' ? input.code_system : undefined;

    const where: Prisma.ConditionWhereInput = { patientId };
    if (activeOnly) where.abatementDate = null;
    if (codeSystem) where.codeSystem = codeSystem;

    const rows = await this.prisma.condition.findMany({
      where,
      orderBy: { onsetDate: 'desc' },
      take: STRUCTURED_TAKE,
    });

    return rows.map((c) => ({
      id: c.id,
      display: c.display,
      code: c.code,
      codeSystem: c.codeSystem,
      onsetDate: toIsoDateOrNull(c.onsetDate),
      abatementDate: toIsoDateOrNull(c.abatementDate),
      clinicalStatus: c.clinicalStatus,
    }));
  }

  private async getLabs(patientId: string, input: ToolInput) {
    const since = parseDate(input.since);
    const until = parseDate(input.until);
    // Default latest_only=true: most clinical questions ("most recent A1c?")
    // want one value per code. Trends require explicit latest_only=false.
    const latestOnly = input.latest_only !== false;
    const loincCodes = parseStringArray(input.loinc_codes);

    const where: Prisma.ObservationWhereInput = { patientId, category: 'laboratory' };
    if (loincCodes?.length) where.code = { in: loincCodes };
    if (since || until) {
      where.effectiveDate = {};
      if (since) where.effectiveDate.gte = since;
      if (until) where.effectiveDate.lte = until;
    }

    const rows = await this.prisma.observation.findMany({
      where,
      orderBy: { effectiveDate: 'desc' },
      take: latestOnly ? LAB_TAKE_LATEST : LAB_TAKE_TREND,
    });

    const filtered = latestOnly ? dedupeByCodeKeepingFirst(rows) : rows;

    return filtered.map((o) => ({
      id: o.id,
      display: o.display,
      code: o.code,
      codeSystem: o.codeSystem,
      value: o.valueNumeric ? Number(o.valueNumeric) : o.valueString,
      unit: o.unit,
      effectiveDate: o.effectiveDate?.toISOString() ?? null,
    }));
  }

  private async getAllergies(patientId: string) {
    const rows = await this.prisma.allergy.findMany({
      where: { patientId },
      orderBy: { recordedDate: 'desc' },
    });
    return rows.map((a) => ({
      id: a.id,
      substance: a.substanceDisplay,
      code: a.substanceCode,
      criticality: a.criticality,
      recordedDate: toIsoDateOrNull(a.recordedDate),
    }));
  }

  private async getEncounters(patientId: string, input: ToolInput) {
    const since = parseDate(input.since);
    const type = typeof input.type === 'string' ? input.type : undefined;

    const where: Prisma.EncounterWhereInput = { patientId };
    if (since) where.periodStart = { gte: since };
    if (type) where.type = { contains: type, mode: 'insensitive' };

    const rows = await this.prisma.encounter.findMany({
      where,
      orderBy: { periodStart: 'desc' },
      take: ENCOUNTER_TAKE,
    });

    return rows.map((e) => ({
      id: e.id,
      type: e.type,
      class: e.class,
      periodStart: e.periodStart?.toISOString() ?? null,
      periodEnd: e.periodEnd?.toISOString() ?? null,
      reason: e.reasonDisplay,
    }));
  }

  private async getImmunizations(patientId: string) {
    const rows = await this.prisma.immunization.findMany({
      where: { patientId },
      orderBy: { occurrenceDate: 'desc' },
    });
    return rows.map((i) => ({
      id: i.id,
      vaccine: i.vaccineDisplay,
      code: i.vaccineCode,
      occurrenceDate: toIsoDateOrNull(i.occurrenceDate),
    }));
  }

  private async searchNotes(patientId: string, input: ToolInput) {
    const query = typeof input.query === 'string' ? input.query : '';
    if (!query.trim()) {
      throw new Error('search_notes requires a non-empty query');
    }
    const k = clamp(
      typeof input.k === 'number' ? input.k : SEARCH_NOTES_DEFAULT_K,
      1,
      SEARCH_NOTES_MAX_K,
    );

    const embedding = await this.bedrock.embed(query);
    const embeddingSql = toSql(embedding);

    // HNSW + WHERE patient_id pre-filter. Set ef_search per-transaction to
    // tune recall/latency. SET LOCAL doesn't accept query parameters, so
    // we interpolate the constant directly — HNSW_EF_SEARCH is a fixed
    // integer, no injection risk.
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH}`);
      return tx.$queryRaw<RawSearchRow[]>(Prisma.sql`
				SELECT id, content, section, document_id,
				       1 - (embedding <=> ${embeddingSql}::vector) AS similarity
				FROM chunks
				WHERE patient_id = ${patientId}::uuid
				ORDER BY embedding <=> ${embeddingSql}::vector
				LIMIT ${k}
			`);
    });

    return rows.map((r) => ({
      chunkId: r.id,
      documentId: r.document_id,
      section: r.section,
      similarity: Number(r.similarity?.toFixed(3) ?? '0'),
      content: r.content,
    }));
  }
}

// ----------------------------------------------------------------------------
// Helpers (pure, unit-testable in isolation)
// ----------------------------------------------------------------------------

function parseDate(input: unknown): Date | undefined {
  if (typeof input !== 'string' || !input) return undefined;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const strings = input.filter((c): c is string => typeof c === 'string');
  return strings.length > 0 ? strings : undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function toIsoDateOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// Rows are sorted desc by date; the FIRST occurrence per code is the most
// recent. (Native `new Map(rows.map(...))` would keep the LAST value per key,
// silently inverting the order.)
function dedupeByCodeKeepingFirst<T extends { code: string | null; id: string }>(rows: T[]): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) {
    const key = r.code ?? r.id;
    if (!seen.has(key)) seen.set(key, r);
  }
  return Array.from(seen.values());
}
