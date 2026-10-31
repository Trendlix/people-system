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
  browserText,
  canSeeAuditLog,
  changedFieldsText,
  employeeOptionLabel,
  entriesLabel,
  filtersText,
  historyHref,
  ipText,
  ipTitle,
  isFiltered,
  isSignInFiltered,
  maskedText,
  NO_SIGN_IN_FILTERS,
  opensProfiles,
  placeOf,
  rangeText,
  readAuditFilters,
  readSignInFilters,
  readTab,
  recordText,
  refusalOf,
  shown,
  signInFiltersText,
  signInsExcelHref,
  signInsHref,
  signInsLabel,
  splitChanges,
  userOptionLabel,
  type AuditEntry,
  type AuditFilters,
  type AuditFrom,
  type AuditOptions,
  type AuditPage,
  type AuditTab,
  type SignInFilters,
  type SignInsPage,
} from './audit';
import { loadAuditOptions, loadAuditPage, loadSignIns } from './data';
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
// Made like the Trendlix website's log (owner, 31 October 2026: "i want a log for all actions taken on the system ,, same
// as the one on trendlix website"; chosen: "Sign-ins tab", "Refused attempts (Result)", "Module filter"; "with location
// and ip capture"): each entry says whether it went through or was refused, its module, and where it came from (the
// address, the place or the phone's position on a map, the browser or app); filtered by module and result too, and the
// search finds an address or a city. The Sign-ins tab (?tab=sign-ins) lists every sign-in, refusal, code and sign-out
// in a table, with its own filters and its own Excel export.

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
        <Field id="audit-module" label="Module">
          <Select id="audit-module" name="module" defaultValue={filters.module} className="input">
            <option value="">Any module</option>
            {options?.modules?.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="audit-result" label="Result">
          <Select id="audit-result" name="result" defaultValue={filters.result} className="input">
            <option value="">All</option>
            {options?.results?.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="audit-q" label="Search the changes">
          <input id="audit-q" name="q" type="search" maxLength={200} defaultValue={filters.q} placeholder="A name, a number, an IP or a city" className="input" />
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
      <summary className="cursor-pointer text-sm font-semibold text-accent">
        Changes ({entry.changes.length})
        {changedFieldsText(entry.changes) && <span className="font-normal text-muted">: {changedFieldsText(entry.changes)}</span>}
      </summary>
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
          {entry.result === 'refused' && <span className="ml-2 badge bg-danger-soft text-danger">{entry.resultLabel}</span>}
          {entry.moduleLabel && <span className="ml-2 badge bg-line-soft text-muted">{entry.moduleLabel}</span>}
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
        <Refusal entry={entry} />
        <FromLine from={entry.from} />
        <Changes entry={entry} />
      </div>
    </li>
  );
}

/** Why it was refused, as the person was told, and what was tried (owner: "a Result column, Succeeded or Refused, with the reason"). */
function Refusal({ entry }: { entry: AuditEntry }) {
  const refusal = refusalOf(entry);
  if (!refusal || (!refusal.why && !refusal.tried)) return null;
  return (
    <p className="text-sm break-words text-danger">
      {refusal.why}
      {refusal.tried && <span className="ml-2 font-mono text-xs text-muted">{refusal.tried}</span>}
    </p>
  );
}

/** The phone's position on Google Maps, or the place in words; flagged when the phone said it was made up. */
function Place({ from }: { from: AuditFrom | undefined }) {
  const place = placeOf(from);
  return (
    <>
      {place.href ? (
        <a href={place.href} target="_blank" rel="noopener noreferrer">
          {place.text}
        </a>
      ) : (
        place.text
      )}
      {place.mock && (
        <span className="ml-1.5 badge bg-danger-soft text-danger" title="The phone said this position is made up (a fake GPS app).">
          Made-up position
        </span>
      )}
    </>
  );
}

