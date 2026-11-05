'use server';

// Uploading hours from Excel (owner, 5 November 2026: "how to upload a bulk time log?"; asked, "Our own Excel template",
// "each person and HR", HR's "Sent to the approver"): the file as it is, to the API, which reads it by its content,
// checks every row (nothing is saved while any has a problem) and who uploads whose hours, so calling these directly
// can't bypass that. Someone's own: saved, or saved and sent (POST /me/timesheet/upload, send=true|false); HR's, the
// CEO's or a Super Admin's for others: each week sent to whoever approves it (POST /timesheets/upload).
import { refresh } from 'next/cache';
import type { TimesheetUploadResult } from '@trendlix/shared';
import { ApiError, apiUpload } from '@/lib/api';
import { apiMessages } from '../payroll/actions-common';
import { hoursUploadProblem, MY_TIMESHEET_UPLOAD_API, TIMESHEETS_UPLOAD_API, type HoursUploadState } from './timesheets';

async function upload(path: string, fd: FormData, send: boolean | null): Promise<HoursUploadState> {
  const file = fd.get('file');
  const chosen = file instanceof File && file.size > 0 ? file : null;
  const problem = hoursUploadProblem(chosen);
  if (problem) return { errors: [problem] };
  const form = new FormData();
  if (send !== null) form.append('send', send ? 'true' : 'false');
  form.append('file', chosen!, chosen!.name);
  let result: TimesheetUploadResult | undefined;
  try {
    result = await apiUpload<TimesheetUploadResult>('POST', path, form);
  } catch (err) {
    if (err instanceof ApiError) return { errors: apiMessages(err) };
    throw err;
  }
  if (!result?.weeks) return { errors: ['The file was read, but the server sent no answer. Open the timesheets to see what was saved.'] };
  refresh();
  return { result };
}

/** The caller's own hours: saved, or (the button "Upload and send for approval": send=true) saved and sent. */
export async function uploadMyHours(_prev: HoursUploadState, fd: FormData): Promise<HoursUploadState> {
  return upload(MY_TIMESHEET_UPLOAD_API, fd, fd.get('send') === 'true');
}

/** Anyone's hours HR, the CEO or a Super Admin may see: each week sent to whoever approves it. */
export async function uploadHoursForOthers(_prev: HoursUploadState, fd: FormData): Promise<HoursUploadState> {
  return upload(TIMESHEETS_UPLOAD_API, fd, null);
}
