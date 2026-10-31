'use server';

// A person's attendance records put right by a Super Admin (owner, 31 October 2026: "delete one of them" — "as a super
// admin"; "zoho or system"): removing a record, putting it back, and choosing the source a day uses, each with the API's
// own checks and words (attendance-records.service.ts). The page reloads with the day as it is now.
import { refresh } from 'next/cache';
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

async function send(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<FormState> {
  try {
    await apiSend(method, path, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  refresh();
  return {};
}

/** One record removed, with its reason. */
export async function removeRecord(_prev: FormState, fd: FormData): Promise<FormState> {
  const employeeId = text(fd, 'employeeId');
  return send('POST', `/attendance/employees/${encodeURIComponent(employeeId)}/records/remove`, {
    date: text(fd, 'date'),
    source: text(fd, 'source'),
    recordId: text(fd, 'recordId'),
    reason: text(fd, 'reason'),
  });
}

/** A record removed put back. */
export async function restoreRecord(_prev: FormState, fd: FormData): Promise<FormState> {
  return send('POST', `/attendance/records/removals/${encodeURIComponent(text(fd, 'removalId'))}/restore`);
}

/** The source the day uses: Zoho's or the system's (the button pressed), with its reason. */
export async function chooseSource(_prev: FormState, fd: FormData): Promise<FormState> {
  const employeeId = text(fd, 'employeeId');
  return send('PUT', `/attendance/employees/${encodeURIComponent(employeeId)}/day-source`, { date: text(fd, 'date'), source: text(fd, 'source'), reason: text(fd, 'reason') });
}

/** Back to the usual source for the day. */
export async function clearSource(_prev: FormState, fd: FormData): Promise<FormState> {
  const employeeId = text(fd, 'employeeId');
  return send('DELETE', `/attendance/employees/${encodeURIComponent(employeeId)}/day-source?date=${encodeURIComponent(text(fd, 'date'))}`);
}
