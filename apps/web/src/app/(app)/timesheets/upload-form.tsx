'use client';

import Link from 'next/link';
import { timesheetHoursText, timesheetWeekText, type TimesheetUploadResult } from '@trendlix/shared';
import { useActionState, useState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import { HOURS_UPLOAD_ACCEPT, hoursUploadProblem, myTimesheetHref, replacedText, timesheetHref, uploadDoneText, uploadedWeeks, type HoursUploadState } from './timesheets';
import { TimesheetStatusBadge } from './ui';

// Uploading hours from Excel (owner, 5 November 2026: "how to upload a bulk time log?"; asked, "Our own Excel template",
// "each person and HR", HR's "Sent to the approver"): the file, checked here for a quick answer (an .xlsx of up to 5 MB)
// and again by the API, which reads every row; someone's own upload is saved ("Upload and save") or saved and sent
// ("Upload and send for approval"), an upload for others is sent. Then what was done: each week with its hours, where it
// stands and the lines it replaced, opening the week (their own on My Timesheet, others' on their page); or every
// problem, by row, with nothing saved.

type Action = (prev: HoursUploadState, fd: FormData) => Promise<HoursUploadState>;

export function UploadHoursForm({ action, own }: { action: Action; own: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(!own);
  const fid = useFieldIds();
  return (
    <div className="space-y-6">
      <form
        action={formAction}
        onSubmit={(e) => {
          const box = e.currentTarget.elements.namedItem('file') as HTMLInputElement | null;
          const found = hoursUploadProblem(box?.files?.[0]);
          setProblem(found);
          if (found) e.preventDefault();
        }}
        aria-label="Upload hours"
        className="card space-y-4 p-6"
      >
        <FormErrors errors={problem ? [problem] : state.errors} />
        <div>
          <label htmlFor={fid('file')} className="label">
            The hours file (.xlsx)
          </label>
          <input
            id={fid('file')}
            name="file"
            type="file"
            required
            accept={HOURS_UPLOAD_ACCEPT}
            onChange={() => setProblem(null)}
            className="block w-full text-sm file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-card file:px-4 file:text-sm file:font-semibold"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {own && (
            <button type="submit" name="send" value="false" onClick={() => setSending(false)} disabled={pending} className="btn btn-secondary disabled:opacity-60">
              {pending && !sending ? 'Uploading…' : 'Upload and save'}
            </button>
          )}
          <button type="submit" name="send" value="true" onClick={() => setSending(true)} disabled={pending} className="btn btn-primary disabled:opacity-60">
            {pending && sending ? 'Uploading…' : 'Upload and send for approval'}
          </button>
        </div>
      </form>
      {state.result && !state.errors && <UploadDone result={state.result} own={own} />}
    </div>
  );
}

/** What the upload did: in words, then each week. */
function UploadDone({ result, own }: { result: TimesheetUploadResult; own: boolean }) {
  const weeks = uploadedWeeks(result);
  return (
    <section aria-labelledby="upload-done" className="space-y-3">
      <p id="upload-done" role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
        {uploadDoneText(result)}
      </p>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              {!own && <th scope="col">Employee</th>}
              <th scope="col">Week</th>
              <th scope="col" className="text-right">
                Lines
              </th>
              <th scope="col" className="text-right">
                Hours
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => {
              const replaced = replacedText(w.replaced);
              return (
                <tr key={w.id} className="align-top">
                  {!own && (
                    <td className="min-w-44">
                      <span className="font-semibold">{w.employee.fullNameEn}</span>
                      {w.employee.employeeCode && <div className="text-xs text-muted">{w.employee.employeeCode}</div>}
                    </td>
                  )}
                  <td className="whitespace-nowrap tabular-nums">
                    <Link href={own ? myTimesheetHref(w.weekStart) : timesheetHref(w.id)}>{timesheetWeekText(w.weekStart)}</Link>
                    {replaced && <div className="text-xs text-muted">{replaced}</div>}
                  </td>
                  <td className="text-right tabular-nums">{w.lines}</td>
                  <td className="text-right tabular-nums">{timesheetHoursText(w.totalHours)}</td>
                  <td>
                    <TimesheetStatusBadge status={w.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
