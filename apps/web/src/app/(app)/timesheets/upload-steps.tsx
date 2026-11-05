import { TIMESHEET_UPLOAD_MAX_MB, TIMESHEET_UPLOAD_MAX_ROWS } from '@trendlix/shared';
import { TIMESHEET_TEMPLATE_HREF } from './timesheets';

// How uploading hours goes (owner, 5 November 2026: "how to upload a bulk time log?"; "Our own Excel template"): the
// template to download, what each row holds, and what the upload does: someone's own (`own`), or HR's for others, each
// person's weeks sent to whoever approves them. No hooks.

export function UploadSteps({ own }: { own: boolean }) {
  return (
    <ol className="card list-decimal space-y-2 py-4 pr-6 pl-10 text-sm">
      <li>
        {/* a plain link, never prefetched: the API makes the template on each download */}
        <a href={TIMESHEET_TEMPLATE_HREF} className="font-semibold">
          Download the template
        </a>
        . Its How to fill sheet lists the clients{own ? '' : ' and the employees switched to timesheets, with their codes'}.
      </li>
      <li>
        One row for each line: the day, the client (from the list) or the task, the hours (7.5 or 7:30) and a note if you like.{' '}
        {own ? 'Leave Employee code empty, or write your own.' : 'Write the employee’s code on every row.'}
      </li>
      <li>
        Upload it. Each week in the file replaces that week’s hours, so uploading the same file again changes nothing.{' '}
        {own ? 'A week sent for approval or approved can’t be changed.' : 'Each person’s weeks are sent to whoever approves their timesheet; a week already sent or approved can’t be changed.'}{' '}
        Nothing is saved while any row has a problem: each is listed by its row. Up to {TIMESHEET_UPLOAD_MAX_ROWS.toLocaleString('en-US')} rows and{' '}
        {TIMESHEET_UPLOAD_MAX_MB} MB.
      </li>
    </ol>
  );
}
