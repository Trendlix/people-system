'use server';

// Form actions for the Employees pages. Each one forwards to the API, which checks the session and the HR role,
// so calling these directly can't bypass permissions. Dates are typed as DD/MM/YYYY and sent as YYYY-MM-DD.
import { redirect } from 'next/navigation';
import type { PaperworkKind } from '@trendlix/shared';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
import { dateFrom } from '@/lib/form-data';
import { deleteRefusal } from '@/lib/session';
import type { EmployeeProfile, FormState, LearnedField } from '@/lib/types';
import { priorServiceFrom } from './leave-facts';
import { LEARNED_FIELDS, readKey } from './paperwork';
import { monthFrom } from './student';

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

const PERSONAL_TEXT = [
  'employeeCode',
  'insuranceNo',
  'fullNameEn',
  'fullNameAr',
  'displayName',
  'gender',
  'nationality',
  'maritalStatus',
  'militaryStatus',
  'workEmail',
  'personalEmail',
  'mobile',
  'mobile2',
  'addressAr',
  'city',
  'governorate',
  'buildingNo',
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

/**
 * Profile fields, shared by the Add employee page and the Personal Details and Education pages. Only the fields the
 * form has are sent, so a page with some of them (e.g. Education) leaves the others as they are; an empty field clears it.
 */
function personalBody(fd: FormData, errors: string[]): Record<string, string | number | boolean | null> {
  const body: Record<string, string | number | boolean | null> = {};
  for (const key of PERSONAL_TEXT) if (fd.has(key)) body[key] = text(fd, key);
  if (fd.has('dateOfBirth')) body.dateOfBirth = dateFrom(fd, 'dateOfBirth', 'date of birth', errors);

  if (fd.has('graduationYear')) {
    const year = text(fd, 'graduationYear').trim();
    if (year === '') body.graduationYear = null;
    else if (/^\d{4}$/.test(year)) body.graduationYear = Number(year);
    else errors.push('Enter the graduation year as four digits, e.g. 2016.');
  }
  // a student (owner, 25 October 2026: "Add a Student option"): the switch, sent as true or false; the year and the
  // expected graduation's month while it is on (turned off, the API clears them)
  if (fd.has('stillStudying')) body.stillStudying = text(fd, 'stillStudying') === 'true';
  if (fd.has('studyYear')) body.studyYear = text(fd, 'studyYear');
  if (fd.has('expectedGraduation')) {
    const month = monthFrom(text(fd, 'expectedGraduation'));
    if (month === undefined) errors.push('Enter the expected graduation as a month, e.g. 06/2027.');
    else body.expectedGraduation = month;
  }
  // the annual leave's facts (owner, 18 October 2026; Labour Law Art. 124), sent with their marker: a disability left
  // unticked is saved as none, the prior service typed in years and months as months (both empty: none)
  if (fd.has('leaveFacts')) {
    body.disability = fd.has('disability');
    const prior = priorServiceFrom(text(fd, 'priorServiceYears'), text(fd, 'priorServiceExtraMonths'));
    if (prior.error) errors.push(prior.error);
    else body.priorServiceMonths = prior.months;
  }
  return body;
}

/** National ID fields, shared by the new-employee form and the National ID edit page. */
function identityBody(fd: FormData, errors: string[]) {
  return {
    nationalId: text(fd, 'nationalId'),
    printedNo: text(fd, 'printedNo'),
    issueDate: dateFrom(fd, 'issueDate', 'issue date', errors),
    expiryDate: dateFrom(fd, 'expiryDate', 'expiry date', errors),
  };
}

// ---------- learning from corrections to card readings ----------

const plain = (v: string) => v.replace(/\s+/g, ' ').trim();

/**
 * Teaches the card reader HR's corrections (POST /id-card/corrections): for the Arabic name and the address, what the
 * reading suggested (sent with the form, see readKey) and what was saved, when both are filled in and they differ.
 * Called after a save went through, and never stops or undoes it: a failure here is passed over.
 */
async function learnCorrections(fd: FormData, saved: Partial<Record<LearnedField, string>>) {
  const corrections = LEARNED_FIELDS.flatMap((field) => {
    const read = plain(text(fd, readKey(field)));
    const value = plain(saved[field] ?? '');
    return read && value && read !== value ? [{ field, read, saved: value }] : [];
  });
  if (corrections.length === 0) return;
  try {
    await apiSend('POST', '/id-card/corrections', { corrections });
  } catch {
    // the record is saved; only this lesson is lost
  }
}

// ---------- create ----------

/** The ID card read on the Add employee page (the two sides cut out of the scan, as JPEGs), and where each goes in the employee file. */
const CARD_PHOTOS = [
  ['idFront', 'national_id_front'],
  ['idBack', 'national_id_back'],
] as const satisfies readonly (readonly [string, PaperworkKind])[];

/**
 * Puts the ID card pictures in the new employee's file. One that fails is left out rather than undoing the new
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
 * Adds the profile (personal, contact, education) with the national ID (when any is filled in) in one request, so
 * nothing is created if the API refuses any of it. Employment is added afterwards, on the profile's Employment tab: a
 * profile exists before the hire and stays after the employment ends. Then keeps the ID card (the two sides cut out of
 * the scan) in the employee file, and teaches the card reader what HR corrected in its reading.
 */
export async function createEmployee(_prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const identity = identityBody(fd, errors);
  const body = {
    ...personalBody(fd, errors),
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
      if (created) {
        await keepCardPhotos(created.id, photos);
        await learnCorrections(fd, { fullNameAr: text(fd, 'fullNameAr'), addressAr: text(fd, 'addressAr') });
      }
      return created;
    },
    // on to the Employment tab, to add the employment
    (created) => (created ? `/employees/${created.id}?tab=employment&added=1` : '/employees'),
  );
}

