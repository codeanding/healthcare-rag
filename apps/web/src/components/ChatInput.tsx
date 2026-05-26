import { useState, type FormEvent, type KeyboardEvent } from 'react';

interface Props {
  disabled: boolean;
  onSend: (question: string) => void;
}

export function ChatInput({ disabled, onSend }: Props) {
  const [value, setValue] = useState('');

  function submit(e?: FormEvent | KeyboardEvent) {
    e?.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) submit(e);
  }

  return (
    <form onSubmit={submit} className='border-t border-slate-200 bg-white px-6 py-4'>
      <div className='mx-auto max-w-3xl'>
        <div className='flex items-end gap-2'>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={disabled}
            placeholder='Ask about this patient (Enter to send, Shift+Enter for newline)…'
            className='flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50'
          />
          <button
            type='submit'
            disabled={disabled || !value.trim()}
            className='rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300'
          >
            Send
          </button>
        </div>
      </div>
    </form>
  );
}
