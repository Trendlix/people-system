'use server';

// Candidate profiles (owner, 22 October 2026: "how to make like a profile for each candidate to store history and
// prevent duplication?"; "HR decides from suggested match"): merging two candidates (a suggestion confirmed, or "Merge
// with…" by the other's code), undoing a merge (a Super Admin), dismissing a pair ("Not the same person") and moving an
// application to a new candidate. Each forwards to the API, which checks who may and every rule again, and audits it.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { CandidateListItem } from '@trendlix/shared';
import { ApiError, apiGet, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { candidateHref, candidatesApiPath, codeTyped } from './candidates';

const path = (id: string, then = '') => `/recruitment/candidates/${encodeURIComponent(id)}${then}`;

async function post(to: string, said: string): Promise<FormState> {
  try {
    await apiSend('POST', to);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return { message: said };
}

/** `mergedId` merged into `keptId` (HR, a Super Admin); then the kept one's profile. */
export async function mergeCandidates(keptId: string, mergedId: string): Promise<FormState> {
  try {
    await apiSend('POST', path(keptId, '/merge'), { otherId: mergedId });
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  redirect(candidateHref(keptId));
}

/** "Merge with…": the candidate whose code was typed merged into this one, `keptId`. */
export async function mergeWithCode(keptId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const typed = String(fd.get('code') ?? '');
  const values = { code: typed };
  const code = codeTyped(typed);
  if (!code) return { errors: ['Write the other candidate’s code, e.g. CAN-0042.'], values };
  let found: CandidateListItem[];
  try {
    found = await apiGet<CandidateListItem[]>(candidatesApiPath({ q: code }));
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages, values };
    throw err;
  }
  const other = found.find((c) => c.code === code);
  if (!other) return { errors: [`${code} isn’t a candidate you can see.`], values };
  if (other.id === keptId) return { errors: ['That is this candidate. Write the other one’s code.'], values };
  const merged = await mergeCandidates(keptId, other.id);
  return { ...merged, values };
}

/** A merge undone (a Super Admin only). */
export async function undoMerge(mergeId: string): Promise<FormState> {
  return post(`/recruitment/candidates/merges/${encodeURIComponent(mergeId)}/undo`, 'The merge is undone.');
}

/** "Not the same person": the pair never suggested again. */
export async function dismissMatch(matchId: string): Promise<FormState> {
  return post(`/recruitment/candidates/matches/${encodeURIComponent(matchId)}/dismiss`, 'Dismissed: they won’t be suggested again.');
}

/** "Move to a new candidate": the application split from its candidate; then the new candidate's profile. */
export async function splitApplication(applicationId: string): Promise<FormState> {
  let made: { id: string } | undefined;
  try {
    made = await apiSend<{ id: string }>('POST', `/recruitment/candidates/split/${encodeURIComponent(applicationId)}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  if (made?.id) redirect(candidateHref(made.id));
  refresh();
  return { message: 'Moved to a new candidate.' };
}
