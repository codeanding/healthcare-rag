import { Injectable, Logger } from '@nestjs/common';
import type {
  ContentBlock,
  ConverseStreamOutput,
  Message,
  ToolResultBlock,
  ToolUseBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { BedrockService } from '../aws/bedrock/bedrock.service';
import { ToolsService } from '../tools/tools.service';
import { TOOL_DEFINITIONS } from '../tools/tool-definitions';
import { clinicalSystemPrompt } from './system-prompt';
import { MAX_OUTPUT_TOKENS, MAX_TOOL_ITERATIONS, TEMPERATURE } from './query.constants';
import type { BlockState, TextBlockState, ToolExecution } from './query.types';
import type { QueryResult, QueryUsage, StreamEvent, ToolCallTrace } from '@aws-rag/shared';

@Injectable()
export class QueryService {
  private readonly logger = new Logger(QueryService.name);

  constructor(
    private readonly bedrock: BedrockService,
    private readonly tools: ToolsService,
  ) {}

  // Public streaming entry point — yields events as they happen.
  async *streamAboutPatient(
    patientId: string,
    question: string,
  ): AsyncGenerator<StreamEvent, void, void> {
    const messages: Message[] = [{ role: 'user', content: [{ text: question }] }];
    yield* this.runAgenticLoop(messages, patientId);
  }

  // Public non-streaming entry point — drains the same generator and returns
  // the final QueryResult. Single source of truth: streaming is the primitive,
  // non-streaming is a convenience consumer.
  async askAboutPatient(patientId: string, question: string): Promise<QueryResult> {
    const messages: Message[] = [{ role: 'user', content: [{ text: question }] }];
    const collected: { answer: string; toolCalls: ToolCallTrace[] } = {
      answer: '',
      toolCalls: [],
    };

    for await (const event of this.runAgenticLoop(messages, patientId)) {
      switch (event.type) {
        case 'token':
          collected.answer += event.text;
          break;
        case 'tool_call':
          collected.toolCalls.push({
            name: event.name,
            input: event.input,
            result: event.result,
          });
          break;
        case 'done':
          return {
            answer: collected.answer.trim(),
            toolCalls: collected.toolCalls,
            iterations: event.iterations,
            usage: event.usage,
          };
        case 'error':
          throw new Error(event.message);
      }
    }

    // Generator exhausted without a 'done' event — shouldn't happen, but
    // fail loudly if the contract ever breaks.
    throw new Error('agentic loop ended without a done event');
  }

  // ----------------------------------------------------------------------------
  // Single agentic loop shared by both public entry points.
  //
  // Bedrock Converse stream gotchas this implementation handles:
  //   1. contentBlockDelta events are keyed by contentBlockIndex — a single
  //      assistant turn can interleave a text block and one or more toolUse
  //      blocks. We accumulate per-index in a Map.
  //   2. delta.toolUse.input is a STRING containing partial JSON. Concatenate
  //      across deltas, then JSON.parse once at contentBlockStop.
  //   3. messageStop carries stopReason; metadata carries token usage. Both
  //      arrive before the stream iterator finishes.
  // ----------------------------------------------------------------------------
  private async *runAgenticLoop(
    messages: Message[],
    patientId: string,
  ): AsyncGenerator<StreamEvent, void, void> {
    const toolCalls: ToolCallTrace[] = [];
    const usage: QueryUsage = { inputTokens: 0, outputTokens: 0 };

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      yield { type: 'iteration', n: iter + 1 };

      const response = await this.bedrock.converseStream({
        system: [{ text: clinicalSystemPrompt(patientId) }],
        messages,
        toolConfig: { tools: TOOL_DEFINITIONS, toolChoice: { auto: {} } },
        inferenceConfig: { maxTokens: MAX_OUTPUT_TOKENS, temperature: TEMPERATURE },
      });

      if (!response.stream) {
        throw new Error('Bedrock converseStream returned no stream');
      }

      const { blocks, stopReason } = yield* this.consumeStream(response.stream, usage);

      // Reconstruct assistant message in original block order so subsequent
      // turns echo it back verbatim — required for tool-use matching.
      const assistantContent = reconstructAssistantContent(blocks);
      messages.push({ role: 'assistant', content: assistantContent });

      if (stopReason !== 'tool_use') {
        yield {
          type: 'done',
          toolCalls,
          iterations: iter + 1,
          usage,
        };
        return;
      }

      const toolUses = extractToolUses(assistantContent);
      const executions = await this.executeToolBatch(toolUses, patientId);

      for (const exec of executions) {
        toolCalls.push(exec.trace);
        yield {
          type: 'tool_call',
          name: exec.trace.name,
          input: exec.trace.input,
          result: exec.trace.result,
          toolUseId: exec.toolUseId,
        };
      }

      messages.push({
        role: 'user',
        content: executions.map((e) => e.resultBlock),
      });
    }

    yield {
      type: 'error',
      message: `Tool loop exceeded ${MAX_TOOL_ITERATIONS} iterations without an end_turn`,
    };
  }

  // Walks one stream's events, yielding token + tool_use_start events as they
  // arrive and returning the accumulated state at messageStop. Mutates `usage`
  // in place so the caller can sum across multiple iterations.
  private async *consumeStream(
    stream: AsyncIterable<ConverseStreamOutput>,
    usage: QueryUsage,
  ): AsyncGenerator<StreamEvent, { blocks: Map<number, BlockState>; stopReason?: string }, void> {
    const blocks = new Map<number, BlockState>();
    let stopReason: string | undefined;

    for await (const event of stream) {
      if ('contentBlockStart' in event && event.contentBlockStart) {
        const idx = event.contentBlockStart.contentBlockIndex ?? 0;
        const start = event.contentBlockStart.start;
        if (start && 'toolUse' in start && start.toolUse) {
          const name = start.toolUse.name ?? '';
          const toolUseId = start.toolUse.toolUseId ?? '';
          blocks.set(idx, { type: 'tool_use', name, toolUseId, inputJson: '' });
          yield { type: 'tool_use_start', name, toolUseId };
        }
      } else if ('contentBlockDelta' in event && event.contentBlockDelta) {
        const idx = event.contentBlockDelta.contentBlockIndex ?? 0;
        const delta = event.contentBlockDelta.delta;
        if (delta && 'text' in delta && typeof delta.text === 'string') {
          const block = blocks.get(idx) ?? ({ type: 'text', text: '' } as TextBlockState);
          if (block.type === 'text') {
            block.text += delta.text;
            blocks.set(idx, block);
          }
          yield { type: 'token', text: delta.text };
        } else if (delta && 'toolUse' in delta && delta.toolUse?.input !== undefined) {
          const block = blocks.get(idx);
          if (block?.type === 'tool_use') {
            // Partial JSON arrives across multiple deltas — concat as strings,
            // JSON.parse once at messageStop in reconstructAssistantContent.
            block.inputJson += delta.toolUse.input;
          }
        }
      } else if ('messageStop' in event && event.messageStop) {
        stopReason = event.messageStop.stopReason;
      } else if ('metadata' in event && event.metadata) {
        usage.inputTokens += event.metadata.usage?.inputTokens ?? 0;
        usage.outputTokens += event.metadata.usage?.outputTokens ?? 0;
      }
    }

    return { blocks, stopReason };
  }

  // Executes a batch of tool calls in parallel. Errors are caught per-tool so
  // one failing tool doesn't break the whole turn — the model gets a
  // `status: 'error'` toolResult and can decide how to proceed.
  private async executeToolBatch(
    toolUses: ToolUseBlock[],
    patientId: string,
  ): Promise<ToolExecution[]> {
    return Promise.all(
      toolUses.map(async (toolUse): Promise<ToolExecution> => {
        const name = toolUse.name ?? '';
        const toolUseId = toolUse.toolUseId ?? '';
        const input = (toolUse.input ?? {}) as Record<string, unknown>;

        try {
          const result = await this.tools.execute(name, input, patientId);
          return {
            trace: { name, input, result },
            resultBlock: { toolResult: buildSuccessResultBlock(toolUseId, result) },
            toolUseId,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`tool ${name} failed: ${message}`);
          return {
            trace: { name, input, result: { error: message } },
            resultBlock: { toolResult: buildErrorResultBlock(toolUseId, message) },
            toolUseId,
          };
        }
      }),
    );
  }
}

