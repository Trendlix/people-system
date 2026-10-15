import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import type { AllowanceType, Contract, ContractSettings, EndingRule } from '@/lib/types';

// Loading contracts, their settings and the ending rules for the profile. These came with the contracts module
// (October 2026): an API from before it answers 404, which here means "not available yet" (null) rather than the 404
// page, so the rest of the profile keeps working.

/** GET that gives null on 404; signs out on 401; throws ApiError for anything else that fails. */
async function getIfAvailable<T>(path: string): Promise<T | null> {
  const res = await apiFetch(path);
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, await messagesOf(res));
  return (await res.json()) as T;
}

/** An employment's contract versions, newest first. */
export function loadContracts(employeeId: string, employmentId: string): Promise<Contract[] | null> {
  return getIfAvailable<Contract[]>(`/employees/${employeeId}/employments/${employmentId}/contracts`);
}

/** What a new contract starts with: the probation and the length, in months. */
export function loadContractSettings(): Promise<ContractSettings | null> {
  return getIfAvailable<ContractSettings>('/contract-settings');
}

/** Every ending rule, the inactive ones too. */
export function loadEndingRules(): Promise<EndingRule[] | null> {
  return getIfAvailable<EndingRule[]>('/ending-rules');
}

/**
 * The kinds of allowance (Organization → Allowances, October 2026), the inactive ones too, for the contract form. An API
 * from before them gives none, so the form still works without allowances.
 */
export async function loadAllowanceTypes(): Promise<AllowanceType[]> {
  return (await getIfAvailable<AllowanceType[]>('/allowance-types')) ?? [];
}
