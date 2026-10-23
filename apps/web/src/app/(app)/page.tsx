import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { API_URL, ApiError } from '@/lib/api';
import { isSelfService } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { PendingRaise } from '@/lib/raise-types';
import type { EndingSummary, ExpiringContract, LawWarningItem, ProbationEnding, SessionUser } from '@/lib/types';
import type { Session } from '@/lib/view-as';
import { decidesEndings, followsEndings, getOrNull, PENDING_ENDINGS } from './approvals/data';
import { PENDING_RAISES } from './approvals/raises';
import { ContractPerson as Person, Due, ExpiringRow } from './contracts/ending-soon';
import { byDate } from './contracts/list';
import { Dashboard } from './dashboard/cards';
import { BECAME_OPEN_ENDED, CASUAL_TOO_LONG, TRAINING_ENDED } from './employees/employment-law';
import { Loading, todayInCairo } from './employees/ui';
import { TodayCheckIn } from './my-attendance/check-in-card';

// The home page. Someone who is only an employee and/or a direct manager gets their dashboard (owner, 17 October
// 2026: "create a dashboard for the employee relevant to his role", dashboard/cards.tsx); HR, Finance, the CEO and
// Admins (a Super Admin too) keep the home page as it was: what waits for them, and the modules. Those of them with an
// employee profile check in too (owner, 19 October 2026: "Check-in through the system (phone or web with the office
// location check, or a device) to replace Zoho"): a compact Today card while they do, with the way to My Attendance.

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

// A developer gets the people's codes as "••••" and their contract and probation dates as null (owner, 23 October 2026:
// "in developer view use **** instead of IDs"): each row then reads "Employee 7K3Q" and "Ends Hidden"
// (contracts/ending-soon.tsx), sorted after the dated ones.

/**
 * A compact card: its title, a note beside it (how far ahead it looks), and its rows, or a quiet line when there are
 * none or they failed to load.
 */
function AlertCard<T>({
  title,
  note,
  rows,
  empty,
  className = '',
  children,
}: {
  title: string;
  note: string;
  rows: T[] | null;
  empty: string;
  className?: string;
  children: (rows: T[]) => React.ReactNode;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-muted">{note}</span>
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

/**
 * The CEO's count of what waits for them, linked to Approvals: the endings, and the pay raises (owner's decisions, 16
 * October 2026). Null when the endings couldn't load; raises from a server from before them count none.
 */
function WaitingForYou({ count }: { count: number | null }) {
  if (count === null) return <p className="text-sm text-muted">Approvals couldn&apos;t load.</p>;
  return (
    <p className="text-sm">
      <Link href="/approvals" className={count > 0 ? 'font-semibold' : undefined}>
        Waiting for your approval: {count}
      </Link>
    </p>
  );
}

// ---------- the labour law's warnings (HR and the CEO) ----------

/**
 * GET /contracts/law-warnings: fixed terms become open-ended, casual work past its 6 months; a trainee's or an intern's
 * agreement past its end with nothing signed after it (19 October 2026).
 */
const LAW_WARNINGS = '/contracts/law-warnings';

const WARNING_OF = { became_open_ended: BECAME_OPEN_ENDED, casual_too_long: CASUAL_TOO_LONG, training_ended: TRAINING_ENDED } as const;

/**
 * What the labour law warns HR of (owner, 18 October 2026: "can we update the employment types based on the labour
 * law?"): a signed fixed-term contract past its end while the work goes on without a signed renewal, which the law
 * counts as open-ended (Labour Law 14/2025 Art. 88(3)), and casual work past its 6 months (Art. 1(7)); since 19 October
 * 2026 a trainee's or an intern's agreement past its end with nothing signed after it (Training ended: renewed once,
 * converted to full-time or ended, never open-ended). Each opens the employee's Employment tab, where it is put right.
 */
function LawWarnings({ rows }: { rows: LawWarningItem[] }) {
  return (
    <AlertCard title="By the Labour Law" note={`${rows.length} to look at`} rows={rows} empty="" className="border-danger/30 lg:col-span-2">
      {(items) =>
        items.map((w) => (
          <li key={`${w.kind}-${w.contractId ?? w.employmentId}`} className="space-y-1 py-2.5 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Person employee={w.employee} />
              <span title={WARNING_OF[w.kind]?.detail} className="badge bg-danger-soft text-danger">
                {WARNING_OF[w.kind]?.text ?? w.kind}
              </span>
            </div>
            <p className="text-xs text-muted">{w.message}</p>
          </li>
        ))
      }
    </AlertCard>
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
  const [contracts, probations, pending, raises, warnings] = await Promise.all([
    getOrNull<ExpiringContract[]>(`/contracts/expiring?within=${CONTRACTS_WITHIN}`),
    getOrNull<ProbationEnding[]>(`/employments/probation-ending?within=${PROBATION_WITHIN}`),
    ceo ? getOrNull<EndingSummary[]>(PENDING_ENDINGS) : null,
    ceo ? getOrNull<PendingRaise[]>(PENDING_RAISES) : null,
    // by the labour law (18 October 2026); an API from before it answers 404, and nothing shows
    getOrNull<LawWarningItem[]>(LAW_WARNINGS),
  ]);
  const today = todayInCairo();

  return (
    <div className="mt-6 space-y-3">
      {ceo && <WaitingForYou count={pending && pending.length + (raises?.length ?? 0)} />}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* only while there is something to do: the law's warnings first, across the row */}
        {warnings && warnings.length > 0 && <LawWarnings rows={warnings} />}
        <AlertCard
          title="Contracts Ending Soon"
          note={`Next ${CONTRACTS_WITHIN} days`}
          rows={byDate(contracts, (c) => c.endDate)}
          empty={`No contracts end in the next ${CONTRACTS_WITHIN} days.`}
        >
          {(rows) => rows.map((c) => <ExpiringRow key={c.id} contract={c} today={today} />)}
        </AlertCard>
        <AlertCard
          title="Probation Ending Soon"
          note={`Next ${PROBATION_WITHIN} days`}
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

/** Today's check-in for HR, the CEO, Finance or an Admin with an employee profile, when they check in (19 October 2026). */
async function StaffCheckIn() {
  let user: SessionUser;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
  if (!user.employeeId) return null;
  return <TodayCheckIn home className="mt-6 max-w-xl" />;
}

function StaffHome() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Welcome</h1>
      <p className="mt-1 text-muted">TrendLIX People System. Modules go live one at a time.</p>

      <Suspense fallback={null}>
        <StaffCheckIn />
      </Suspense>

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

async function Home() {
  // Like the sidebar: an API outage must not take the home page down; it shows the home page, whose server status says so.
  let user: Session | null = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  return user && isSelfService(user) ? <Dashboard user={user} /> : <StaffHome />;
}

export default function HomePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Home />
    </Suspense>
  );
}
