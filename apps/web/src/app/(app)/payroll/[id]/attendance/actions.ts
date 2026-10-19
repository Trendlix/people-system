'use server';

// Importing attendance from Zoho People on a draft payroll run (owner, 19 October 2026: "Import Zoho now, replace it
// later"): uploading Zoho's attendance entries (the files as they are, POST /payroll/runs/:id/attendance-imports), HR's
// choice for a person of them (confirm, pick, skip, back to the match by name: PATCH …/people) and Apply (POST …/apply).
// Each forwards to the API, which checks the role (HR uploads; HR and the CEO choose and apply), that the run is a
// draft, the files by their content, and whose lines the user fills, so calling these directly can't bypass that.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend, apiUpload } from '@/lib/api';
import type { AttendanceImportView } from '@/lib/attendance-types';
import type { FormState } from '@/lib/types';
import { apiMessages, UUID } from '../../actions-common';
import { attendanceReviewHref, importPath, importsPath, personChoice, uploadProblems } from './attendance';

/** Uploads the chosen files and opens their review. */
export async function uploadAttendance(runId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(runId)) return { errors: ['This payroll was not found.'] };
  const files = fd.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  const problems = uploadProblems(files);
  if (problems.length) return { errors: problems };
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  let made: AttendanceImportView | undefined;
  try {
    made = await apiUpload<AttendanceImportView>('POST', importsPath(runId), form);
  } catch (err) {
    if (err instanceof ApiError) return { errors: apiMessages(err) };
    throw err;
  }
  if (!made?.id) return { errors: ['The files were read, but the server sent no review. Reload the payroll to see its imports.'] };
  refresh();
  redirect(attendanceReviewHref(runId, made.id));
}

/** HR's choice for a person of the files: an employee (a close name confirmed, or someone picked), skip, or undo. */
export async function choosePerson(runId: string, importId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!UUID.test(runId) || !UUID.test(importId)) return { errors: ['This import was not found.'] };
  const choice = personChoice(fd);
  if (!choice) return { errors: ['Choose the employee from the list.'] };
  try {
    await apiSend('PATCH', `${importPath(runId, importId)}/people`, choice);
  } catch (err) {
    if (err instanceof ApiError) return { errors: apiMessages(err) };
    throw err;
  }
  refresh();
  return { message: 'skipped' in choice ? 'Skipped.' : choice.employeeId ? 'Saved.' : 'Back to the match by name.' };
}

/** Fills the run's lines the user fills from the import. */
export async function applyAttendance(runId: string, importId: string): Promise<FormState> {
  if (!UUID.test(runId) || !UUID.test(importId)) return { errors: ['This import was not found.'] };
  let view: AttendanceImportView | undefined;
  try {
    view = await apiSend<AttendanceImportView>('POST', `${importPath(runId, importId)}/apply`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: apiMessages(err) };
    throw err;
  }
  refresh();
  const n = view?.people.filter((p) => p.applied && p.applied.at === view?.appliedAt).length ?? 0;
  return { message: `Applied: ${n} ${n === 1 ? 'line' : 'lines'} filled from Zoho People. The payroll's figures and pay show them.` };
}
