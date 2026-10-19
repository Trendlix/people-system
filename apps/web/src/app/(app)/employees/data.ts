import 'server-only';
import { notFound } from 'next/navigation';
import { setsConfidentialGrade } from '@trendlix/shared';
import { apiGet } from '@/lib/api';
import { isRestricted } from '@/lib/confidential';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { Company, Department, EmployeeCard, EmployeeProfile, EmployeeSummary, Employment, Grade, JobTitleSummary, Shift } from '@/lib/types';
import { pickableGrades } from '../organization/grades/label';
import type { EmploymentPickers } from './employment-fields';

// Data loading shared by the Employees pages.

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * The employee in the URL as the caller may see them: their profile, or a C-level person's card for someone who may not
 * see them (owner, 19 October 2026: "make C level Employees details not visible to HR"); the 404 page for a bad or
 * hidden id. `access.delete` is the Super Admin's only (owner's decision, 15 October 2026): the API says so itself, and
 * an API from before then (HR and Admin) is narrowed here, so nobody else is ever offered a delete.
 */
export async function loadProfileOrCard(params: Promise<{ id: string }>): Promise<EmployeeProfile | EmployeeCard> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [user, profile] = await Promise.all([getCurrentUser(), apiGet<EmployeeProfile | EmployeeCard>(`/employees/${id}`)]);
  if (isRestricted(profile) || !profile.access.delete || canDelete(user)) return profile;
  return { ...profile, access: { ...profile.access, delete: false } };
}

/**
 * The employee in the URL, for the pages under the profile (edit, contracts, employment, ending, raise, change request,
 * confirm, documents): their profile; the 404 page for a bad or hidden id, and for a C-level person's card, whose every
 * record the API answers 404 for those who see only the card (19 October 2026).
 */
export async function loadEmployee(params: Promise<{ id: string }>): Promise<EmployeeProfile> {
  const profile = await loadProfileOrCard(params);
  if (isRestricted(profile)) notFound();
  return profile;
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

/**
 * The lists behind the Employment fields. `employeeId` is left out of the managers, so nobody reports to themselves.
 * A C-level person may be chosen as a direct manager (their card is enough for that: owner, 19 October 2026), but a
 * C-level grade only by those who may set one, the CEO and the Super Admin (pickableGrades): the API refuses anyone else.
 */
export async function loadPickers(employeeId?: string): Promise<EmploymentPickers> {
  const [user, departments, jobTitles, grades, shifts, employees] = await Promise.all([
    getCurrentUser(),
    apiGet<Department[]>('/departments'),
    apiGet<JobTitleSummary[]>('/job-titles'),
    apiGet<Grade[]>('/grades'),
    apiGet<Shift[]>('/shifts'),
    apiGet<EmployeeSummary[]>('/employees'),
  ]);
  const offered = pickableGrades(grades, setsConfidentialGrade(user));
  return {
    departments,
    jobTitles,
    grades: offered.grades,
    confidentialGradesLeftOut: offered.leftOut,
    shifts,
    managers: employees.filter((e) => e.id !== employeeId),
    employeeId: employeeId ?? null,
  };
}
