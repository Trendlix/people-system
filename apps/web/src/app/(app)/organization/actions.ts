'use server';

// Form actions for the Organization pages. Each one forwards to the API, which checks
// the session and the HR/Admin role, so calling these directly can't bypass permissions.
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import { timeFrom } from '@/lib/form-data';
import type { FormState } from '@/lib/types';

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '');

/** The submitted values, so the form can be refilled after an error. */
function submitted(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith('$ACTION')) continue;
    const all = fd.getAll(key).map(String);
    out[key] = all.length > 1 ? all : (all[0] ?? '');
  }
  return out;
}

async function save(fd: FormData, request: () => Promise<unknown>, then: string): Promise<FormState> {
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values: submitted(fd) };
    throw err;
  }
  redirect(then);
}

// ---------- departments ----------

/** A department's (or team's) page, which lists its job titles and a department's teams. */
const departmentPage = (id: string) => `/organization/departments/${id}`;

/** After saving or deleting a team, back to its department; after a department, to the list. */
const afterwards = (parentId: string | null) => (parentId ? departmentPage(parentId) : '/organization/departments');

// A team is a department with a parent (`parentId`, empty for a department). The field is disabled, and so not sent,
// for a department that has teams: it stays a department.
const departmentBody = (fd: FormData) => ({
  nameEn: text(fd, 'nameEn'),
  nameAr: text(fd, 'nameAr'),
  ...(fd.has('parentId') && { parentId: text(fd, 'parentId') }),
});

export async function createDepartment(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('POST', '/departments', departmentBody(fd)), afterwards(text(fd, 'parentId')));
}

export async function updateDepartment(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('PATCH', `/departments/${id}`, departmentBody(fd)), departmentPage(id));
}

export async function deleteDepartment(id: string, parentId: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('DELETE', `/departments/${id}`), afterwards(parentId));
}

// ---------- job titles ----------

const jobTitleBody = (fd: FormData) => ({
  departmentId: text(fd, 'departmentId'),
  titleEn: text(fd, 'titleEn'),
  titleAr: text(fd, 'titleAr'),
  grade: text(fd, 'grade'),
  jdPurpose: text(fd, 'jdPurpose'),
  jdRequirements: text(fd, 'jdRequirements'),
  duties: text(fd, 'duties').split('\n'),
});

// After saving, back to the department or team the title is now in (the form can move it to another one).
// Only reached when the API accepted the department, so the id is a real one.

export async function createJobTitle(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('POST', '/job-titles', jobTitleBody(fd)), departmentPage(text(fd, 'departmentId')));
}

export async function updateJobTitle(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('PATCH', `/job-titles/${id}`, jobTitleBody(fd)), departmentPage(text(fd, 'departmentId')));
}

export async function deleteJobTitle(id: string, departmentId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('DELETE', `/job-titles/${id}`), departmentPage(departmentId));
}

// ---------- shifts ----------

/** The shift for the API. Times are typed as 12-hour ("9:00 AM") and sent as HH:mm; problems go in `errors`. */
const shiftBody = (fd: FormData, errors: string[]) => {
  const time = (key: string, label: string) => {
    const value = timeFrom(fd, key, label, errors);
    if (value === '') errors.push(`Enter the ${label}, e.g. 9:00 AM.`);
    return value;
  };
  const grace = text(fd, 'graceMinutes').trim();
  return {
    code: text(fd, 'code'),
    startTime: time('startTime', 'start time'),
    endTime: time('endTime', 'end time'),
    graceMinutes: grace === '' ? undefined : Number(grace),
    workingDays: fd.getAll('workingDays').map(Number),
  };
};

export async function createShift(_prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = shiftBody(fd, errors);
  if (errors.length) return { errors, values: submitted(fd) };
  return save(fd, () => apiSend('POST', '/shifts', body), '/organization/shifts');
}

export async function updateShift(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = shiftBody(fd, errors);
  if (errors.length) return { errors, values: submitted(fd) };
  return save(fd, () => apiSend('PATCH', `/shifts/${id}`, body), '/organization/shifts');
}

export async function deleteShift(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('DELETE', `/shifts/${id}`), '/organization/shifts');
}
