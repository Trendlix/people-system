'use server';

// Form actions for the Organization pages. Each one forwards to the API, which checks
// the session and the role (HR or Admin; Admin only for the order of departments and teams; a Super Admin only for
// deleting), so calling these directly can't bypass permissions.
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import { timeFrom } from '@/lib/form-data';
import { HOURS_TO_WORK_ERROR, hoursToWorkFrom } from '@/lib/shifts';
import { deleteRefusal } from '@/lib/session';
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

/** Deletes, for a Super Admin only (owner's decision, 15 October 2026): anyone else is refused before asking the API. */
async function remove(fd: FormData, request: () => Promise<unknown>, then: string): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  return save(fd, request, then);
}

// ---------- departments ----------

/** A department's (or team's) page, which lists its job titles and a department's teams. */
const departmentPage = (id: string) => `/organization/departments/${id}`;

/** After saving or deleting a team, back to its department; after a department, to the list. */
const afterwards = (parentId: string | null) => (parentId ? departmentPage(parentId) : '/organization/departments');

// A team is a department with a parent (`parentId`, empty for a department). The field is disabled, and so not sent,
// for a department that has teams: it stays a department. `headId`: the person in charge (owner, 19 October 2026: "i
// want to add department lead person, the person in charge"), a department's head or a team's lead; "No one" sends
// null, which clears it.
const departmentBody = (fd: FormData) => ({
  nameEn: text(fd, 'nameEn'),
  nameAr: text(fd, 'nameAr'),
  ...(fd.has('parentId') && { parentId: text(fd, 'parentId') }),
  ...(fd.has('headId') && { headId: text(fd, 'headId') || null }),
});

export async function createDepartment(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('POST', '/departments', departmentBody(fd)), afterwards(text(fd, 'parentId')));
}

export async function updateDepartment(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('PATCH', `/departments/${id}`, departmentBody(fd)), departmentPage(id));
}

export async function deleteDepartment(id: string, parentId: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  return remove(fd, () => apiSend('DELETE', `/departments/${id}`), afterwards(parentId));
}

/**
 * The order departments are listed in (`parentId` null), or a department's teams: every one of their ids (`ids`, in
 * the new order). Admins only; the API refuses a list that no longer matches (e.g. one was added meanwhile).
 * Afterwards, back to the list without the reorder view.
 */
export async function reorderDepartments(parentId: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const ids = fd.getAll('ids').map(String);
  return save(fd, () => apiSend('PUT', '/departments/order', { parentId, ids }), afterwards(parentId));
}

// ---------- job titles ----------

// `departmentId` is where the job title belongs: a department itself (e.g. Head of Marketing) or one of its teams.
// `minGradeId` / `maxGradeId`: the grades people with this title can have, lowest and highest; "" leaves that end open
// ("Any", "No limit").
// The job description's purpose, duties and requirements are the rich text editors' HTML ("" clears one); the API
// cleans it, and reads the duties' rows (to link KPIs to later) from the duties' HTML itself.
const jobTitleBody = (fd: FormData) => ({
  departmentId: text(fd, 'departmentId'),
  titleEn: text(fd, 'titleEn'),
  titleAr: text(fd, 'titleAr'),
  minGradeId: text(fd, 'minGradeId'),
  maxGradeId: text(fd, 'maxGradeId'),
  jdPurpose: text(fd, 'jdPurpose'),
  jdDuties: text(fd, 'jdDuties'),
  jdRequirements: text(fd, 'jdRequirements'),
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
  return remove(fd, () => apiSend('DELETE', `/job-titles/${id}`), departmentPage(departmentId));
}

// ---------- grades ----------

// The grading system (G1 Entry Level … G9 Executive): `rank` is the level in the hierarchy, 1 the lowest.
// `confidential`: those holding it are C-level (owner, 19 October 2026: "make C level Employees details not visible to
// HR"), a Super Admin's tick only: sent only when the form had it (`confidentialShown`), so nobody else's save touches
// it; the API refuses anyone else's change with 403 anyway.
const gradeBody = (fd: FormData) => {
  const rank = text(fd, 'rank').trim();
  return {
    code: text(fd, 'code'),
    rank: rank === '' ? undefined : Number(rank),
    levelEn: text(fd, 'levelEn'),
    levelAr: text(fd, 'levelAr'),
    description: text(fd, 'description'),
    ...(fd.has('confidentialShown') && { confidential: fd.get('confidential') === 'on' }),
  };
};

export async function createGrade(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('POST', '/grades', gradeBody(fd)), '/organization/grades');
}

export async function updateGrade(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('PATCH', `/grades/${id}`, gradeBody(fd)), '/organization/grades');
}

export async function deleteGrade(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return remove(fd, () => apiSend('DELETE', `/grades/${id}`), '/organization/grades');
}

// ---------- shifts ----------

/**
 * The shift for the API. Times are typed as 12-hour ("9:00 AM") and sent as HH:mm; the hours to work a day as hours (9,
 * 9:00, 8:30), empty for the whole window (null; owner, 16 October 2026: flexible shifts); problems go in `errors`.
 */
const shiftBody = (fd: FormData, errors: string[]) => {
  const time = (key: string, label: string) => {
    const value = timeFrom(fd, key, label, errors);
    if (value === '') errors.push(`Enter the ${label}, e.g. 9:00 AM.`);
    return value;
  };
  const grace = text(fd, 'graceMinutes').trim();
  const hoursPerDay = hoursToWorkFrom(text(fd, 'hoursPerDay'));
  if (Number.isNaN(hoursPerDay)) errors.push(HOURS_TO_WORK_ERROR);
  return {
    code: text(fd, 'code'),
    startTime: time('startTime', 'start time'),
    endTime: time('endTime', 'end time'),
    hoursPerDay,
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
  return remove(fd, () => apiSend('DELETE', `/shifts/${id}`), '/organization/shifts');
}

// ---------- allowances ----------

// The kinds of allowance paid a month on top of the gross (owner's request, 15 October 2026), e.g. Transport: each taxed
// or not and insured or not. The API checks the role (HR or Admin; a Super Admin for deleting). A checkbox is sent only
// when ticked, so both are always sent, as true or false.
const allowanceTypeBody = (fd: FormData) => ({
  nameEn: text(fd, 'nameEn'),
  nameAr: text(fd, 'nameAr'),
  taxable: fd.get('taxable') === 'on',
  insured: fd.get('insured') === 'on',
});

export async function createAllowanceType(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('POST', '/allowance-types', allowanceTypeBody(fd)), '/organization/allowances');
}

export async function updateAllowanceType(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('PATCH', `/allowance-types/${id}`, allowanceTypeBody(fd)), '/organization/allowances');
}

/** An inactive kind isn't offered for new contracts and offers; those it is already on keep it. */
export async function setAllowanceTypeActive(id: string, active: boolean, _prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => apiSend('PATCH', `/allowance-types/${id}`, { active }), '/organization/allowances');
}

/** The API refuses a kind that is on a contract or offer (409): make it inactive instead. */
export async function deleteAllowanceType(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return remove(fd, () => apiSend('DELETE', `/allowance-types/${id}`), '/organization/allowances');
}
