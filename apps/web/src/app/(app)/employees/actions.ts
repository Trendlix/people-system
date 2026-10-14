'use server';

// Form actions for the Employees pages. Each one forwards to the API, which checks the session and the HR role,
// so calling these directly can't bypass permissions. Dates are typed as DD/MM/YYYY and sent as YYYY-MM-DD.
import { redirect } from 'next/navigation';
import type { PaperworkKind } from '@trendlix/shared';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
import { dateFrom } from '@/lib/form-data';
import type { EmployeeProfile, FormState } from '@/lib/types';

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '');

/** The submitted values, so the form can be refilled after an error. Files (e.g. ID card photos) are never sent back. */
function submitted(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith('$ACTION')) continue;
    const all = fd.getAll(key).filter((v) => typeof v === 'string');
    if (all.length === 0) continue;
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

/**
 * Sends the request unless reading the form already found mistakes (`errors`), then goes to `then`.
 * `then` can depend on the API's answer, e.g. the new employee's id.
 */
async function save<T>(fd: FormData, errors: string[], request: () => Promise<T>, then: string | ((result: T) => string)): Promise<FormState> {
  if (errors.length) return { errors, values: submitted(fd) };
  let result: T;
  try {
    result = await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values: submitted(fd) };
    throw err;
  }
  redirect(typeof then === 'string' ? then : then(result));
}

/** Employment fields, shared by the new-employee form and the Employment edit page. */
function employmentBody(fd: FormData, errors: string[]) {
  const workArrangement = text(fd, 'workArrangement');
  return {
    employmentType: text(fd, 'employmentType'),
    status: text(fd, 'status'),
    // The form keeps the department in line with the job title, so the API gets a matching pair.
    departmentId: text(fd, 'departmentId'),
    jobTitleId: text(fd, 'jobTitleId'),
    managerId: text(fd, 'managerId'),
    joinDate: dateFrom(fd, 'joinDate', 'join date', errors),
    probationEnd: dateFrom(fd, 'probationEnd', 'probation end date', errors),
    workArrangement,
    officeDays: workArrangement === 'hybrid' ? fd.getAll('officeDays').map(Number) : [],
    shiftId: text(fd, 'shiftId'),
  };
}

const PERSONAL_TEXT = [
  'employeeCode',
  'fullNameEn',
  'fullNameAr',
  'gender',
  'nationality',
  'maritalStatus',
  'militaryStatus',
  'workEmail',
  'personalEmail',
  'mobile',
  'addressAr',
  'governorate',
  'emergencyName',
  'emergencyRelation',
  'emergencyMobile',
  'university',
  'faculty',
  'degree',
  'major',
  'educationGrade',
  'qualificationAr',
] as const;

/** Profile fields, shared by the new-employee form and the Personal edit page. */
function personalBody(fd: FormData, errors: string[]): Record<string, string | number | null> {
  const body: Record<string, string | number | null> = {};
  for (const key of PERSONAL_TEXT) body[key] = text(fd, key);
  body.dateOfBirth = dateFrom(fd, 'dateOfBirth', 'date of birth', errors);

  const year = text(fd, 'graduationYear').trim();
  if (year === '') body.graduationYear = null;
  else if (/^\d{4}$/.test(year)) body.graduationYear = Number(year);
  else errors.push('Enter the graduation year as four digits, e.g. 2016.');
  return body;
}

/** National ID fields, shared by the new-employee form and the National ID edit page. */
function identityBody(fd: FormData, errors: string[]) {
  return {
    nationalId: text(fd, 'nationalId'),
    printedNo: text(fd, 'printedNo'),
    issueDate: dateFrom(fd, 'issueDate', 'issue date', errors),
    expiryDate: dateFrom(fd, 'expiryDate', 'expiry date', errors),
    issuingOffice: text(fd, 'issuingOffice'),
  };
}

// ---------- create ----------

