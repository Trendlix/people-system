'use server';

// Clients → Client Accounts' actions (owner, 25 October 2026: "if an employee has an allowance per account, how can we
// deal with it?"): HR and the CEO add, change and end an account, assign people to it and change or end an assignment,
// and keep the sizes; a Super Admin deletes an assignment or a size made by mistake. Each forwards to the API, which
// checks the session, the role, a C-level person's (the CEO's), the dates (never inside a month whose payroll is with
// the CEO, approved or paid; never overlapping the same person on the same account; within their employment) and the
// contract's per-account allowance again, so calling these directly can't bypass them.
import { apiSend } from '@/lib/api';
import { deleteRefusal } from '@/lib/session';
import type { FormState } from '@/lib/types';
import { sendAndRefresh } from '../../payroll/actions-common';
import { accountBody, assignmentBody, endAccountBody, endAssignmentBody, tierBody } from './accounts';

const UUID = /^[0-9a-f-]{36}$/i;
const BASE = '/client-accounts';

/** The submitted values, so a refused form can be filled in again. */
function submitted(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of fd) if (!key.startsWith('$ACTION') && typeof value === 'string') out[key] = value;
  return out;
}

const notFound = (what: string): FormState => ({
  errors: [`This ${what} was not found. Reload the page.`],
});

export async function createAccount(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, problems } = accountBody(fd, false);
  if (!body) return { errors: problems, values: submitted(fd) };
  return sendAndRefresh(() => apiSend('POST', BASE, body), `Added ${body.nameEn}.`, submitted(fd));
}

export async function updateAccount(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return notFound('client account');
  const { body, problems } = accountBody(fd, true);
  if (!body) return { errors: problems, values: submitted(fd) };
  return sendAndRefresh(() => apiSend('PATCH', `${BASE}/${id}`, body), 'Saved.', submitted(fd));
}

export async function endAccount(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return notFound('client account');
  const { body, problems } = endAccountBody(fd);
  if (!body) return { errors: problems, values: submitted(fd) };
  return sendAndRefresh(() => apiSend('POST', `${BASE}/${id}/end`, body), 'Ended.', submitted(fd));
}

export async function addAssignment(accountId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(accountId)) return notFound('client account');
  const { body, problems } = assignmentBody(fd, false);
  if (!body) return { errors: problems, values: submitted(fd) };
  return sendAndRefresh(() => apiSend('POST', `${BASE}/${accountId}/assignments`, body), 'Assigned.', submitted(fd));
}

export async function updateAssignment(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return notFound('assignment');
  const { body, problems } = assignmentBody(fd, true);
  if (!body) return { errors: problems, values: submitted(fd) };
  return sendAndRefresh(() => apiSend('PATCH', `${BASE}/assignments/${id}`, body), 'Saved.', submitted(fd));
}

export async function endAssignment(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return notFound('assignment');
  const { body, problems } = endAssignmentBody(fd);
  if (!body) return { errors: problems, values: submitted(fd) };
  return sendAndRefresh(() => apiSend('PATCH', `${BASE}/assignments/${id}`, body), 'Ended.', submitted(fd));
}

/** Deletes an assignment made by mistake (a Super Admin only, as every deletion). */
export async function deleteAssignment(id: string): Promise<FormState> {
  if (!UUID.test(id)) return notFound('assignment');
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  return sendAndRefresh(() => apiSend('DELETE', `${BASE}/assignments/${id}`), 'Deleted.');
}

export async function createTier(_prev: FormState, fd: FormData): Promise<FormState> {
  const { body, problems } = tierBody(fd);
  if (!body) return { errors: problems, values: submitted(fd) };
  return sendAndRefresh(() => apiSend('POST', `${BASE}/tiers`, body), `Added ${body.nameEn}.`, submitted(fd));
}

export async function updateTier(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(id)) return notFound('size');
  const { body, problems } = tierBody(fd);
  if (!body) return { errors: problems, values: submitted(fd) };
  return sendAndRefresh(() => apiSend('PATCH', `${BASE}/tiers/${id}`, body), 'Saved.', submitted(fd));
}

/** Deletes a size (a Super Admin only): its accounts keep their defaults, with no size. */
export async function deleteTier(id: string): Promise<FormState> {
  if (!UUID.test(id)) return notFound('size');
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  return sendAndRefresh(() => apiSend('DELETE', `${BASE}/tiers/${id}`), 'Deleted.');
}
