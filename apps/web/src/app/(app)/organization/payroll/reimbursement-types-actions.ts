'use server';

// Payroll Setup → Reimbursement Types (owner, 18 October 2026: "in the setup i need to enter for it a cap"): adding a
// type, changing one (its names, its conditions, turning it off or on) and deleting one no claim uses. Each forwards to
// the API, which checks the role (HR adds and changes them; only a Super Admin deletes) and the conditions again, so
// calling these directly can't bypass them. Once saved, back to the section on Payroll Setup.
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { REIMBURSEMENT_TYPES_HREF, typeBody } from './reimbursement-types';

/** The submitted values, so the form can be refilled after an error (the ticked choices as lists). */
function submitted(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith('$ACTION')) continue;
    const all = fd.getAll(key).map(String);
    out[key] = ['departmentIds', 'gradeIds', 'employmentTypes'].includes(key) ? all : (all[0] ?? '');
  }
  return out;
}

async function save(fd: FormData, request: () => Promise<unknown>): Promise<FormState> {
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values: submitted(fd) };
    throw err;
  }
  redirect(REIMBURSEMENT_TYPES_HREF);
}

/** A new type (POST /reimbursement-types). */
export async function createReimbursementType(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = typeBody(fd);
  if (errors.length) return { errors, values: submitted(fd) };
  return save(fd, () => apiSend('POST', '/reimbursement-types', body));
}

/** A type changed (PATCH /reimbursement-types/:id): every field, as the form has it. The claims sent keep theirs. */
export async function updateReimbursementType(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { body, errors } = typeBody(fd);
  if (errors.length) return { errors, values: submitted(fd) };
  return save(fd, () => apiSend('PATCH', `/reimbursement-types/${encodeURIComponent(id)}`, body));
}

/** Deletes a type no claim uses (DELETE /reimbursement-types/:id): a Super Admin only; anyone else is refused first. */
export async function deleteReimbursementType(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  return save(fd, () => apiSend('DELETE', `/reimbursement-types/${encodeURIComponent(id)}`));
}
