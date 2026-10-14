'use server';

// Form actions for the Organisation pages. Each one forwards to the API, which checks
// the session and the HR/Admin role, so calling these directly can't bypass permissions.
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
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

const departmentBody = (fd: FormData) => ({ nameEn: text(fd, 'nameEn'), nameAr: text(fd, 'nameAr') });

export async function createDepartment(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('POST', '/departments', departmentBody(fd)), '/organisation/departments');
}

export async function updateDepartment(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('PATCH', `/departments/${id}`, departmentBody(fd)), '/organisation/departments');
}

export async function deleteDepartment(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('DELETE', `/departments/${id}`), '/organisation/departments');
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

export async function createJobTitle(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('POST', '/job-titles', jobTitleBody(fd)), '/organisation/job-titles');
}

export async function updateJobTitle(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('PATCH', `/job-titles/${id}`, jobTitleBody(fd)), '/organisation/job-titles');
}

export async function deleteJobTitle(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('DELETE', `/job-titles/${id}`), '/organisation/job-titles');
}

// ---------- shifts ----------

const shiftBody = (fd: FormData) => {
  const grace = text(fd, 'graceMinutes').trim();
  return {
    code: text(fd, 'code'),
    startTime: text(fd, 'startTime'),
    endTime: text(fd, 'endTime'),
    graceMinutes: grace === '' ? undefined : Number(grace),
    workingDays: fd.getAll('workingDays').map(Number),
  };
};

export async function createShift(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('POST', '/shifts', shiftBody(fd)), '/organisation/shifts');
}

export async function updateShift(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('PATCH', `/shifts/${id}`, shiftBody(fd)), '/organisation/shifts');
}

export async function deleteShift(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('DELETE', `/shifts/${id}`), '/organisation/shifts');
}
