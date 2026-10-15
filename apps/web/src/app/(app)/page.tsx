import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { API_URL, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { EndingSummary, ExpiringContract, ProbationEnding, SessionUser } from '@/lib/types';
import { decidesEndings, followsEndings, getOrNull, PENDING_ENDINGS } from './approvals/data';
import { profileHref, todayInCairo } from './employees/ui';
import { dueNote } from './organization/contracts/labels';

const MODULES = [
  { title: 'Organization', text: 'Company profile, departments and their teams, job titles with their grade ranges and job descriptions, grades, shifts.', href: '/organization/company' },
  { title: 'Employees', text: 'Directory and employee profiles.', href: '/employees' },
  { title: 'Contracts', text: 'Contract versions, probation, renewals, and endings approved by HR and the CEO.', href: '/contracts' },
];

async function SystemStatus() {
  await connection();
  let ok = false;
  try {
    ok = (await fetch(`${API_URL}/api/health`)).ok;
  } catch {
    ok = false;
  }
  return ok ? (
    <span className="text-ok">Server and database connected</span>
  ) : (
    <span className="text-danger">Server not reachable</span>
  );
}

// ---------- contracts and probation ending soon (HR and the CEO) ----------

/** How far ahead each card looks, in days. */
// 90 days: the non-renewal notice is due 45 working days (about 9 weeks) before a contract ends, so it shows in time
const CONTRACTS_WITHIN = 90;
const PROBATION_WITHIN = 30;

const TONE = { passed: 'text-danger', soon: 'text-warn' } as const;
const NOTE_BADGE = { passed: 'bg-danger-soft text-danger', soon: 'bg-warn-soft text-warn' } as const;

/** A date, highlighted with a word ("Passed", "In 3 days") when it has passed or is within a week. */
function Due({ date, today }: { date: string; today: string }) {
  const note = dueNote(date, today);
  return (
    <>
      <span className={`tabular-nums ${note ? `font-semibold ${TONE[note.tone]}` : ''}`}>{formatDate(date)}</span>
      {note && <span className={`badge ml-1.5 ${NOTE_BADGE[note.tone]}`}>{note.text}</span>}
    </>
  );
}

function Person({ employee }: { employee: { id: string; employeeCode: string; fullNameEn: string } }) {
  return (
    <Link href={profileHref(employee.id, 'employment')} className="font-medium">
      {employee.fullNameEn}
      <span className="font-normal text-muted"> · {employee.employeeCode}</span>
    </Link>
  );
}

/** A compact card: its title, how far ahead it looks, and its rows, or a quiet line when there are none or they failed to load. */
function AlertCard<T>({
  title,
  days,
  rows,
  empty,
  children,
}: {
  title: string;
  days: number;
  rows: T[] | null;
  empty: string;
  children: (rows: T[]) => React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-muted">Next {days} days</span>
      </div>
      {rows === null ? (
        <p className="mt-3 text-sm text-muted">Couldn&apos;t load.</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line-soft">{children(rows)}</ul>
      )}
    </section>
  );
}

/** The CEO's count of endings waiting for them, linked to Approvals. */
function WaitingForYou({ pending }: { pending: EndingSummary[] | null }) {
  if (pending === null) return <p className="text-sm text-muted">Approvals couldn&apos;t load.</p>;
  return (
    <p className="text-sm">
      <Link href="/approvals" className={pending.length > 0 ? 'font-semibold' : undefined}>
        Waiting for your approval: {pending.length}
      </Link>
    </p>
  );
}

async function ContractAlerts() {
  // Like the sidebar: an API outage must not take the home page down (the server status below says so).
  let user: SessionUser;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
  if (!followsEndings(user)) return null;
  const ceo = decidesEndings(user);
  const [contracts, probations, pending] = await Promise.all([
    getOrNull<ExpiringContract[]>(`/contracts/expiring?within=${CONTRACTS_WITHIN}`),
    getOrNull<ProbationEnding[]>(`/employments/probation-ending?within=${PROBATION_WITHIN}`),
    ceo ? getOrNull<EndingSummary[]>(PENDING_ENDINGS) : null,
  ]);
  const today = todayInCairo();
  const byDate = <T,>(rows: T[] | null, date: (row: T) => string) => rows && [...rows].sort((a, b) => date(a).localeCompare(date(b)));

  return (
    <div className="mt-6 space-y-3">
      {ceo && <WaitingForYou pending={pending} />}
      <div className="grid gap-3 lg:grid-cols-2">
        <AlertCard
          title="Contracts Ending Soon"
          days={CONTRACTS_WITHIN}
          rows={byDate(contracts, (c) => c.endDate)}
          empty={`No contracts end in the next ${CONTRACTS_WITHIN} days.`}
        >
          {(rows) =>
            rows.map((c) => (
              <li key={c.id} className="space-y-1 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <Person employee={c.employee} />
                  <span>
                    Ends <Due date={c.endDate} today={today} />
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
                  <span>
                    Non-renewal notice by <Due date={c.nonRenewalNoticeBy} today={today} />
                  </span>
                  {c.renewalDraft && <span className="badge">Renewal drafted</span>}
                </div>
              </li>
            ))
          }
        </AlertCard>
        <AlertCard
          title="Probation Ending Soon"
          days={PROBATION_WITHIN}
          rows={byDate(probations, (p) => p.probationEnd)}
          empty={`No probation ends in the next ${PROBATION_WITHIN} days.`}
        >
          {(rows) =>
            rows.map((p) => (
              <li key={p.employmentId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5 text-sm">
                <Person employee={p.employee} />
                <span>
                  Ends <Due date={p.probationEnd} today={today} />
                </span>
              </li>
            ))
          }
        </AlertCard>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Welcome</h1>
      <p className="mt-1 text-muted">TrendLIX People System. Modules go live one at a time.</p>

      <Suspense fallback={null}>
        <ContractAlerts />
      </Suspense>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m) =>
          m.href ? (
            <Link key={m.title} href={m.href} className="card block p-5 text-ink no-underline hover:border-accent">
              <span className="badge">Live</span>
              <h2 className="mt-3 font-semibold">{m.title}</h2>
              <p className="mt-1 text-sm text-muted">{m.text}</p>
            </Link>
          ) : (
            <div key={m.title} className="card p-5 opacity-70">
              <span className="badge bg-line-soft text-muted">Coming next</span>
              <h2 className="mt-3 font-semibold">{m.title}</h2>
              <p className="mt-1 text-sm text-muted">{m.text}</p>
            </div>
          ),
        )}
      </div>

      <p className="mt-8 text-sm">
        <Suspense fallback={<span className="text-muted">Checking server…</span>}>
          <SystemStatus />
        </Suspense>
      </p>
    </div>
  );
}
