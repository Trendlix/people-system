import Link from 'next/link';
import { Suspense } from 'react';
import { PAPERWORK_LABELS } from '@trendlix/shared';
import { DocumentViewer, VIEW_BUTTON } from '@/components/document-viewer';
import { ApiError, apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { PaperworkSearchHit } from '@/lib/types';
import { StaffOnly } from '../../staff-only';
import { paperworkHref } from '../paperwork';
import { BackLink, canSeeEmployeeFiles, Empty, Loading } from '../ui';
import { shownCode } from '@/lib/hidden';

// Search the text the OCR service read from scanned paperwork (HR and CEO). The API makes Arabic spelling variants
// and digit forms match, and records every national ID scan a search shows.

type Query = Record<string, string | string[] | undefined>;

/** The API returns at most this many, newest first. */
const LIMIT = 50;
const ARABIC = /[؀-ۿ]/;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

function Message({ children }: { children: React.ReactNode }) {
  return <p className="border-t border-line px-4 py-10 text-center text-sm text-muted">{children}</p>;
}

async function Search({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canSeeEmployeeFiles(user)) return <Empty>Only HR and the CEO can search employee documents.</Empty>;

  const q = one(query.q).trim().slice(0, 100);
  let hits: PaperworkSearchHit[] | null = null;
  let error: string | null = null;
  if ([...q].length >= 2) {
    try {
      hits = await apiGet<PaperworkSearchHit[]>(`/paperwork/search?q=${encodeURIComponent(q)}`);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 400) throw err;
      error = err.message; // e.g. only punctuation was typed
    }
  }

  return (
    <section className="card">
      <form className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-56 flex-1">
          <label htmlFor="document-search" className="label">
            Search
          </label>
          <input
            id="document-search"
            name="q"
            type="search"
            dir="auto"
            minLength={2}
            maxLength={100}
            defaultValue={q}
            placeholder="Words or numbers in the document, in Arabic or English"
            className="input"
          />
        </div>
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
        {q && (
          <Link href="/employees/documents" className="btn btn-secondary">
            Clear
          </Link>
        )}
      </form>

      {error ? (
        <Message>{error}</Message>
      ) : hits === null ? (
        <Message>{q ? 'Type at least 2 characters to search.' : 'Only files whose text has been read can be found.'}</Message>
      ) : hits.length === 0 ? (
        <Message>No documents contain “{q}”.</Message>
      ) : (
        <>
          <div className="overflow-x-auto border-t border-line">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Document</th>
                  <th>Uploaded</th>
                  <th>Found Text</th>
                  <th>
                    <span className="sr-only">File</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {hits.map(({ item, employee, snippet }) => {
                  const kind = PAPERWORK_LABELS[item.kind] ?? item.kind;
                  return (
                    <tr key={item.id}>
                      <td>
                        <Link href={`/employees/${employee.id}`} className="font-semibold">
                          {employee.fullNameEn}
                        </Link>
                        {shownCode(employee.employeeCode) && <div className="text-xs text-muted tabular-nums">{employee.employeeCode}</div>}
                      </td>
                      <td>
                        <div className="whitespace-nowrap">{kind}</div>
                        <div className="max-w-56 truncate text-xs text-muted">
                          <bdi>{item.fileName}</bdi>
                        </div>
                      </td>
                      <td className="whitespace-nowrap tabular-nums">{formatDate(item.uploadedAt)}</td>
                      <td className="min-w-64">
                        <span dir="auto" lang={ARABIC.test(snippet) ? 'ar' : undefined} className="block">
                          {snippet}
                        </span>
                      </td>
                      <td>
                        {/* Loaded only when opened: each download of a national ID scan is written to the audit log. */}
                        <DocumentViewer
                          title={`${kind} · ${employee.fullNameEn}`}
                          files={[{ alt: `${kind} of ${employee.fullNameEn}`, src: paperworkHref(item.id), mimeType: item.mimeType }]}
                          className={`${VIEW_BUTTON} whitespace-nowrap`}
                        >
                          View<span className="sr-only"> {kind} of {employee.fullNameEn}</span>
                        </DocumentViewer>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-3 text-sm text-muted">
            {hits.length === 1 ? '1 document' : `${hits.length} documents`}
            {hits.length >= LIMIT && `: the ${LIMIT} newest. Add more words to narrow the search.`}
          </p>
        </>
      )}
    </section>
  );
}

export default function DocumentSearchPage({ searchParams }: PageProps<'/employees/documents'>) {
  return (
    <StaffOnly>
      <div className="space-y-4">
        <BackLink href="/employees">Employees</BackLink>
        <div>
          <h1 className="page-title">Search Documents</h1>
          <p className="mt-1 text-muted">Find scanned paperwork in the employee files by the text read from it.</p>
        </div>
        <Suspense fallback={<Loading />}>
          <Search searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
