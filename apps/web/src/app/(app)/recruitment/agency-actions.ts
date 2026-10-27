'use server';

// HR's marks of marketing agencies (owner, 27 October 2026: "i need a flag if the candidate is ex marketing agencies or
// not AND reflectin the scoring"; asked, "Name words + your list"): a company marked a marketing agency or not one, from a
// job of a CV's work history or from Recruitment Settings, and a mark removed. Each forwards to the API (HR and a Super
// Admin; audited), which scores again the applications whose CV names the company; the page then refreshes.
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';
import { AGENCY_MARKS_API, agencyMarkApiPath, agencyMarkForm, markSavedText, MARK_FIELDS } from './agency';

const NOT_YET = 'Not available yet: the server doesn’t have the marketing agencies list yet. Please try again after its next update.';

async function send(method: 'PUT' | 'DELETE', path: string, body: unknown, said: string, values?: Record<string, string>): Promise<FormState> {
  try {
    await apiSend(method, path, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.status === 404 && method === 'PUT' ? [NOT_YET] : err.messages, ...(values && { values }) };
    throw err;
  }
  refresh();
  return { message: said };
}

/** A job's company marked a marketing agency or not (the CV card's Mark as agency / Not an agency). */
export async function setAgencyMark(company: string, agency: boolean): Promise<FormState> {
  return send('PUT', AGENCY_MARKS_API, { company, agency }, markSavedText(company, agency));
}

/** A mark removed: the company's name's words decide again. */
export async function removeAgencyMark(id: string): Promise<FormState> {
  return send('DELETE', agencyMarkApiPath(id), undefined, 'Mark removed.');
}

/** Recruitment Settings' add form: a company and whether it is a marketing agency. */
export async function saveAgencyMark(_prev: FormState, fd: FormData): Promise<FormState> {
  const company = fd.get(MARK_FIELDS.company);
  const choice = fd.get(MARK_FIELDS.agency);
  const values = { [MARK_FIELDS.company]: typeof company === 'string' ? company : '', [MARK_FIELDS.agency]: typeof choice === 'string' ? choice : '' };
  const { body, errors } = agencyMarkForm(fd);
  if (!body) return { errors, values };
  return send('PUT', AGENCY_MARKS_API, body, markSavedText(body.company, body.agency), values);
}