// ----------------------------------------------------------------------------
// Pure helpers (unit-testable in isolation).
// ----------------------------------------------------------------------------

function reconstructAssistantContent(blocks: Map<number, BlockState>): ContentBlock[] {
  const content: ContentBlock[] = [];
  const sortedIndices = [...blocks.keys()].sort((a, b) => a - b);
  for (const idx of sortedIndices) {
    const block = blocks.get(idx);
    if (!block) continue;
    if (block.type === 'text' && block.text) {
      content.push({ text: block.text });
    } else if (block.type === 'tool_use') {
      const input = block.inputJson ? (JSON.parse(block.inputJson) as Record<string, unknown>) : {};
      content.push({
        toolUse: {
          name: block.name,
          toolUseId: block.toolUseId,
          input: input as never, // SDK discriminated-union limitation
        },
      });
    }
  }
  return content;
}

function extractToolUses(content: ContentBlock[]): ToolUseBlock[] {
  return content.flatMap((b) => ('toolUse' in b && b.toolUse ? [b.toolUse] : []));
}

// Bedrock Converse requires `json` to be an object — arrays/primitives must be
// wrapped. We standardise to `{ result, count }` for arrays so the model sees
// a predictable top-level object regardless of the tool's return shape.
function buildSuccessResultBlock(toolUseId: string, result: unknown): ToolResultBlock {
  const json = Array.isArray(result) ? { result, count: result.length } : { result };
  return {
    toolUseId,
    content: [{ json: json as never }],
  };
}

function buildErrorResultBlock(toolUseId: string, message: string): ToolResultBlock {
  return {
    toolUseId,
    content: [{ text: `Error: ${message}` }],
    status: 'error',
  };
}

// Public types live in `@aws-rag/shared` — import from there directly.
