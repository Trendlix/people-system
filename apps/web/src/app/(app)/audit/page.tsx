import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { Select } from '@/components/select';
import { formatDate, titleCase } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../organization/ui';
import { StaffOnly } from '../staff-only';
import {
  AUDIT_PATH,
  auditExcelHref,
  auditHref,
  canSeeAuditLog,
  employeeOptionLabel,
  entriesLabel,
  filtersText,
  historyHref,
  isFiltered,
  maskedText,
  opensProfiles,
  rangeText,
  readAuditFilters,
  recordText,
  shown,
  splitChanges,
  userOptionLabel,
  type AuditEntry,
  type AuditFilters,
  type AuditOptions,
  type AuditPage,
} from './audit';
import { loadAuditOptions, loadAuditPage } from './data';
import { shownCode } from '@/lib/hidden';

// The Audit Log (owner, 19 October 2026: "an Audit Log page showing who changed what and when"), in the sidebar for the
// Super Admin and the CEO: every change in the system, every sign-in and every view of restricted data, newest first, 50
// a page. Each entry says when (Cairo time, DD/MM/YYYY and 12-hour), who ("Super Admin X as Y" for what a Super Admin did
// viewing as someone), what they did and on what, with a link to where that record is when the reader can open it, the
// person it is about (a link to everything about them), and its changes folded, from → to; restricted values (national
// IDs, bank accounts, pay) only as changed or set, as the log has them. Filtered by the days, who, the action, the kind
// of record, one record, one person and text in what changed, all in the address (?from=&to=&user=&action=&type=&record=
// &employee=&q=&page=) so a view can be shared; an employee's History link on their profile opens it with ?employee=.
// Export to Excel gives the same filters' newest 10,000 entries (excel/route.ts). The API checks the roles again.

export const metadata: Metadata = { title: 'Audit Log · People System' };

type Query = Record<string, string | string[] | undefined>;

const NOT_ALLOWED = 'Only the Super Admin and the CEO can see the audit log.';
const quiet = 'px-4 py-10 text-center text-sm text-muted';
const small = 'btn btn-secondary min-h-9 px-3';

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
    </div>
  );
}

