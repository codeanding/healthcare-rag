import { useMemo, useState } from 'react';
import type { PatientSummary } from '@aws-rag/shared';
import { ageFromDob } from '../lib/api';

interface Props {
  patients: PatientSummary[];
  selectedId: string | null;
  onSelect: (patientId: string) => void;
  loading: boolean;
}

export function PatientList({ patients, selectedId, onSelect, loading }: Props) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => {
      const name = `${p.givenName} ${p.familyName}`.toLowerCase();
      return name.includes(q) || p.topConditions.some((c) => c.toLowerCase().includes(q));
    });
  }, [patients, search]);

  return (
    <aside className='flex h-screen w-80 flex-col border-r border-slate-200 bg-white'>
      <div className='border-b border-slate-200 p-4'>
        <h2 className='text-lg font-semibold text-slate-900'>Patients</h2>
        <p className='mt-1 text-xs text-slate-500'>
          {patients.length} synthetic · Synthea-generated
        </p>
        <input
          type='text'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search by name or condition…'
          className='mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
        />
      </div>
      <ul className='flex-1 overflow-y-auto'>
        {loading && <li className='p-4 text-sm text-slate-400'>Loading patients…</li>}
        {!loading && filtered.length === 0 && (
          <li className='p-4 text-sm text-slate-400'>No patients match.</li>
        )}
        {filtered.map((p) => (
          <PatientRow key={p.id} patient={p} selected={p.id === selectedId} onSelect={onSelect} />
        ))}
      </ul>
    </aside>
  );
}

function PatientRow({
  patient,
  selected,
  onSelect,
}: {
  patient: PatientSummary;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type='button'
        onClick={() => onSelect(patient.id)}
        className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition ${
          selected ? 'bg-blue-50' : 'hover:bg-slate-50'
        }`}
      >
        <div className='flex items-center justify-between'>
          <span className='font-medium text-slate-900'>
            {patient.givenName} {patient.familyName}
          </span>
          <span className='text-xs text-slate-500'>
            {ageFromDob(patient.birthDate)}
            {patient.gender ? ` · ${patient.gender[0]?.toUpperCase()}` : ''}
          </span>
        </div>
        {patient.topConditions.length > 0 && (
          <p className='mt-1 truncate text-xs text-slate-600'>
            {patient.topConditions.slice(0, 2).join(' · ')}
          </p>
        )}
        <p className='mt-1 text-xs text-slate-400'>
          {patient.encounterCount} enc · {patient.medicationCount} meds · {patient.conditionCount}{' '}
          cond
        </p>
      </button>
    </li>
  );
}
