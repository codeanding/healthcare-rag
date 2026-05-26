import type { PatientDetail } from '@aws-rag/shared';
import { ageFromDob } from '../lib/api';

interface Props {
  patient: PatientDetail;
}

export function PatientHeader({ patient }: Props) {
  const age = ageFromDob(patient.birthDate);
  return (
    <header className='border-b border-slate-200 bg-white px-6 py-4'>
      <div className='flex items-baseline justify-between'>
        <div>
          <h1 className='text-xl font-semibold text-slate-900'>
            {patient.givenName} {patient.familyName}
          </h1>
          <p className='mt-0.5 text-sm text-slate-500'>
            {age}y · {patient.gender ?? 'unknown'} · DOB {patient.birthDate}
            {patient.race ? ` · ${patient.race}` : ''}
          </p>
        </div>
        <div className='grid grid-cols-4 gap-4 text-center'>
          <Stat label='Active meds' value={patient.activeMedications} />
          <Stat label='Active conds' value={patient.activeConditions} />
          <Stat label='Allergies' value={patient.allergies} />
          <Stat label='Last visit' value={patient.latestEncounter?.date ?? '—'} compact />
        </div>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  compact,
}: {
  label: string;
  value: number | string;
  compact?: boolean;
}) {
  return (
    <div>
      <div
        className={
          compact ? 'text-sm font-semibold text-slate-900' : 'text-2xl font-semibold text-slate-900'
        }
      >
        {value}
      </div>
      <div className='text-xs text-slate-500'>{label}</div>
    </div>
  );
}