// ---------- edit ----------

/** The Personal Details page: personal, contact and address, emergency contact. Back to the Basic Data tab. */
export async function updatePersonal(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = personalBody(fd, errors);
  return save(fd, errors, () => apiSend('PATCH', `/employees/${id}`, body), `/employees/${id}`);
}

/** The Education page. Back to the Education tab. */
export async function updateEducation(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = personalBody(fd, errors);
  return save(fd, errors, () => apiSend('PATCH', `/employees/${id}`, body), `/employees/${id}?tab=education`);
}

export async function updateIdentity(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = identityBody(fd, errors);

  // After reading the ID card, HR can tick personal details from it (and the English name spelled from it) to save to
  // the profile too (none otherwise).
  const apply = new Set(fd.getAll('apply').map(String));
  const personal: Record<string, string> = {};
  for (const key of ['fullNameAr', 'fullNameEn', 'addressAr', 'city', 'governorate', 'gender', 'maritalStatus', 'nationality'] as const) {
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
      if (Object.keys(personal).length === 0) return; // nothing ticked: nothing more to save or to learn from
      try {
        await apiSend('PATCH', `/employees/${id}`, personal);
      } catch (err) {
        if (err instanceof ApiError) throw new ApiError(err.status, [`The national ID was saved, but not the personal details: ${err.messages.join(' ')}`]);
        throw err;
      }
      // what was saved is learned from: the Arabic name and address, when ticked and saved
      await learnCorrections(fd, personal);
    },
    `/employees/${id}`,
  );
}

export async function updateBank(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const body = {
    bankName: text(fd, 'bankName'),
    accountNo: text(fd, 'accountNo'),
    iban: text(fd, 'iban'),
    holderName: text(fd, 'holderName'),
  };
  return save(fd, [], () => apiSend('PATCH', `/employees/${id}/bank`, body), `/employees/${id}`);
}

/** Deletes a profile added by mistake: a Super Admin only (owner's decision, 15 October 2026), as the API checks too. */
export async function deleteEmployee(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  return save(fd, [], () => apiSend('DELETE', `/employees/${id}`), '/employees');
}
