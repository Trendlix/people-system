import 'server-only';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { Company, Department, EmployeeProfile, EmployeeSummary, Employment, Grade, JobTitleSummary, Shift } from '@/lib/types';
import type { EmploymentPickers } from './employment-fields';

// Data loading shared by the Employees pages.

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * The employee in the URL, as the caller may see them; the 404 page for a bad or hidden id. `access.delete` is the
 * Super Admin's only (owner's decision, 15 October 2026): the API says so itself, and an API from before then (HR and
 * Admin) is narrowed here, so nobody else is ever offered a delete.
 */
export async function loadEmployee(params: Promise<{ id: string }>): Promise<EmployeeProfile> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [user, profile] = await Promise.all([getCurrentUser(), apiGet<EmployeeProfile>(`/employees/${id}`)]);
  if (!profile.access.delete || canDelete(user)) return profile;
  return { ...profile, access: { ...profile.access, delete: false } };
}

/** The employee and one of their employments, both in the URL; the 404 page when either is not theirs or not there. */
export async function loadEmployment(
  params: Promise<{ id: string; employmentId: string }>,
): Promise<{ employee: EmployeeProfile; employment: Employment }> {
  const { employmentId } = await params;
  const employee = await loadEmployee(params);
  const employment = employee.employments.find((e) => e.id === employmentId);
  if (!employment) notFound();
  return { employee, employment };
}

/** The company's work email domain (e.g. trendlix.com), which every work email must end in; null when there is none. */
export async function loadEmailDomain(): Promise<string | null> {
  const company = await apiGet<Company>('/company');
  return company.emailDomain || null;
}

/** The lists behind the Employment fields. `employeeId` is left out of the managers, so nobody reports to themselves. */
export async function loadPickers(employeeId?: string): Promise<EmploymentPickers> {
  const [departments, jobTitles, grades, shifts, employees] = await Promise.all([
    apiGet<Department[]>('/departments'),
    apiGet<JobTitleSummary[]>('/job-titles'),
    apiGet<Grade[]>('/grades'),
    apiGet<Shift[]>('/shifts'),
    apiGet<EmployeeSummary[]>('/employees'),
  ]);
  return { departments, jobTitles, grades, shifts, managers: employees.filter((e) => e.id !== employeeId), employeeId: employeeId ?? null };
}
