import Link from 'next/link';
import { Suspense } from 'react';
import { isOpenReimbursement, LABELS } from '@trendlix/shared';
import { decidesForTeam, MY_REQUESTS, MY_TEAM } from '@/components/nav';
import { departmentName } from '@/lib/departments';
import { formatDate, formatDateTime } from '@/lib/format';
import { hasRole } from '@/lib/roles';
import { shiftTimesText } from '@/lib/shifts';
import type { EmployeeProfile, Holiday } from '@/lib/types';
import type { Session } from '@/lib/view-as';
import { getOrNull } from '../approvals/data';
import { ChangeRequestStatusBadge } from '../employees/[id]/change-request/request-parts';
import { daysBetween, termLabel } from '../employees/[id]/contracts/dates';
import { arrangementLabel, employeeRaiseRequestsHref, seesEveryone, StatusBadge, todayInCairo } from '../employees/ui';
import { myRequests, requestLabel } from '../my-requests/requests';
import { loadTeam } from '../my-team/data';
import { askedByText, probationOf, raiseNews } from '../my-team/team';
import { loadOwnProfile } from '../own-profile';
import { loadLeaveTypes, loadMyBalances, loadMyLeave, loadWaitingLeave } from '../leave/data';
import { daysText, leaveHref, leaveWhenText, MY_LEAVE_HREF, NEW_LEAVE_PATH, periodText, requestsLabel, upcomingLeave } from '../leave/list';
import { LeaveBalanceFigures, LeaveStatusBadge } from '../leave/ui';
import { loadEmployeeRaiseRequests } from '../raise-requests/data';
import { effectiveFromText, newRaiseRequestHref, progressText } from '../raise-requests/list';
import { EffectiveFrom, FoldedRequestLog, RaiseRequestStatusBadge, RequestReason, Suggestion } from '../raise-requests/ui';
import { loadMyClaims, loadWaitingClaims } from '../reimbursements/data';
import { claimHref, claimsLabel, NEW_CLAIM_PATH, progressText as claimProgressText } from '../reimbursements/list';
import { ClaimAmount, ClaimStatusBadge } from '../reimbursements/ui';
import { greetingName, holidayWhen, holidayYears, inDaysText, serviceLength, toDoItems, upcomingHolidays, workingDaysText } from './dashboard';

// The employee's dashboard: the home page (/) of someone who is only an employee and/or a direct manager (owner, 17
// October 2026: "create a dashboard for the employee relevant to his role, and dont show him the organization tab, the
// dashboard may contain the data he might need such as Holidays"). A few cards, each with what they need and a way on:
// Your Job (their job, shift and contract term, no salary), Upcoming Holidays (the official holidays, Organization →
// Holidays), My Requests (the open ones, and asking for a raise or a change to their details), To Do (confirming their
// details, the papers HR still needs) and, for a manager, My Team (their direct reports, a probation ending soon and the
// raise requests they are told about). Everything is read as the employee may see it: the API decides, as everywhere.
// The cards that need more than the profile load on their own. Reimbursements (owner, 18 October 2026): their open
// claims on My Requests with New reimbursement, and for a manager with claims waiting, Reimbursements to Approve. Leave
// (owner, 18 October 2026: "can you apply the leaves according to the law?"): My Leave, their annual balance and their
// leave coming up, with New leave; for a manager with requests waiting, Leave to Approve.

const dash = <span className="text-muted">—</span>;
const small = 'btn min-h-9 px-3';

