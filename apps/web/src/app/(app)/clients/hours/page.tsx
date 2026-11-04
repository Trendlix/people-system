import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import { hiddenPeopleNote, NO_CLIENT_LABEL, type ClientHoursGroup, type ClientHoursReport } from '@trendlix/shared';
import { todayInCairo } from '@/lib/date-picker';
import { formatDateTime } from '@/lib/format';
import { shownCode } from '@/lib/hidden';
import { getCurrentUser } from '@/lib/session';
import { FigureTiles, MonthNav } from '../../attendance/ui';
import { profileHref } from '../../employees/tab-list';
import { Empty, Loading } from '../../organization/ui';
import { loadJson } from '../../payroll/load';
import { monthName } from '../../payroll/list';
import { StaffOnly } from '../../staff-only';
import { seesClientAccounts } from '../accounts/accounts';
import { accountHref, apiClientHoursPath, clientCount, clientHoursHref, clientsText, excelHref, hoursFigure, peopleText, readMonth } from './client-hours';

// Clients → Client Hours (owner, 4 November 2026: "Full salary, hours tracked", the hours of those on timesheets kept for
// the clients; the "client reports" still to do): a month's hours logged on timesheets, by client account and, under
// each, by person, the approved hours apart from those still waiting for approval (a week not sent or rejected counts
// nothing); the lines without a client (a task alone) under "No client" at the end. The month in the address, so a view
// can be shared (this month unless asked); the Excel workbook (a summary and every line) is the API's, passed on under
// the web domain (excel/route.ts). For those who see the client accounts: HR, the CEO, Finance and a Super Admin; the API
// checks it again. A C-level person's hours only for those who see them, the others told how many aren't shown.

export const metadata: Metadata = { title: 'Client Hours · People System' };

type Query = Record<string, string | string[] | undefined>;

const NOT_ALLOWED = 'Only HR, the CEO, Finance and a Super Admin can see client hours.';
const num = 'text-right tabular-nums whitespace-nowrap';

/** A client's row: its name (opening its account) and code, how many people, the approved and waiting hours. */
function ClientRow({ group: g }: { group: ClientHoursGroup }) {
  const href = accountHref(g.client);
  const code = shownCode(g.client?.code);
  const name = g.client?.name ?? <span className="text-muted">{NO_CLIENT_LABEL}</span>;
  return (
    <tr className="bg-canvas font-semibold">
      <th scope="rowgroup" className="min-w-56 text-left tracking-normal normal-case">
        {href ? <Link href={href}>{name}</Link> : name}
        {code && <span className="ml-2 text-xs font-normal text-muted">{code}</span>}
      </th>
      <td className="text-sm font-normal text-muted">{peopleText(g.people.length)}</td>
      <td className={num}>{hoursFigure(g.approved)}</td>
      <td className={num}>{g.waiting ? hoursFigure(g.waiting) : <span className="text-muted">—</span>}</td>
    </tr>
  );
}

/** A person's hours on the client: their name (opening their profile) and code, the approved and waiting hours. */
function PersonRow({ person: p }: { person: ClientHoursGroup['people'][number] }) {
  const code = shownCode(p.employee.employeeCode);
  return (
    <tr>
      <td className="pl-8">
        <Link href={profileHref(p.employee.id)}>{p.employee.fullNameEn}</Link>
        {code && <span className="ml-2 text-xs text-muted">{code}</span>}
      </td>
      <td />
      <td className={num}>{hoursFigure(p.approved)}</td>
      <td className={num}>{p.waiting ? hoursFigure(p.waiting) : <span className="text-muted">—</span>}</td>
    </tr>
  );
}

function HoursTable({ report }: { report: ClientHoursReport }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <caption className="sr-only">Hours in {monthName(report.month)} by client and person</caption>
        <thead>
          <tr>
            <th scope="col">Client and person</th>
            <th scope="col">People</th>
            <th scope="col" className="text-right">
              Approved hours
            </th>
            <th scope="col" className="text-right">
              Waiting for approval
            </th>
          </tr>
        </thead>
        {report.groups.map((g) => (
          <Fragment key={g.client?.id ?? 'no-client'}>
            <tbody>
              <ClientRow group={g} />
              {g.people.map((p) => (
                <PersonRow key={p.employee.id} person={p} />
              ))}
            </tbody>
          </Fragment>
        ))}
        <tfoot>
          <tr className="border-t-2 border-line bg-line-soft font-semibold">
            <th scope="row" className="text-left tracking-normal normal-case">
              Total
            </th>
            <td className="text-sm font-normal">{peopleText(report.total.people)}</td>
            <td className={num}>{hoursFigure(report.total.approved)}</td>
            <td className={num}>{hoursFigure(report.total.waiting)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

async function Report({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!seesClientAccounts(user)) return <Empty>{NOT_ALLOWED}</Empty>;
  const today = todayInCairo();
  const thisMonth = today.slice(0, 7);
  const month = readMonth(query, today);
  const loaded = await loadJson<ClientHoursReport>(apiClientHoursPath(month));

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <MonthNav month={month} hrefFor={(m) => clientHoursHref(m, thisMonth)} />
      {/* a plain link, never prefetched: the API makes the workbook on each download */}
      <a href={excelHref(month)} className="btn btn-secondary">
        Download Excel
      </a>
    </div>
  );

  if (loaded.kind !== 'ok') {
    return (
      <div className="space-y-4">
        {header}
        <Empty>
          {loaded.kind === 'unavailable'
            ? 'Not available yet: the server does not have this report yet.'
            : loaded.kind === 'forbidden'
              ? NOT_ALLOWED
              : `Client hours could not be loaded. ${loaded.messages.join(' ')}`}
        </Empty>
      </div>
    );
  }

  const report = loaded.value;
  const hidden = hiddenPeopleNote(report.hiddenPeople);
  const clients = clientCount(report.groups);
  return (
    <div className="space-y-6">
      {header}
      <FigureTiles
        label={`Hours in ${monthName(report.month)}`}
        tiles={[
          { key: 'approved', label: 'Approved hours', value: hoursFigure(report.total.approved), note: 'Hours in weeks approved', tone: null },
          {
            key: 'waiting',
            label: 'Waiting for approval',
            value: hoursFigure(report.total.waiting),
            note: 'Hours in weeks sent and not yet approved',
            tone: report.total.waiting > 0 ? 'warn' : null,
          },
          { key: 'people', label: 'People', value: String(report.total.people), note: peopleText(report.total.people), tone: null },
          { key: 'clients', label: 'Clients', value: String(clients), note: clientsText(clients), tone: null },
        ]}
      />
      <section aria-labelledby="client-hours-table" className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="client-hours-table" className="font-semibold">
            By Client
          </h2>
          <span className="text-xs text-muted">As of {formatDateTime(report.generatedAt)}</span>
        </div>
        {hidden && <p className="text-sm text-muted">{hidden}</p>}
        {report.groups.length === 0 ? <Empty>No hours logged on timesheets in {monthName(report.month)}.</Empty> : <HoursTable report={report} />}
      </section>
    </div>
  );
}

export default function ClientHoursPage({ searchParams }: PageProps<'/clients/hours'>) {
  return (
    <StaffOnly>
      <div>
        <h1 className="page-title">Client Hours</h1>
        <p className="mt-1 text-sm text-muted">
          Hours logged on timesheets by those HR switched to them, by client and person. Approved hours count; hours waiting for approval are shown apart.
        </p>
        <div className="mt-6">
          <Suspense fallback={<Loading />}>
            <Report searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </StaffOnly>
  );
}
