import type { PatientDetail, PatientSummary } from '@aws-rag/shared';
import { COST_INPUT_PER_TOKEN, COST_OUTPUT_PER_TOKEN } from './api.constants';

// Vite proxies /api → http://localhost:3000 in dev (see vite.config.ts).
// In a real deploy you'd point this at the ALB DNS via VITE_API_URL.
export const API_BASE = import.meta.env.VITE_API_URL ?? '';

export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return inputTokens * COST_INPUT_PER_TOKEN + outputTokens * COST_OUTPUT_PER_TOKEN;
}

export async function fetchPatients(): Promise<PatientSummary[]> {
  const res = await fetch(`${API_BASE}/api/patients`);
  if (!res.ok) throw new Error(`fetchPatients: ${res.status}`);
  return res.json();
}

export async function fetchPatientDetail(patientId: string): Promise<PatientDetail> {
  const res = await fetch(`${API_BASE}/api/patients/${patientId}/summary`);
  if (!res.ok) throw new Error(`fetchPatientDetail: ${res.status}`);
  return res.json();
}

export function ageFromDob(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}
