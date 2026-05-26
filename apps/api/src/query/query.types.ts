// Internal types for QueryService stream processing. Public-facing types
// (QueryResult, StreamEvent, etc.) live in @aws-rag/shared.

import type { ContentBlock } from '@aws-sdk/client-bedrock-runtime';
import type { ToolCallTrace } from '@aws-rag/shared';

// Stream-block accumulators. Bedrock's contentBlockDelta events are keyed by
// contentBlockIndex — text and toolUse blocks can interleave within one
// assistant turn. We accumulate per-index, reconstructing the assistant
// message in original order at messageStop.

export interface TextBlockState {
  type: 'text';
  text: string;
}

export interface ToolUseBlockState {
  type: 'tool_use';
  name: string;
  toolUseId: string;
  inputJson: string;
}

export type BlockState = TextBlockState | ToolUseBlockState;

// Result of executing a single tool call: the trace we surface to clients
// plus the toolResult content block we feed back to Claude.
export interface ToolExecution {
  trace: ToolCallTrace;
  resultBlock: ContentBlock;
  toolUseId: string;
}

// HTTP request body for POST /api/patients/:id/query and .../stream.
export interface QueryDto {
  question: string;
}
