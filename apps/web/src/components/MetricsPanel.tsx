import { useState } from 'react';
import type { QueryMetrics } from '@aws-rag/shared';

interface Props {
  metrics: QueryMetrics;
}

export function MetricsPanel({ metrics }: Props) {
  const [expanded, setExpanded] = useState(false);

  const ttft = metrics.ttftMs !== null ? `${metrics.ttftMs} ms` : '—';
  const total = `${(metrics.totalMs / 1000).toFixed(2)} s`;
  const generation =
    metrics.generationMs !== null ? `${(metrics.generationMs / 1000).toFixed(2)} s` : '—';

  return (
    <div className='mt-2 rounded-md border border-slate-200 bg-slate-50 text-xs'>
      <button
        type='button'
        onClick={() => setExpanded((e) => !e)}
        className='flex w-full items-center justify-between px-3 py-2 font-medium text-slate-600 hover:bg-slate-100'
      >
        <span>{expanded ? '▼' : '▶'} Metrics</span>
        <span className='text-slate-400'>
          {total} · {metrics.inputTokens + metrics.outputTokens} tok · $
          {metrics.estimatedCostUsd.toFixed(4)}
        </span>
      </button>
      {expanded && (
        <div className='space-y-3 border-t border-slate-200 px-3 py-2'>
          <div className='grid grid-cols-3 gap-x-4 gap-y-1'>
            <Field label='TTFT' value={ttft} hint='time to first token' />
            <Field label='Total' value={total} hint='request → done' />
            <Field label='Generation' value={generation} hint='first token → done' />
            <Field
              label='Tokens in'
              value={metrics.inputTokens.toLocaleString()}
              hint='cumulative across all iters'
            />
            <Field label='Tokens out' value={metrics.outputTokens.toLocaleString()} />
            <Field
              label='Cost (est.)'
              value={`$${metrics.estimatedCostUsd.toFixed(4)}`}
              hint='Sonnet 4.6 list rate'
            />
            <Field
              label='Iterations'
              value={String(metrics.iterations)}
              hint='Converse loop turns'
            />
            <Field label='Tool calls' value={String(metrics.toolLatencies.length)} />
          </div>

          {metrics.toolLatencies.length > 0 && (
            <div>
              <div className='mb-1 font-medium text-slate-700'>Per-tool latency</div>
              <ToolLatencyBar latencies={metrics.toolLatencies} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className='text-[11px] uppercase tracking-wide text-slate-500' title={hint}>
        {label}
      </div>
      <div className='font-mono text-sm text-slate-900'>{value}</div>
    </div>
  );
}

function ToolLatencyBar({
  latencies,
}: {
  latencies: Array<{ name: string; latencyMs: number; toolUseId: string }>;
}) {
  const max = Math.max(...latencies.map((l) => l.latencyMs), 1);
  return (
    <div className='space-y-1'>
      {latencies.map((l) => {
        const pct = (l.latencyMs / max) * 100;
        return (
          <div key={l.toolUseId} className='flex items-center gap-2'>
            <span className='w-32 truncate font-mono text-slate-700'>{l.name}</span>
            <div className='relative h-3 flex-1 overflow-hidden rounded bg-slate-200'>
              <div className='absolute inset-y-0 left-0 bg-blue-500' style={{ width: `${pct}%` }} />
            </div>
            <span className='w-16 text-right font-mono text-slate-600'>{l.latencyMs} ms</span>
          </div>
        );
      })}
    </div>
  );
}
