import 'server-only';
import { loadJson } from '../../../payroll/load';
import type { EmployeeClientAccounts } from './client-accounts';

/**
 * A person's client accounts (25 October 2026), as the caller may see them; null when the API doesn't answer them
 * (404: someone the caller doesn't see, or an API from before them; 403), so the section shows nothing.
 */
export async function loadEmployeeClientAccounts(employeeId: string): Promise<EmployeeClientAccounts | null> {
  const loaded = await loadJson<EmployeeClientAccounts>(`/employees/${encodeURIComponent(employeeId)}/client-accounts`);
  return loaded.kind === 'ok' ? loaded.value : null;
}