/** The ID card photos read on the Add employee page (made smaller in the browser), and where each goes in the employee file. */
const CARD_PHOTOS = [
  ['idFront', 'national_id_front'],
  ['idBack', 'national_id_back'],
] as const satisfies readonly (readonly [string, PaperworkKind])[];

/**
 * Puts the ID card photos in the new employee's file. One that fails is left out rather than undoing the new
 * employee: the employee file then shows it as missing, to upload from the profile.
 */
async function keepCardPhotos(employeeId: string, photos: { kind: PaperworkKind; file: File }[]) {
  await Promise.all(
    photos.map(async ({ kind, file }) => {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', file, file.name);
      try {
        await apiUpload('POST', `/employees/${employeeId}/paperwork`, form);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
      }
    }),
  );
}

/**
 * Adds the employee with their profile, employment details and (when any is filled in) national ID in one request,
 * so nothing is created if the API refuses any of it. Then keeps the ID card photos in the employee file.
 */
export async function createEmployee(_prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const identity = identityBody(fd, errors);
  const body = {
    ...personalBody(fd, errors),
    ...employmentBody(fd, errors),
    // the API fills in an empty date of birth from the national ID, and refuses one that disagrees with it
    ...(Object.values(identity).some((v) => v.trim() !== '') && { identity }),
  };
  const photos = CARD_PHOTOS.flatMap(([key, kind]) => {
    const file = fd.get(key);
    return file instanceof File && file.size > 0 ? [{ kind, file }] : [];
  });

  return save(
    fd,
    errors,
    async () => {
      const created = await apiSend<EmployeeProfile>('POST', '/employees', body);
      if (created) await keepCardPhotos(created.id, photos);
      return created;
    },
    (created) => (created ? `/employees/${created.id}` : '/employees'),
  );
}

// ---------- edit ----------

export async function updatePersonal(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = personalBody(fd, errors);
  return save(fd, errors, () => apiSend('PATCH', `/employees/${id}`, body), `/employees/${id}`);
}

export async function updateEmployment(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = {
    ...employmentBody(fd, errors),
    jdAcknowledgedAt: dateFrom(fd, 'jdAcknowledgedAt', 'job description acknowledgement date', errors),
  };
  return save(fd, errors, () => apiSend('PATCH', `/employees/${id}`, body), `/employees/${id}`);
}

export async function updateIdentity(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = identityBody(fd, errors);

  // After reading the ID card, HR can tick personal details from it to save to the profile too (none otherwise).
  const apply = new Set(fd.getAll('apply').map(String));
  const personal: Record<string, string> = {};
  for (const key of ['fullNameAr', 'addressAr', 'gender'] as const) {
    if (apply.has(key)) personal[key] = text(fd, `card_${key}`); // a woman's military status is set by the API
  }
  const dateOfBirth = apply.has('dateOfBirth') ? dateFrom(fd, 'card_dateOfBirth', 'date of birth', errors) : undefined;

  return save(
    fd,
    errors,
    async () => {
      // The API checks the national ID against the profile's date of birth, so a ticked date of birth goes first.
      if (dateOfBirth !== undefined) await apiSend('PATCH', `/employees/${id}`, { dateOfBirth });
      await apiSend('PATCH', `/employees/${id}/identity`, body);
      if (Object.keys(personal).length === 0) return;
      try {
        await apiSend('PATCH', `/employees/${id}`, personal);
      } catch (err) {
        if (err instanceof ApiError) throw new ApiError(err.status, [`The national ID was saved, but not the personal details: ${err.messages.join(' ')}`]);
        throw err;
      }
    },
    `/employees/${id}`,
  );
}

export async function updateBank(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const body = {
    bankName: text(fd, 'bankName'),
    branch: text(fd, 'branch'),
    accountNo: text(fd, 'accountNo'),
    iban: text(fd, 'iban'),
    holderName: text(fd, 'holderName'),
  };
  return save(fd, [], () => apiSend('PATCH', `/employees/${id}/bank`, body), `/employees/${id}`);
}

export async function deleteEmployee(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, [], () => apiSend('DELETE', `/employees/${id}`), '/employees');
}
