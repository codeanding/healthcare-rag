import { Injectable } from '@nestjs/common';
import type { EvalQuestion, GroundTruth } from './eval.types';

@Injectable()
export class QuestionGeneratorService {
  generate(gt: GroundTruth): EvalQuestion[] {
    const out: EvalQuestion[] = [];

    // ---------- Factoid: 3 set-based questions ----------
    if (gt.activeMedications.length > 0) {
      out.push({
        id: `${gt.patientId}:fact:meds`,
        patientId: gt.patientId,
        tier: 'factoid',
        kind: 'list_meds',
        question:
          'List all currently active medications for this patient. Give the medication name only, one per line.',
        groundTruth: { items: gt.activeMedications },
      });
    }

    if (gt.activeConditions.length > 0) {
      out.push({
        id: `${gt.patientId}:fact:conds`,
        patientId: gt.patientId,
        tier: 'factoid',
        kind: 'list_conditions',
        question:
          'List all active (unresolved) conditions for this patient. Give the condition name only, one per line.',
        groundTruth: { items: gt.activeConditions },
      });
    }

    if (gt.allergies.length > 0) {
      out.push({
        id: `${gt.patientId}:fact:allergies`,
        patientId: gt.patientId,
        tier: 'factoid',
        kind: 'list_allergies',
        question:
          'List all known allergies for this patient. Give the substance name only, one per line.',
        groundTruth: { items: gt.allergies },
      });
    }

    // ---------- Temporal: numeric value + date ----------
    if (gt.latestObservation) {
      out.push({
        id: `${gt.patientId}:temp:lab`,
        patientId: gt.patientId,
        tier: 'temporal',
        kind: 'latest_lab',
        question: `What was this patient's most recent ${gt.latestObservation.display} value, and when was it measured? Include the value, unit, and date.`,
        groundTruth: gt.latestObservation,
      });
    }

    if (gt.latestEncounter) {
      out.push({
        id: `${gt.patientId}:temp:encounter`,
        patientId: gt.patientId,
        tier: 'temporal',
        kind: 'latest_encounter',
        question:
          "When was this patient's most recent encounter, and what type of encounter was it?",
        groundTruth: gt.latestEncounter,
      });
    }

    // ---------- Reasoning: drug-allergy cross-check ----------
    if (gt.activeMedications.length > 0 && gt.allergies.length > 0) {
      out.push({
        id: `${gt.patientId}:reason:contra`,
        patientId: gt.patientId,
        tier: 'reasoning',
        kind: 'drug_allergy',
        question:
          "Review this patient's active medications and known allergies. Are any current medications likely contraindicated by an allergy? Explain your reasoning. If none, state that clearly.",
        groundTruth: {
          medications: gt.activeMedications,
          allergies: gt.allergies,
        },
      });
    }

    return out;
  }
}
