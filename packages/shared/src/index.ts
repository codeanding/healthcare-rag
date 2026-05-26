// Single source of truth for types crossing the api ↔ web boundary.
// Both apps depend on this package via `workspace:*`.

// ----------------------------------------------------------------------------
// Agentic query — streaming + non-streaming
// ----------------------------------------------------------------------------

export interface ToolCallTrace {
  name: string;
  input: unknown;
  result: unknown;
}

export interface QueryUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface QueryResult {
  answer: string;
  toolCalls: ToolCallTrace[];
  iterations: number;
  usage: QueryUsage;
}

export type StreamEvent =
  | { type: 'iteration'; n: number }
  | { type: 'token'; text: string }
  | { type: 'tool_use_start'; name: string; toolUseId: string }
  | { type: 'tool_call'; name: string; input: unknown; result: unknown; toolUseId: string }
  | { type: 'done'; toolCalls: ToolCallTrace[]; iterations: number; usage: QueryUsage }
  | { type: 'error'; message: string };

// ----------------------------------------------------------------------------
// Patient API responses (camelCase — see refactor #H5 dropping snake_case)
// ----------------------------------------------------------------------------

export interface PatientSummary {
  id: string;
  givenName: string;
  familyName: string;
  birthDate: string; // ISO date YYYY-MM-DD
  gender: string | null;
  encounterCount: number;
  medicationCount: number;
  conditionCount: number;
  topConditions: string[];
}

export interface PatientDetail {
  id: string;
  givenName: string;
  familyName: string;
  birthDate: string;
  gender: string | null;
  race: string | null;
  ethnicity: string | null;
  activeMedications: number;
  activeConditions: number;
  allergies: number;
  latestEncounter: { type: string | null; date: string | null } | null;
}

// ----------------------------------------------------------------------------
// Frontend-only metrics derived from StreamEvent timing
// ----------------------------------------------------------------------------

export interface QueryMetrics {
  ttftMs: number | null;
  totalMs: number;
  generationMs: number | null;
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  toolLatencies: Array<{ name: string; latencyMs: number; toolUseId: string }>;
}
