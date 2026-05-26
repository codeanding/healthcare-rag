import { useEffect, useState } from 'react';
import { ChatInput } from './components/ChatInput';
import { ChatThread, type ChatTurn, type LiveTurn } from './components/ChatThread';
import { PatientHeader } from './components/PatientHeader';
import { PatientList } from './components/PatientList';
import { usePatientDetail, usePatients } from './hooks/usePatients';
import { useStreamQuery } from './hooks/useStreamQuery';

export function App() {
  const patientsQuery = usePatients();
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const detailQuery = usePatientDetail(selectedPatientId);
  const stream = useStreamQuery();

  // `messages` holds only COMPLETED turns. The in-progress turn is rendered
  // separately from `stream` state. When the stream finishes, we commit the
  // turn atomically and reset. This avoids the 3-useEffect mirroring pattern
  // where every token would clone the messages array.
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);

  // Default to the first patient once the list loads.
  useEffect(() => {
    if (!selectedPatientId && patientsQuery.data?.[0]) {
      setSelectedPatientId(patientsQuery.data[0].id);
    }
  }, [patientsQuery.data, selectedPatientId]);

  // Reset chat when switching patients — drops any in-progress turn.
  useEffect(() => {
    setMessages([]);
    setActiveQuestion(null);
    stream.reset();
    // stream.reset is stable from useCallback; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatientId]);

  // When the stream finishes (and we had a question in flight), commit the
  // user/assistant pair to messages and clear the active turn.
  useEffect(() => {
    if (stream.isStreaming || !activeQuestion) return;
    const hasContent = Boolean(stream.streamingText || stream.error);
    if (!hasContent) return;

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: activeQuestion },
      {
        role: 'assistant',
        content: stream.streamingText,
        toolCalls: stream.toolCalls,
        metrics: stream.metrics,
        error: stream.error ?? undefined,
      },
    ]);
    setActiveQuestion(null);
    stream.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.isStreaming, activeQuestion, stream.streamingText, stream.error]);

  function handleSend(question: string) {
    if (!selectedPatientId || stream.isStreaming) return;
    setActiveQuestion(question);
    stream.send(selectedPatientId, question);
  }

  const liveTurn: LiveTurn | null = activeQuestion
    ? {
        question: activeQuestion,
        streamingText: stream.streamingText,
        toolCalls: stream.toolCalls,
        metrics: stream.metrics,
        isStreaming: stream.isStreaming,
        error: stream.error,
      }
    : null;

  return (
    <div className='flex h-screen bg-slate-50'>
      <PatientList
        patients={patientsQuery.data ?? []}
        selectedId={selectedPatientId}
        onSelect={setSelectedPatientId}
        loading={patientsQuery.isLoading}
      />
      <main className='flex flex-1 flex-col'>
        {detailQuery.data ? (
          <PatientHeader patient={detailQuery.data} />
        ) : (
          <div className='border-b border-slate-200 bg-white px-6 py-4 text-sm text-slate-400'>
            {detailQuery.isLoading ? 'Loading patient…' : 'Pick a patient'}
          </div>
        )}
        <ChatThread messages={messages} liveTurn={liveTurn} />
        <ChatInput disabled={!selectedPatientId || stream.isStreaming} onSend={handleSend} />
      </main>
    </div>
  );
}
