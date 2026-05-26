// Public types for the auto-eval pipeline. Run-eval.ts also defines its own
// EvalResult here to keep all eval shapes co-located.

export type Tier = 'factoid' | 'temporal' | 'reasoning';

// Deterministic facts pulled from a patient's structured tables. Question
// generators turn this into EvalQuestions, graders compare assistant answers
// against it.
export interface GroundTruth {
  patientId: string;
  patientName: string;
  activeMedications: string[];
  activeConditions: string[];
  allergies: string[];
  latestObservation?: {
    code: string;
    display: string;
    value: number;
    unit: string;
    date: string; // YYYY-MM-DD
  };
  latestEncounter?: {
    type: string;
    date: string;
  };
}

export interface EvalQuestion {
  id: string;
  patientId: string;
  tier: Tier;
  kind: string; // sub-type, e.g. 'list_meds', 'latest_lab'
  question: string;
  groundTruth: unknown;
}

export interface GradeResult {
  pass: boolean;
  score: number; // 0..1
  reason: string;
  details?: Record<string, unknown>;
}

// One row of the JSON report saved by run-eval.ts.
export interface EvalResult {
  questionId: string;
  patientId: string;
  patientName: string;
  tier: Tier;
  kind: string;
  question: string;
  groundTruth: unknown;
  answer: string;
  pass: boolean;
  score: number;
  reason: string;
  latencyMs: number;
  iterations: number;
  toolCalls: Array<{ name: string; input: unknown }>;
  tokens: { input?: number; output?: number };
}