/** The filters: a GET form, so the address keeps them. */
function Filters({ filters, options }: { filters: AuditFilters; options: AuditOptions | null }) {
  return (
    // keyed by the filters, so following a link (Clear, a person's History) shows them, not what was typed before
    <form key={auditHref(filters)} action={AUDIT_PATH} aria-label="Filter the audit log" className="card space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="audit-from" label="From">
          <DateInput id="audit-from" name="from" defaultValue={formatDate(filters.from)} />
        </Field>
        <Field id="audit-to" label="To">
          <DateInput id="audit-to" name="to" defaultValue={formatDate(filters.to)} />
        </Field>
        <Field id="audit-user" label="Who">
          <Select id="audit-user" name="user" defaultValue={filters.user} className="input">
            <option value="">Anyone</option>
            {options?.users.map((u) => (
              <option key={u.id} value={u.id}>
                {userOptionLabel(u)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="audit-action" label="Action">
          <Select id="audit-action" name="action" defaultValue={filters.action} className="input">
            <option value="">Any action</option>
            {options?.actions.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="audit-type" label="Kind of record">
          <Select id="audit-type" name="type" defaultValue={filters.type} className="input">
            <option value="">Any kind</option>
            {options?.entityTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="audit-employee" label="Employee">
          <Select id="audit-employee" name="employee" defaultValue={filters.employee} className="input" aria-describedby="audit-employee-hint">
            <option value="">Anyone</option>
            {options?.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {employeeOptionLabel(e)}
              </option>
            ))}
          </Select>
          <p id="audit-employee-hint" className="hint">
            Everything about them. Type to search.
          </p>
        </Field>
        <Field id="audit-record" label="Record ID">
          <input
            id="audit-record"
            name="record"
            defaultValue={filters.record}
            maxLength={36}
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. 0b8f0c1e-2d3a-…"
            aria-describedby="audit-record-hint"
            className="input font-mono"
          />
          <p id="audit-record-hint" className="hint">
            One record, by the id in its address.
          </p>
        </Field>
        <Field id="audit-q" label="Search the changes">
          <input id="audit-q" name="q" type="search" maxLength={200} defaultValue={filters.q} placeholder="A name, a number, a value" className="input" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary">
          Show
        </button>
        {isFiltered(filters) && (
          <Link href={AUDIT_PATH} className="btn btn-secondary">
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}

/** What changed, folded: the fields from → to, then the values given (on a create, or naming what it is about). */
function Changes({ entry }: { entry: AuditEntry }) {
  if (!entry.changes.length) return null;
  const { changed, values } = splitChanges(entry.changes);
  const rowHead = 'text-sm font-medium tracking-normal whitespace-normal text-ink normal-case';
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-accent">Changes ({entry.changes.length})</summary>
      <div className="mt-2 space-y-3">
        {changed.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                </tr>
              </thead>
              <tbody>
                {changed.map((c) => (
                  <tr key={c.field} className="align-top">
                    <th scope="row" className={`min-w-40 ${rowHead}`}>
                      {c.label}
                    </th>
                    {c.masked ? (
                      <td colSpan={2} className="text-muted italic">
                        {maskedText(c.masked)}
                      </td>
                    ) : (
                      <>
                        <td className="min-w-32 break-words">{shown(c.from)}</td>
                        <td className="min-w-32 break-words">
                          <span aria-hidden="true" className="text-muted">
                            →{' '}
                          </span>
                          {shown(c.to)}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {values.length > 0 && (
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(8rem,16rem)_minmax(0,1fr)]">
            {values.map((c) => (
              <Fragment key={c.field}>
                <dt className="text-muted">{c.label}</dt>
                <dd className="break-words">{c.masked ? <span className="text-muted italic">{maskedText(c.masked)}</span> : shown(c.to)}</dd>
              </Fragment>
            ))}
          </dl>
        )}
      </div>
    </details>
  );
}

function EntryItem({ entry }: { entry: AuditEntry }) {
  const e = entry.employee;
  return (
    <li className="grid gap-x-6 gap-y-1 px-4 py-4 sm:grid-cols-[10.5rem_minmax(0,1fr)]">
      <p className="text-sm text-muted tabular-nums">
        <time dateTime={entry.at}>{entry.when}</time>
      </p>
      <div className="min-w-0 space-y-1.5">
        <p className="text-sm break-words">
          <span className="font-semibold">{entry.who.text}</span>
          <span className="text-muted"> · </span>
          {entry.actionLabel}
        </p>
        <p className="text-sm break-words">
          <span className="font-medium">{recordText(entry)}</span>
          {e && (
            <>
              <span className="text-muted"> · </span>
              <Link href={historyHref(e.id)} title={`Everything about ${e.fullNameEn}`}>
                {e.fullNameEn}
              </Link>
              {shownCode(e.employeeCode) && <span className="text-muted"> {e.employeeCode}</span>}
            </>
          )}
          {entry.link && (
            <>
              <span className="text-muted"> · </span>
              <Link href={entry.link.href} prefetch={false}>
                {entry.link.label}
              </Link>
            </>
          )}
        </p>
        <Changes entry={entry} />
      </div>
    </li>
  );
}

function Pager({ page, filters }: { page: AuditPage; filters: AuditFilters }) {
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
      <span className="text-muted">
        {rangeText(page)}, newest first{page.pages > 1 && ` · page ${page.page} of ${page.pages.toLocaleString('en-US')}`}
      </span>
      {page.pages > 1 && (
        <div className="flex gap-2">
          {page.page > 1 && (
            <Link href={auditHref(filters, page.page - 1)} className={small}>
              ← Newer
            </Link>
          )}
          {page.page < page.pages && (
            <Link href={auditHref(filters, page.page + 1)} className={small}>
              Older →
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}

/** The person whose History this is, with their profile for those who open profiles. */
function PersonHeading({ filters, options, profileLink }: { filters: AuditFilters; options: AuditOptions | null; profileLink: boolean }) {
  if (!filters.employee) return null;
  const person = options?.employees.find((e) => e.id === filters.employee);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="text-lg font-semibold">{titleCase(person ? `History of ${person.fullNameEn}` : 'History of One Employee')}</h2>
      {person && shownCode(person.employeeCode) && <span className="text-sm text-muted">{person.employeeCode}</span>}
      {profileLink && (
        <Link href={`/employees/${filters.employee}`} className="text-sm">
          Open profile
        </Link>
      )}
    </div>
  );
}

async function Log({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canSeeAuditLog(user)) return <Empty>{NOT_ALLOWED}</Empty>;
  const { filters, problems } = readAuditFilters(query);
  const [options, loaded] = await Promise.all([loadAuditOptions(), loadAuditPage(filters)]);
  const choices = options.kind === 'ok' ? options.value : null;
  const described = filtersText(filters, choices);

  let body: React.ReactNode;
  if (loaded.kind === 'ok') {
    const page = loaded.value;
    body = page.entries.length ? (
      <>
        <ol className="divide-y divide-line-soft">
          {page.entries.map((e) => (
            <EntryItem key={e.id} entry={e} />
          ))}
        </ol>
        <Pager page={page} filters={filters} />
      </>
    ) : (
      <p className={quiet}>
        {page.total > 0
          ? `No entries on this page: there are ${entriesLabel(page.total)}.`
          : isFiltered(filters)
            ? 'Nothing in the log matches these filters.'
            : 'Nothing in the log yet.'}
      </p>
    );
  } else {
    body = (
      <p className={quiet}>
        {loaded.kind === 'forbidden'
          ? NOT_ALLOWED
          : loaded.kind === 'unavailable'
            ? choices && filters.employee
              ? 'That employee isn’t on record.'
              : 'Not available yet: the server does not have the audit log yet.'
            : `The audit log could not be loaded. ${loaded.messages.join(' ')}`}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {problems.length > 0 && (
        <div role="alert" className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          {problems.map((p) => (
            <p key={p}>{p} That filter is left out.</p>
          ))}
        </div>
      )}
      <Filters filters={filters} options={choices} />
      {options.kind !== 'ok' && <p className="text-sm text-muted">The lists of users, actions and employees could not be loaded: the filters already in the address still apply.</p>}
      <PersonHeading filters={filters} options={choices} profileLink={opensProfiles(user)} />
      <section aria-labelledby="audit-entries" className="card">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 id="audit-entries" className="font-semibold">
              Entries
            </h2>
            <p className="text-xs text-muted">
              {loaded.kind === 'ok' ? entriesLabel(loaded.value.total) : 'Not loaded'}
              {described && ` · ${described}`}
            </p>
          </div>
          <div className="text-right">
            {/* a plain link, never prefetched: the API makes the workbook on each download, and logs it */}
            <a href={auditExcelHref(filters)} className="btn btn-secondary">
              Export to Excel
            </a>
            <p className="hint">The newest 10,000 entries with these filters.</p>
          </div>
        </div>
        {body}
      </section>
    </div>
  );
}

export default function AuditLogPage({ searchParams }: PageProps<'/audit'>) {
  return (
    <StaffOnly>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Audit Log</h1>
          <p className="mt-1 text-muted">
            Who changed what and when, in every part of the system, newest first. Restricted values, such as national IDs, bank accounts and pay, show only that
            they changed.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <Log searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
