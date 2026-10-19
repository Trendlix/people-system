'use server';

// Import from the Attendance section (owner, 19 October 2026: "where am i going to import the sheets?"): HR picks the
// month and drops Zoho People's files, and they go into the month's payroll run as on the run's own Import attendance
// (POST /payroll/runs/:id/attendance-imports): into the month's draft run; when there is no run for the month yet, the
// month's draft run is made first (POST /payroll/runs, as Payroll's New run does); a month whose run is with the CEO,
// approved or paid is locked and takes no import. Then the import's review opens. The API checks the role (HR), the run
// and the files again, so calling this directly can't bypass that.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch, apiSend, apiUpload, messagesOf } from '@/lib/api';
import type { AttendanceImportView } from '@/lib/attendance-types';
import type { FormState, PayrollRunSummary, PayrollRunView } from '@/lib/types';
import { apiMessages } from '../../payroll/actions-common';
import { attendanceReviewHref, importsPath, uploadProblems } from '../../payroll/[id]/attendance/attendance';
import { isMonth, monthName } from '../../payroll/list';
import { importTarget, lockedText } from '../attendance';

/** The runs, to know the month's: null with what went wrong. */
async function runs(): Promise<{ runs: PayrollRunSummary[] } | { errors: string[] }> {
  let res: Response;
  try {
    res = await apiFetch('/payroll/runs');
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  if (res.status === 401) redirect('/login');
  if (res.status === 403) return { errors: ['Only HR imports attendance.'] };
  if (!res.ok) return { errors: await messagesOf(res) };
  return { runs: (await res.json()) as PayrollRunSummary[] };
}

/** Reads the files into the month's draft run (made first when there is none) and opens their review. */
export async function importForMonth(_prev: FormState, fd: FormData): Promise<FormState> {
  const month = String(fd.get('month') ?? '');
  const values = { month };
  if (!isMonth(month)) return { errors: ['Choose the month the attendance is for.'], values };
  const files = fd.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  const problems = uploadProblems(files);
  if (problems.length) return { errors: problems, values };

  const listed = await runs();
  if ('errors' in listed) return { errors: listed.errors, values };
  const target = importTarget(
    month,
    listed.runs.map((r) => ({ id: r.id, month: r.month, status: r.status })),
  );
  if (target.kind === 'locked') return { errors: [lockedText(month, target.status)], values };

  let runId: string;
  let made = false;
  if (target.kind === 'create') {
    try {
      const run = await apiSend<PayrollRunView>('POST', '/payroll/runs', { month });
      if (!run?.id) return { errors: [`The ${monthName(month)} payroll couldn't be made. Reload the page and try again.`], values };
      runId = run.id;
      made = true;
    } catch (err) {
      if (err instanceof ApiError) return { errors: apiMessages(err), values };
      throw err;
    }
  } else runId = target.runId;

  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  let view: AttendanceImportView | undefined;
  try {
    view = await apiUpload<AttendanceImportView>('POST', importsPath(runId), form);
  } catch (err) {
    if (err instanceof ApiError) {
      const note = made ? [`The ${monthName(month)} payroll was made as a draft for it: choose the files again to import them.`] : [];
      return { errors: [...apiMessages(err), ...note], values };
    }
    throw err;
  }
  if (!view?.id) return { errors: ['The files were read, but the server sent no review. Open Import History to see the imports.'], values };
  refresh();
  redirect(attendanceReviewHref(runId, view.id));
}