function Card({ title, action, wide = false, children }: { title: string; action?: React.ReactNode; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={`card p-5 ${wide ? 'lg:col-span-2' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

function CardLoading({ title, wide }: { title: string; wide?: boolean }) {
  return (
    <Card title={title} wide={wide}>
      <Quiet>Loading…</Quiet>
    </Card>
  );
}

/** One fact of a card: its label on the left (above it on a phone), its value. */
function Fact({ label, note, children }: { label: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2.5 sm:grid-cols-[9.5rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium text-muted sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-sm break-words">
        {children}
        {note && <span className="mt-0.5 block text-xs text-muted">{note}</span>}
      </dd>
    </div>
  );
}

const SOON = 'badge ml-1.5 bg-warn-soft text-warn';

/** How far off a contract's end is worth saying: within this many days. */
const CONTRACT_END_NOTE_DAYS = 90;

// ---------- Your Job ----------

/**
 * Who they are and their job: the job title, the department › team, the direct manager (a link only for those who can
 * open the manager's profile), the join date with the length of service, the shift with its hours and working days,
 * the status, the probation end while on probation, and the contract's term (no salary: the API sends the employee
 * none).
 */
function YourJob({ profile: p, user, today }: { profile: EmployeeProfile; user: Session; today: string }) {
  const e = p.employment;
  const service = e && serviceLength(e.joinDate, today);
  const probation = probationOf(e, today);
  const days = e?.shift?.workingDays;
  const contract = e?.contract;
  const contractEnds = contract?.endDate ? daysBetween(today, contract.endDate) : null;
  const manager = e?.manager && (seesEveryone(user) ? <Link href={`/employees/${e.manager.id}`}>{e.manager.fullNameEn}</Link> : e.manager.fullNameEn);
  return (
    <Card
      title="Your Job"
      action={
        <Link href={`/employees/${p.id}`} className="text-sm">
          Open my profile
        </Link>
      }
    >
      <dl className="divide-y divide-line-soft">
        <Fact label="Name" note={<span className="tabular-nums">{p.employeeCode}</span>}>
          <span className="font-medium">{p.fullNameEn}</span>{' '}
          <span lang="ar" dir="rtl" className="inline-block text-muted">
            {p.fullNameAr}
          </span>
        </Fact>
        {e ? (
          <>
            <Fact label="Job title" note={LABELS.employmentType[e.employmentType]}>
              {e.jobTitle?.titleEn ?? dash}
            </Fact>
            <Fact label={e.department?.parent ? 'Department › team' : 'Department'}>{e.department ? departmentName(e.department) : dash}</Fact>
            <Fact label="Direct manager">{manager || dash}</Fact>
            <Fact label="Joined" note={service}>
              <span className="tabular-nums">{formatDate(e.joinDate)}</span>
            </Fact>
            <Fact label="Shift" note={arrangementLabel(e)}>
              {e.shift ? `${shiftTimesText(e.shift)}${days?.length ? ` · ${workingDaysText(days)}` : ''}` : dash}
            </Fact>
            <Fact label="Status">
              <StatusBadge status={e.status} />
            </Fact>
            {probation && (
              <Fact label="Probation ends">
                <span className="tabular-nums">{formatDate(probation.end)}</span>
                {probation.soon && <span className={SOON}>{inDaysText(probation.days)}</span>}
              </Fact>
            )}
            {contract !== undefined && (
              <Fact label="Contract">
                {contract ? (
                  <>
                    <span className="tabular-nums">{termLabel(contract)}</span>
                    {contractEnds !== null && contractEnds >= 0 && contractEnds <= CONTRACT_END_NOTE_DAYS && (
                      <span className={SOON}>Ends {inDaysText(contractEnds).toLowerCase()}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted">No signed contract yet</span>
                )}
              </Fact>
            )}
          </>
        ) : (
          <Fact label="Job">
            <span className="text-muted">No current employment on file.</span>
          </Fact>
        )}
      </dl>
    </Card>
  );
}

// ---------- Upcoming Holidays ----------

/**
 * The next official holidays (Organization → Holidays), soonest first: this year's, and next year's too near the end
 * of the year; each with its day and weekday, its name in English and in Arabic when given, and how far off it is.
 */
async function UpcomingHolidays({ today }: { today: string }) {
  const years = holidayYears(today);
  const lists = await Promise.all(years.map((y) => getOrNull<Holiday[]>(`/payroll/holidays?year=${y}`)));
  if (lists[0] === null) {
    return (
      <Card title="Upcoming Holidays">
        <Quiet>The holidays couldn&apos;t be loaded. Please try again in a moment.</Quiet>
      </Card>
    );
  }
  const next = upcomingHolidays(lists.flatMap((l) => l ?? []), today);
  return (
    <Card title="Upcoming Holidays">
      {next.length === 0 ? (
        <Quiet>No more official holidays on file for {years.join(' or ')} yet.</Quiet>
      ) : (
        <ul className="divide-y divide-line-soft">
          {next.map((h) => (
            <li key={h.from} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{h.nameEn}</p>
                {h.nameAr && (
                  <span lang="ar" dir="rtl" className="inline-block text-muted">
                    {h.nameAr}
                  </span>
                )}
              </div>
              <div className="text-right">
                <p className="tabular-nums">{holidayWhen(h)}</p>
                <p className="mt-1">
                  {h.days > 1 && <span className="mr-1.5 text-xs text-muted">{h.days} days</span>}
                  <span className={`badge ${h.inDays <= 7 ? 'bg-warn-soft text-warn' : ''}`}>{inDaysText(h.inDays)}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- My Requests ----------

/**
 * Their open requests, each with where it stands (the changes to their details they asked HR for, and the raises they
 * asked for, as the API shows them to the employee: the reason from the list, the raise suggested and the log, 17
 * October 2026; the month it is asked from too), and ways to ask: Request a raise (the request form under Requests →
 * Raise Requests for themself, when they may ask now: "i think raising a request should be moved from the Employee tab
 * to the raise requests tab", 17 October 2026) and Ask to change my details (the change request page).
 */
async function MyRequestsCard({ profile: p }: { profile: EmployeeProfile }) {
  const [raises, claims] = await Promise.all([loadEmployeeRaiseRequests(p.id), loadMyClaims()]);
  const own = raises.kind === 'ok' ? raises.value : null;
  const open = myRequests({ changes: p.changeRequests ?? [], raises: own?.requests ?? [] }).filter((r) => r.open);
  // their reimbursement claims still being decided (18 October 2026); none from an API from before them
  const openClaims = claims.kind === 'ok' ? claims.value.filter((c) => isOpenReimbursement(c.status)) : [];
  return (
    <Card
      title="My Requests"
      action={
        <Link href={MY_REQUESTS} className="text-sm">
          See all
        </Link>
      }
    >
      {open.length === 0 && openClaims.length === 0 ? (
        <Quiet>No open requests.</Quiet>
      ) : (
        <ul className="divide-y divide-line-soft">
          {openClaims.map((c) => (
            <li key={`claim:${c.id}`} className="space-y-1 py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <Link href={claimHref(c.id)} className="font-medium">
                    {c.type.nameEn} reimbursement
                  </Link>
                  <p className="text-xs text-muted">Sent {formatDateTime(c.createdAt)}</p>
                </div>
                <ClaimStatusBadge status={c.status} />
              </div>
              <p className="text-xs text-muted">
                <ClaimAmount claim={c} /> · {claimProgressText(c).text}
              </p>
            </li>
          ))}
          {open.map((r) => (
            <li key={`${r.kind}:${r.id}`} className="space-y-1.5 py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <p className="font-medium">{requestLabel(r)}</p>
                  <p className="text-xs text-muted">Sent {formatDateTime(r.at)}</p>
                </div>
                {r.kind === 'details' ? <ChangeRequestStatusBadge status={r.request.status} /> : <RaiseRequestStatusBadge status={r.request.status} />}
              </div>
              {/* a raise: the reason from the list and the comment, the raise suggested, and its log (17 October 2026) */}
              {r.kind !== 'details' && (
                <>
                  <div className="text-xs">
                    <RequestReason request={r.request} />
                  </div>
                  <p className="text-xs text-muted">
                    Effective from <EffectiveFrom request={r.request} />
                  </p>
                  {(r.request.suggestion || r.request.suggestedGross !== null) && (
                    <p className="text-xs text-muted">
                      Suggested: <Suggestion request={r.request} />
                    </p>
                  )}
                  <FoldedRequestLog request={r.request} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {raises.kind === 'failed' && <p className="mt-2 text-xs text-muted">Your raise requests couldn&apos;t be loaded.</p>}
      {claims.kind === 'failed' && <p className="mt-2 text-xs text-muted">Your reimbursement claims couldn&apos;t be loaded.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {own?.canRequest && (
          <Link href={newRaiseRequestHref(p.id)} className={`${small} btn-primary`}>
            Request a raise
          </Link>
        )}
        {claims.kind !== 'unavailable' && (
          <Link href={NEW_CLAIM_PATH} className={`${small} btn-secondary`}>
            New reimbursement
          </Link>
        )}
        <Link href={`/employees/${p.id}/change-request`} className={`${small} btn-secondary`}>
          Ask to change my details
        </Link>
      </div>
    </Card>
  );
}

// ---------- Reimbursements to Approve (a manager) ----------

/**
 * The claims waiting for the manager, the first to decide them (18 October 2026): who, the type and the amount, each
 * opening its page with the decision form. Only when some are waiting; My Team lists them too.
 */
async function ToApproveCard() {
  const claims = await loadWaitingClaims();
  if (claims.kind !== 'ok' || claims.value.length === 0) return null;
  return (
    <Card
      title="Reimbursements to Approve"
      action={
        <Link href={MY_TEAM} className="text-sm">
          Open My Team
        </Link>
      }
    >
      <ul className="divide-y divide-line-soft">
        {claims.value.map((c) => (
          <li key={c.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 py-2.5 text-sm first:pt-0">
            <div className="min-w-0">
              <p className="font-medium">{c.employee.fullNameEn}</p>
              <p className="text-xs text-muted">
                {c.type.nameEn} · <span className="tabular-nums">{formatDate(c.expenseDate)}</span> · <ClaimAmount claim={c} />
              </p>
            </div>
            <Link href={claimHref(c.id)} className={`${small} btn-primary`}>
              Decide<span className="sr-only"> on the {c.type.nameEn} claim by {c.employee.fullNameEn}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">{claimsLabel(claims.value.length)} waiting for you</p>
    </Card>
  );
}

// ---------- My Leave ----------

/**
 * Their annual balance of this year (the days available, large, and the entitlement, taken, booked and waiting) and their
 * leave coming up or under way (approved, or being decided), each opening its page; New leave. Nothing from an API from
 * before leave.
 */
async function MyLeaveCard({ profile: p, today }: { profile: EmployeeProfile; today: string }) {
  const year = Number(today.slice(0, 4));
  const [balances, requests, types] = await Promise.all([loadMyBalances(year), loadMyLeave(), loadLeaveTypes()]);
  if (balances.kind === 'unavailable' && requests.kind === 'unavailable') return null;
  const upcoming = requests.kind === 'ok' ? upcomingLeave(requests.value, today) : [];
  return (
    <Card
      title="My Leave"
      action={
        <Link href={MY_LEAVE_HREF} className="text-sm">
          See all
        </Link>
      }
    >
      {balances.kind === 'ok' ? (
        <LeaveBalanceFigures balances={balances.value} types={types.kind === 'ok' ? types.value : null} compact />
      ) : (
        <Quiet>Your leave balance couldn&apos;t be loaded.</Quiet>
      )}
      <h3 className="mt-5 text-sm font-semibold">Coming Up</h3>
      {upcoming.length === 0 ? (
        <p className="mt-1 text-sm text-muted">No leave coming up.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line-soft">
          {upcoming.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5 text-sm">
              <div className="min-w-0">
                <Link href={leaveHref(r.id)} className="font-medium">
                  {r.type.nameEn}
                </Link>
                <p className="text-xs text-muted tabular-nums">
                  {periodText(r)} · {daysText(r.days)}
                </p>
              </div>
              <div className="text-right">
                <LeaveStatusBadge status={r.status} />
                <p className="mt-1 text-xs text-muted">{leaveWhenText(r, today)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {p.employment && (
        <div className="mt-4">
          <Link href={NEW_LEAVE_PATH} className={`${small} btn-primary`}>
            New leave
          </Link>
        </div>
      )}
    </Card>
  );
}

/** The leave requests waiting for the manager, the first to decide them: who, the type and when, each with Decide. Only when some are. */
async function LeaveToApproveCard() {
  const requests = await loadWaitingLeave();
  if (requests.kind !== 'ok' || requests.value.length === 0) return null;
  return (
    <Card
      title="Leave to Approve"
      action={
        <Link href={MY_TEAM} className="text-sm">
          Open My Team
        </Link>
      }
    >
      <ul className="divide-y divide-line-soft">
        {requests.value.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 py-2.5 text-sm first:pt-0">
            <div className="min-w-0">
              <p className="font-medium">{r.employee.fullNameEn}</p>
              <p className="text-xs text-muted">
                {r.type.nameEn} · <span className="tabular-nums">{periodText(r)}</span> · {daysText(r.days)}
              </p>
            </div>
            <Link href={leaveHref(r.id)} className={`${small} btn-primary`}>
              Decide<span className="sr-only"> on the {r.type.nameEn} request by {r.employee.fullNameEn}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">{requestsLabel(requests.value.length)} waiting for you</p>
    </Card>
  );
}

// ---------- To Do ----------

/** What is left for them to do, only what applies; a friendly line when nothing is. */
function ToDoCard({ profile: p }: { profile: EmployeeProfile }) {
  const items = toDoItems(p);
  return (
    <Card title="To Do">
      {items.length === 0 ? (
        <p className="text-sm text-ok">Nothing to do. You&apos;re all set.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {items.map((item) =>
            item.key === 'confirm' ? (
              <li key={item.key} className="space-y-2 py-2.5 text-sm first:pt-0">
                <p className="font-medium">{item.text}</p>
                <Link href={`/employees/${p.id}/confirm`} className={`${small} btn-primary`}>
                  Review and confirm
                </Link>
              </li>
            ) : (
              <li key={item.key} className="space-y-1.5 py-2.5 text-sm first:pt-0">
                <p className="font-medium">HR still needs these papers from you:</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {item.papers.map((paper) => (
                    <li key={paper}>{paper}</li>
                  ))}
                </ul>
                <p className="text-xs text-muted">Bring them to HR, who add them to your file.</p>
              </li>
            ),
          )}
        </ul>
      )}
    </Card>
  );
}

// ---------- My Team (a manager) ----------

/**
 * A manager's direct reports, each linked to their profile, with their job title and status and a probation ending
 * soon; and the raise requests the manager is told about (open, or decided lately), never a figure.
 */
async function MyTeamCard({ profile, user, today }: { profile: EmployeeProfile; user: Session; today: string }) {
  const team = await loadTeam(profile);
  const news = team
    .flatMap((m) => (m.raises.kind === 'ok' ? raiseNews(m.raises.value.requests, today) : []))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return (
    <Card
      title="My Team"
      wide
      action={
        <Link href={MY_TEAM} className="text-sm">
          Open My Team
        </Link>
      }
    >
      {team.length === 0 ? (
        <Quiet>No one reports to you at the moment.</Quiet>
      ) : (
        <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
          <ul className="divide-y divide-line-soft">
            {team.map(({ report: r, profile: theirs }) => {
              const probation = probationOf(theirs?.employment, today);
              return (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5 text-sm first:pt-0">
                  <div className="min-w-0">
                    <Link href={`/employees/${r.id}`} className="font-semibold">
                      {r.fullNameEn}
                    </Link>
                    <p className="text-xs text-muted">{r.jobTitle?.titleEn ?? 'No job title yet'}</p>
                    {probation?.soon && (
                      <p className="mt-0.5 text-xs font-medium text-warn">
                        Probation ends <span className="tabular-nums">{formatDate(probation.end)}</span> · {inDaysText(probation.days).toLowerCase()}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={r.status} />
                </li>
              );
            })}
          </ul>
          <div>
            <h3 className="text-sm font-semibold">Raise Requests</h3>
            {news.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No raise requests to tell you about.</p>
            ) : (
              <ul className="mt-1 divide-y divide-line-soft">
                {news.map((r) => (
                  <li key={r.id} className="space-y-0.5 py-2.5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={employeeRaiseRequestsHref(r.employee.id)} className="font-medium">
                        {r.employee.fullNameEn}
                      </Link>
                      <RaiseRequestStatusBadge status={r.status} />
                    </div>
                    <p className="text-xs text-muted">
                      Asked by {askedByText(r, user.email)} on <span className="tabular-nums">{formatDate(r.createdAt)}</span> · {progressText(r).text}
                    </p>
                    {r.effectiveFrom && <p className="text-xs text-muted">Effective from {effectiveFromText(r)}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------- the dashboard ----------

/** Without a profile of their own (or when it can't be read), what to do. */
export function NoProfile({ user }: { user: Session }) {
  return (
    <div className="card px-6 py-6 text-sm text-muted">
      {user.employeeId
        ? 'Your profile couldn’t be loaded. Please try again in a moment.'
        : `No employee record uses your sign-in email (${user.email}) as its work email yet. Ask HR to add it to your profile.`}
    </div>
  );
}

export async function Dashboard({ user }: { user: Session }) {
  const profile = await loadOwnProfile(user);
  const today = todayInCairo();
  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{profile ? `Welcome, ${greetingName(profile)}` : 'Welcome'}</h1>
        <p className="mt-1 text-muted">Your job, the official holidays coming up, your leave, your requests and what is left to do.</p>
      </div>
      {!profile && <NoProfile user={user} />}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {profile && <YourJob profile={profile} user={user} today={today} />}
        <Suspense fallback={<CardLoading title="Upcoming Holidays" />}>
          <UpcomingHolidays today={today} />
        </Suspense>
        {profile && (
          <>
            {/* leave is a current employment's (the API has no balance without one) */}
            {profile.employment && (
              <Suspense fallback={<CardLoading title="My Leave" />}>
                <MyLeaveCard profile={profile} today={today} />
              </Suspense>
            )}
            <Suspense fallback={<CardLoading title="My Requests" />}>
              <MyRequestsCard profile={profile} />
            </Suspense>
            <ToDoCard profile={profile} />
          </>
        )}
        {/* what waits for a direct manager, or for a department's head or a team's lead (19 October 2026), who decides
            for its people without a direct manager; the team itself for whoever has direct reports */}
        {profile && decidesForTeam(user) && (
          <>
            <Suspense fallback={null}>
              <LeaveToApproveCard />
            </Suspense>
            <Suspense fallback={null}>
              <ToApproveCard />
            </Suspense>
            {(hasRole(user, 'manager') || profile.reports.length > 0) && (
              <Suspense fallback={<CardLoading title="My Team" wide />}>
                <MyTeamCard profile={profile} user={user} today={today} />
              </Suspense>
            )}
          </>
        )}
      </div>
    </div>
  );
}