/** Where an entry came from: the address, the place and the browser or app; nothing for an entry no request wrote. */
function FromLine({ from }: { from: AuditFrom | undefined }) {
  if (!from || (!from.ip && !from.place && !from.location && !from.browser)) return null;
  return (
    <p className="text-xs break-words text-muted">
      <span title={ipTitle(from)}>IP {ipText(from)}</span>
      <span> · </span>
      <Place from={from} />
      <span> · </span>
      <span title={from.userAgent ?? undefined}>{browserText(from)}</span>
    </p>
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

const tabClass = (on: boolean) =>
  `inline-flex min-h-10 items-center gap-2 border-b-2 px-1 text-sm font-semibold no-underline ${on ? 'border-ink text-ink hover:text-ink' : 'border-transparent text-muted hover:text-ink'}`;

/** Every entry, and the sign-ins (owner, 31 October 2026: "Every sign-in in its own tab"), as links. */
function Tabs({ tab }: { tab: AuditTab }) {
  return (
    <nav aria-label="Audit log" className="flex gap-6 border-b border-line">
      <Link href={AUDIT_PATH} className={tabClass(tab === 'activity')} aria-current={tab === 'activity' ? 'page' : undefined}>
        Activity
      </Link>
      <Link href={signInsHref(NO_SIGN_IN_FILTERS)} className={tabClass(tab === 'sign-ins')} aria-current={tab === 'sign-ins' ? 'page' : undefined}>
        Sign-ins
      </Link>
    </nav>
  );
}

function Problems({ problems }: { problems: string[] }) {
  if (!problems.length) return null;
  return (
    <div role="alert" className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
      {problems.map((p) => (
        <p key={p}>{p} That filter is left out.</p>
      ))}
    </div>
  );
}

async function Log({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canSeeAuditLog(user)) return <Empty>{NOT_ALLOWED}</Empty>;
  const tab = readTab(query);
  return (
    <div className="space-y-4">
      <Tabs tab={tab} />
      {tab === 'sign-ins' ? <SignIns query={query} /> : <Activity query={query} profileLink={opensProfiles(user)} />}
    </div>
  );
}

/** The Sign-ins tab's filters: a GET form, the tab kept. */
function SignInFiltersForm({ filters, options }: { filters: SignInFilters; options: AuditOptions | null }) {
  return (
    <form key={signInsHref(filters)} action={AUDIT_PATH} aria-label="Filter the sign-ins" className="card space-y-4 p-4">
      <input type="hidden" name="tab" value="sign-ins" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="sign-ins-q" label="Search">
          <input id="sign-ins-q" name="q" type="search" maxLength={200} defaultValue={filters.q} placeholder="Email, IP, city or browser" className="input" />
        </Field>
        <Field id="sign-ins-outcome" label="Outcome">
          <Select id="sign-ins-outcome" name="outcome" defaultValue={filters.outcome} className="input">
            <option value="">All outcomes</option>
            {options?.outcomes?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="sign-ins-from" label="From">
          <DateInput id="sign-ins-from" name="from" defaultValue={formatDate(filters.from)} />
        </Field>
        <Field id="sign-ins-to" label="To">
          <DateInput id="sign-ins-to" name="to" defaultValue={formatDate(filters.to)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary">
          Show
        </button>
        {isSignInFiltered(filters) && (
          <Link href={signInsHref(NO_SIGN_IN_FILTERS)} className="btn btn-secondary">
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}

function SignInsTable({ page }: { page: SignInsPage }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Email</th>
            <th scope="col">Outcome</th>
            <th scope="col">How</th>
            <th scope="col">IP</th>
            <th scope="col">Location</th>
            <th scope="col">Browser or app</th>
          </tr>
        </thead>
        <tbody>
          {page.entries.map((e) => (
            <tr key={e.id} className="align-top">
              <td className="whitespace-nowrap tabular-nums">
                <time dateTime={e.at}>{e.when}</time>
              </td>
              <td className="break-words">
                {e.email ?? '—'}
                {e.user?.name && <span className="block text-xs text-muted">{e.user.name}</span>}
              </td>
              <td>
                <span className={`badge whitespace-nowrap ${e.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>{e.outcomeLabel}</span>
              </td>
              <td className="whitespace-nowrap">{e.methodLabel ?? '—'}</td>
              <td className="whitespace-nowrap tabular-nums" title={ipTitle(e.from)}>
                {ipText(e.from)}
              </td>
              <td className="min-w-32">
                <Place from={e.from} />
              </td>
              <td className="min-w-40" title={e.from.userAgent ?? undefined}>
                {browserText(e.from)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function SignIns({ query }: { query: Query }) {
  const { filters, problems } = readSignInFilters(query);
  const [options, loaded] = await Promise.all([loadAuditOptions(), loadSignIns(filters)]);
  const choices = options.kind === 'ok' ? options.value : null;
  const described = signInFiltersText(filters, choices);

  let body: React.ReactNode;
  if (loaded.kind === 'ok') {
    const page = loaded.value;
    body = page.entries.length ? (
      <>
        <SignInsTable page={page} />
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
          <span className="text-muted">
            {rangeText(page)}, newest first{page.pages > 1 && ` · page ${page.page} of ${page.pages.toLocaleString('en-US')}`}
          </span>
          {page.pages > 1 && (
            <div className="flex gap-2">
              {page.page > 1 && (
                <Link href={signInsHref(filters, page.page - 1)} className={small}>
                  ← Newer
                </Link>
              )}
              {page.page < page.pages && (
                <Link href={signInsHref(filters, page.page + 1)} className={small}>
                  Older →
                </Link>
              )}
            </div>
          )}
        </nav>
      </>
    ) : (
      <p className={quiet}>
        {page.total > 0 ? `No sign-ins on this page: there are ${signInsLabel(page.total)}.` : isSignInFiltered(filters) ? 'No sign-in matches these filters.' : 'No sign-ins yet.'}
      </p>
    );
  } else {
    body = (
      <p className={quiet}>
        {loaded.kind === 'forbidden'
          ? NOT_ALLOWED
          : loaded.kind === 'unavailable'
            ? 'Not available yet: the server does not list the sign-ins yet.'
            : `The sign-ins could not be loaded. ${loaded.messages.join(' ')}`}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Problems problems={problems} />
      <SignInFiltersForm filters={filters} options={choices} />
      <section aria-labelledby="sign-ins-entries" className="card">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 id="sign-ins-entries" className="font-semibold">
              Sign-ins
            </h2>
            <p className="text-xs text-muted">
              {loaded.kind === 'ok' ? signInsLabel(loaded.value.total) : 'Not loaded'}
              {described && ` · ${described}`}
            </p>
          </div>
          <div className="text-right">
            {/* a plain link, never prefetched: the API makes the workbook on each download, and logs it */}
            <a href={signInsExcelHref(filters)} className="btn btn-secondary">
              Export to Excel
            </a>
            <p className="hint">The newest 10,000 sign-ins with these filters.</p>
          </div>
        </div>
        {body}
      </section>
      <p className="text-xs text-muted">
        Sign-ins from before 31 October 2026 show the address and browser their session was opened with, when known, and no location. An address inside the
        server’s own network shows as a dash.
      </p>
    </div>
  );
}

async function Activity({ query, profileLink }: { query: Query; profileLink: boolean }) {
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
      <Problems problems={problems} />
      <Filters filters={filters} options={choices} />
      {options.kind !== 'ok' && <p className="text-sm text-muted">The lists of users, actions and employees could not be loaded: the filters already in the address still apply.</p>}
      <PersonHeading filters={filters} options={choices} profileLink={profileLink} />
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
          <h1 className="page-title">Audit Log</h1>
          <p className="mt-1 text-muted">
            Who changed what and when, in every part of the system, newest first, with what was refused and where each came from. Restricted values, such as
            national IDs, bank accounts and pay, show only that they changed.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <Log searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
