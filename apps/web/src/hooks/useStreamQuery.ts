import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { useCallback, useRef, useState } from 'react';
import type { QueryMetrics, StreamEvent } from '@aws-rag/shared';
import { API_BASE, estimateCostUsd } from '../lib/api';
import type { StreamingState, TimingState } from './use-stream-query.types';

const INITIAL: StreamingState = {
  streamingText: '',
  toolCalls: [],
  isStreaming: false,
  error: null,
  iterations: 0,
  metrics: null,
};

function computeMetrics(t: TimingState): QueryMetrics {
  const totalMs = (t.endAt ?? Date.now()) - t.requestStartAt;
  const ttftMs = t.firstTokenAt ? t.firstTokenAt - t.requestStartAt : null;
  const generationMs = t.firstTokenAt && t.endAt ? t.endAt - t.firstTokenAt : null;
  return {
    ttftMs,
    totalMs,
    generationMs,
    iterations: t.iterations,
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    estimatedCostUsd: estimateCostUsd(t.inputTokens, t.outputTokens),
    toolLatencies: [...t.toolLatencies],
  };
}

export function useStreamQuery() {
  const [state, setState] = useState<StreamingState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (patientId: string, question: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timing: TimingState = {
      requestStartAt: Date.now(),
      firstTokenAt: null,
      endAt: null,
      toolStartByUseId: new Map(),
      toolLatencies: [],
      inputTokens: 0,
      outputTokens: 0,
      iterations: 0,
    };

    setState({ ...INITIAL, isStreaming: true });

    try {
      const response = await fetch(`${API_BASE}/api/patients/${patientId}/query/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const text = response.body ? await response.text() : '';
        throw new Error(`stream failed: ${response.status} ${text}`);
      }

      const parser = createParser({
        onEvent: (event) => handleEvent(event, setState, timing),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }

      // Stream closed without an explicit `done` event (rare). Finalise metrics.
      if (!timing.endAt) {
        timing.endAt = Date.now();
        setState((s) => ({ ...s, isStreaming: false, metrics: computeMetrics(timing) }));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      timing.endAt = Date.now();
      setState((s) => ({
        ...s,
        isStreaming: false,
        error: err instanceof Error ? err.message : String(err),
        metrics: computeMetrics(timing),
      }));
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL);
  }, []);

  return { ...state, send, reset };
}

function handleEvent(
  event: EventSourceMessage,
  setState: React.Dispatch<React.SetStateAction<StreamingState>>,
  timing: TimingState,
): void {
  if (!event.data) return;
  let parsed: StreamEvent;
  try {
    parsed = JSON.parse(event.data) as StreamEvent;
  } catch {
    return;
  }
  switch (parsed.type) {
    case 'iteration':
      timing.iterations = parsed.n;
      setState((s) => ({ ...s, iterations: parsed.n }));
      break;
    case 'token':
      if (timing.firstTokenAt === null) timing.firstTokenAt = Date.now();
      setState((s) => ({ ...s, streamingText: s.streamingText + parsed.text }));
      break;
    case 'tool_use_start':
      timing.toolStartByUseId.set(parsed.toolUseId, Date.now());
      break;
    case 'tool_call': {
      const startedAt = timing.toolStartByUseId.get(parsed.toolUseId);
      if (startedAt !== undefined) {
        timing.toolLatencies.push({
          name: parsed.name,
          latencyMs: Date.now() - startedAt,
          toolUseId: parsed.toolUseId,
        });
      }
      setState((s) => ({
        ...s,
        toolCalls: [
          ...s.toolCalls,
          { name: parsed.name, input: parsed.input, result: parsed.result },
        ],
      }));
      break;
    }
    case 'done':
      timing.iterations = parsed.iterations;
      timing.inputTokens = parsed.usage.inputTokens;
      timing.outputTokens = parsed.usage.outputTokens;
      timing.endAt = Date.now();
      setState((s) => ({
        ...s,
        isStreaming: false,
        iterations: parsed.iterations,
        metrics: computeMetrics(timing),
      }));
      break;
    case 'error':
      timing.endAt = Date.now();
      setState((s) => ({
        ...s,
        isStreaming: false,
        error: parsed.message,
        metrics: computeMetrics(timing),
      }));
      break;
  }
}
