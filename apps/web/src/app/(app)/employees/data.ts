import 'server-only';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import type { Department, EmployeeProfile, EmployeeSummary, JobTitleSummary, Shift } from '@/lib/types';
import type { EmploymentPickers } from './employment-fields';

// Data loading shared by the Employees pages.

const UUID = /^[0-9a-f-]{36}$/i;

/** The employee in the URL, as the caller may see them; the 404 page for a bad or hidden id. */
export async function loadEmployee(params: Promise<{ id: string }>): Promise<EmployeeProfile> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return apiGet<EmployeeProfile>(`/employees/${id}`);
}

/** The lists behind the Employment fields. `employeeId` is left out of the managers, so nobody reports to themselves. */
export async function loadPickers(employeeId?: string): Promise<EmploymentPickers> {
  const [departments, jobTitles, shifts, employees] = await Promise.all([
    apiGet<Department[]>('/departments'),
    apiGet<JobTitleSummary[]>('/job-titles'),
    apiGet<Shift[]>('/shifts'),
    apiGet<EmployeeSummary[]>('/employees'),
  ]);
  return { departments, jobTitles, shifts, managers: employees.filter((e) => e.id !== employeeId) };
}
