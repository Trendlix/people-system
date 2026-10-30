import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { LEAVE_PATH } from '@/components/nav';
import { formatDateTime } from '@/lib/format';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { ActionButton } from '../../employees/[id]/contracts/contract-buttons';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { notLoadedText } from '../../payroll/load';
import { deleteLeaveImport, uploadLeaveImport } from './actions';
import { loadLeaveImports } from './data';
import { UploadLeaveForm } from './forms';
import { deleteBlocked, deleteConfirmText, deletedNotice, historyRowsText, historyStateText, importsLeave, LEAVE_IMPORT_TEMPLATE_HREF, leaveImportHref } from './import';

// Import Leave, from Leave Requests (owner, 21 October 2026: "how to import bulk leaves?"; asked, he chose "Both": the
// leave already taken, recorded as approved, and each person's current balance; and "Our Excel template"): download the
// template (the leave types on as a list, the employees' codes), fill it in and upload it, or upload Zoho People's leave
// export as it is; its review opens, and nothing is saved to anyone's leave until it is applied there. Below, every
// import, the latest first: its file, who uploaded it and when, its rows, and whether it is applied or undone; a Super
// Admin deletes one with nothing left of it (only a Super Admin deletes: owner, 15 October 2026). HR, and the CEO for the
// C-level people; the API checks it again.

export const metadata: Metadata = { title: 'Import Leave · People System' };

async function Imports({ searchParams }: { searchParams: PageProps<'/leave/import'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!importsLeave(user)) return <Empty>Only HR imports leave (and the CEO, for C-level people).</Empty>;
  const loaded = await loadLeaveImports();
  const notice = deletedNotice(query);
  const deletes = canDelete(user);
  return (
    <div className="space-y-8">
      {notice && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {notice}
        </p>
      )}
      <section aria-labelledby="upload-heading" className="card space-y-4 p-6">
        <div className="space-y-1">
          <h2 id="upload-heading" className="text-lg font-semibold">
            Upload a File
          </h2>
          <p className="text-sm text-muted">
            The template has three sheets: Leaves taken (who, the leave type from a list, From, To, the days if you know them, notes), Balances (each
            person&apos;s annual leave left as of a day) and How to fill (the steps, the leave types and the employees&apos; codes). Its Leave type
            list ends with Work from home and Official duty, which aren&apos;t leave. Zoho People&apos;s leave export can be uploaded as it is: its leave
            types are matched to the system&apos;s on the review, On Duty to official duty.
          </p>
        </div>
        <a href={LEAVE_IMPORT_TEMPLATE_HREF} className="btn btn-secondary no-underline" download>
          Download the template
        </a>
        <UploadLeaveForm action={uploadLeaveImport} />
      </section>

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-lg font-semibold">
          Import History
        </h2>
        {loaded.kind !== 'ok' ? (
          <Empty>{loaded.kind === 'unavailable' ? 'Not available yet: the server does not have the leave import yet.' : notLoadedText(loaded, 'imports')}</Empty>
        ) : loaded.value.length === 0 ? (
          <div className="card px-6 py-8 text-center text-sm text-muted">No leave has been imported yet.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Uploaded</th>
                  <th scope="col">Rows</th>
                  <th scope="col">Where It Stands</th>
                  <th scope="col">
                    <span className="sr-only">Review</span>
                  </th>
                  {deletes && (
                    <th scope="col">
                      <span className="sr-only">Delete</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {loaded.value.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="max-w-72">
                      <span className="font-semibold break-all">{r.fileName}</span>
                      <div className="text-xs text-muted">{r.sourceLabel}</div>
                    </td>
                    <td className="text-sm whitespace-nowrap">
                      {formatDateTime(r.createdAt)}
                      {r.createdBy && <div className="text-xs text-muted">by {r.createdBy}</div>}
                    </td>
                    <td className="text-sm">{historyRowsText(r)}</td>
                    <td className={`text-sm ${r.state === 'applied' ? 'text-ok' : 'text-muted'}`}>{historyStateText(r)}</td>
                    <td className="text-right">
                      <Link href={leaveImportHref(r.id)} className="font-semibold">
                        Review<span className="sr-only"> {r.fileName}</span>
                      </Link>
                    </td>
                    {deletes && (
                      <td className="max-w-44 text-right">
                        <ActionButton
                          action={deleteLeaveImport.bind(null, r.id)}
                          pendingText="Deleting…"
                          variant="danger"
                          confirmText={deleteConfirmText(r.fileName)}
                          disabled={deleteBlocked(r.kept) !== null}
                          disabledNote={deleteBlocked(r.kept) ?? undefined}
                        >
                          Delete<span className="sr-only"> the import of {r.fileName}</span>
                        </ActionButton>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line px-4 py-3 text-sm text-muted">
              {loaded.value.length} {loaded.value.length === 1 ? 'import' : 'imports'}, the latest first
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

export default function LeaveImportPage({ searchParams }: PageProps<'/leave/import'>) {
  return (
    <div className="max-w-6xl space-y-6">
      <div className="space-y-2">
        <BackLink href={LEAVE_PATH}>Leave Requests</BackLink>
        <h1 className="page-title">Import Leave</h1>
        <p className="max-w-3xl text-muted">
          Leave already taken, recorded as approved, and each person&apos;s balance, so the system starts from the right numbers. Upload the template
          filled in, or Zoho People&apos;s leave export, then review every row before it is applied: ready, a duplicate, a problem to put right, or a
          person to confirm.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Imports searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
