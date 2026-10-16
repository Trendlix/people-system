import 'server-only';
import { redirect } from 'next/navigation';
import { apiFetch, apiGet } from '@/lib/api';
import type { EmployeeRaiseRequests, RaiseRequest } from '@/lib/raise-types';
import type { Grade, JobTitleSummary } from '@/lib/types';

// Loading what the raise form needs besides the contracts (data.ts): the job titles and grades a promotion with a raise
// is chosen from, and the raise request a raise is prepared from (owner's decisions, 16 October 2026).

/** The job titles, each with the grades it takes, and the grades, lowest first, as the employment form loads them. */
export async function loadPromotionPickers(): Promise<{ jobTitles: JobTitleSummary[]; grades: Grade[] }> {
  const [jobTitles, grades] = await Promise.all([apiGet<JobTitleSummary[]>('/job-titles'), apiGet<Grade[]>('/grades')]);
  return { jobTitles, grades };
}

/**
 * One of the employee's raise requests, for preparing the raise from it (`?request=` on the Raise page): null when it
 * isn't there, isn't the caller's to see, or the API doesn't have raise requests yet, so the page still offers a raise.
 */
export async function loadRaiseRequest(employeeId: string, requestId: string): Promise<RaiseRequest | null> {
  const res = await apiFetch(`/employees/${employeeId}/raise-requests`);
  if (res.status === 401) redirect('/login');
  if (!res.ok) return null;
  const { requests } = (await res.json()) as EmployeeRaiseRequests;
  return requests.find((r) => r.id === requestId) ?? null;
}
