import type { QueryMetrics, ToolCallTrace } from '@aws-rag/shared';

// Reactive state surfaced by useStreamQuery to consumers (App.tsx).
export interface StreamingState {
  streamingText: string;
  toolCalls: ToolCallTrace[];
  isStreaming: boolean;
  error: string | null;
  iterations: number;
  metrics: QueryMetrics | null;
}

// Mutable timing accumulator scoped to a single send(). Lives outside React
// state so updating it on every event doesn't trigger re-renders — only the
// derived `metrics` ends up in StreamingState (computed at end of stream).
export interface TimingState {
  requestStartAt: number;
  firstTokenAt: number | null;
  endAt: number | null;
  toolStartByUseId: Map<string, number>;
  toolLatencies: Array<{ name: string; latencyMs: number; toolUseId: string }>;
  inputTokens: number;
  outputTokens: number;
  iterations: number;
}
