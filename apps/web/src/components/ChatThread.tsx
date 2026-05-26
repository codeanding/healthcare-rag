import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { QueryMetrics, ToolCallTrace as ToolCallTraceType } from '@aws-rag/shared';
import { MetricsPanel } from './MetricsPanel';
import { ToolCallTrace } from './ToolCallTrace';

// A finalised turn — what gets committed to history once a stream completes.
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallTraceType[];
  metrics?: QueryMetrics | null;
  error?: string;
}

// The currently-in-flight turn, fed live from the stream. Rendered as a
// user bubble + an assistant bubble (which may still be receiving tokens).
export interface LiveTurn {
  question: string;
  streamingText: string;
  toolCalls: ToolCallTraceType[];
  metrics: QueryMetrics | null;
  isStreaming: boolean;
  error: string | null;
}

interface Props {
  messages: ChatTurn[];
  liveTurn: LiveTurn | null;
}

export function ChatThread({ messages, liveTurn }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveTurn?.streamingText]);

  const hasAnything = messages.length > 0 || liveTurn !== null;

  return (
    <div className='flex-1 overflow-y-auto px-6 py-6'>
      {!hasAnything && <EmptyState />}
      <div className='mx-auto max-w-3xl space-y-6'>
        {messages.map((m, i) => (
          <MessageBubble key={i} turn={m} />
        ))}
        {liveTurn && <LiveTurnView turn={liveTurn} />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className='mx-auto max-w-2xl rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500'>
      Pick a patient and ask a clinical question.
      <br />
      <span className='text-slate-400'>
        Try: "List active medications" · "Latest A1c?" · "Any drug-allergy contraindications?"
      </span>
    </div>
  );
}

function MessageBubble({ turn }: { turn: ChatTurn }) {
  if (turn.role === 'user') return <UserBubble content={turn.content} />;
  return (
    <AssistantBubble
      content={turn.content}
      toolCalls={turn.toolCalls}
      metrics={turn.metrics ?? null}
      isStreaming={false}
      error={turn.error ?? null}
    />
  );
}

function LiveTurnView({ turn }: { turn: LiveTurn }) {
  return (
    <>
      <UserBubble content={turn.question} />
      <AssistantBubble
        content={turn.streamingText}
        toolCalls={turn.toolCalls}
        metrics={turn.metrics}
        isStreaming={turn.isStreaming}
        error={turn.error}
      />
    </>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className='flex justify-end'>
      <div className='max-w-[80%] rounded-lg bg-blue-600 px-4 py-2 text-white shadow-sm'>
        {content}
      </div>
    </div>
  );
}

function AssistantBubble({
  content,
  toolCalls,
  metrics,
  isStreaming,
  error,
}: {
  content: string;
  toolCalls: ToolCallTraceType[] | undefined;
  metrics: QueryMetrics | null;
  isStreaming: boolean;
  error: string | null;
}) {
  return (
    <div className='flex flex-col'>
      <div className='rounded-lg border border-slate-200 bg-white p-4 shadow-sm'>
        {error ? (
          <div className='text-sm text-red-600'>Error: {error}</div>
        ) : (
          <div className='prose prose-sm prose-slate max-w-none'>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            {isStreaming && (
              <span className='ml-1 inline-block h-4 w-2 animate-pulse bg-slate-400 align-middle' />
            )}
          </div>
        )}
        {toolCalls && toolCalls.length > 0 && <ToolCallTrace calls={toolCalls} />}
        {metrics && <MetricsPanel metrics={metrics} />}
      </div>
    </div>
  );
}
