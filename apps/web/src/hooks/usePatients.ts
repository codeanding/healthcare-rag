import { useQuery } from '@tanstack/react-query';
import { fetchPatientDetail, fetchPatients } from '../lib/api';

export function usePatients() {
  return useQuery({
    queryKey: ['patients'],
    queryFn: fetchPatients,
    staleTime: 60_000,
  });
}

export function usePatientDetail(patientId: string | null) {
  return useQuery({
    queryKey: ['patient-detail', patientId],
    queryFn: () => fetchPatientDetail(patientId!),
    enabled: Boolean(patientId),
    staleTime: 30_000,
  });
}
