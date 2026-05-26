import { useState } from 'react';
import type { ToolCallTrace as ToolCallTraceType } from '@aws-rag/shared';

interface Props {
  calls: ToolCallTraceType[];
}

export function ToolCallTrace({ calls }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (calls.length === 0) return null;

  return (
    <div className='mt-3 rounded-md border border-slate-200 bg-slate-50 text-xs'>
      <button
        type='button'
        onClick={() => setExpanded((e) => !e)}
        className='flex w-full items-center justify-between px-3 py-2 font-medium text-slate-600 hover:bg-slate-100'
      >
        <span>
          {expanded ? '▼' : '▶'} Tool trace · {calls.length} call{calls.length === 1 ? '' : 's'}
        </span>
        <span className='text-slate-400'>{calls.map((c) => c.name).join(' · ')}</span>
      </button>
      {expanded && (
        <div className='border-t border-slate-200 px-3 py-2'>
          {calls.map((call, idx) => (
            <div key={idx} className='border-b border-slate-200 py-2 last:border-b-0'>
              <div className='font-mono text-blue-700'>
                {call.name}({JSON.stringify(call.input)})
              </div>
              <div className='mt-1 text-slate-600'>{summariseResult(call.result)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function summariseResult(result: unknown): string {
  if (result && typeof result === 'object') {
    if ('error' in result) return `error: ${(result as { error: string }).error}`;
    if (Array.isArray(result)) return `${result.length} row(s)`;
    // ToolsService returns arrays directly; the streaming hook gets the same shape
    return JSON.stringify(result).slice(0, 200);
  }
  return String(result);
}
