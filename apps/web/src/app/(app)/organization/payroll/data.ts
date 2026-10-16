import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { ApiError, apiFetch, messagesOf } from '@/lib/api';
import type { ContractSettings, Holiday, PayrollSettingsView, Shift } from '@/lib/types';

// What Payroll Setup reads (owner's request, 16 October 2026), each once a request however many sections use it. An
// API from before a part answers 404 ("not available yet"): that section says so and the others still show.

export type Loaded<T> = { kind: 'ok'; value: T } | { kind: 'unavailable' } | { kind: 'failed'; message: string };

async function load<T>(path: string): Promise<Loaded<T>> {
  let res: Response;
  try {
    res = await apiFetch(path);
  } catch (err) {
    if (err instanceof ApiError) return { kind: 'failed', message: err.message };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 404) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'failed', message: (await messagesOf(res)).join(' ') };
  try {
    return { kind: 'ok', value: (await res.json()) as T };
  } catch {
    return { kind: 'failed', message: 'The server sent an answer that could not be read.' };
  }
}

/** GET /payroll/settings: the rules, the bank files' details and the payday. */
export const loadPayrollSettings = cache(() => load<PayrollSettingsView>('/payroll/settings'));

/** GET /contract-settings: the company defaults Your Rules edits are kept there. */
export const loadContractDefaults = cache(() => load<ContractSettings>('/contract-settings'));

/** GET /payroll/holidays?year=: the year's official holidays, in date order. */
export const loadHolidays = cache((year: number) => load<Holiday[]>(`/payroll/holidays?year=${year}`));

/** GET /shifts: their working days and hours, for the Working Days table. */
export const loadShifts = cache(() => load<Shift[]>('/shifts'));
