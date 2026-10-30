import { ArrowUpRight, CalendarDays, CalendarHeart, Clock, FileText } from 'lucide-react';
import Link from 'next/link';
import { cache, Suspense } from 'react';
import { isOpenLeave, isOpenReimbursement, LABELS, seesRaiseRequests } from '@trendlix/shared';
import { PageHead, PanelHead, Pill, StatTile } from '@/components/design';
import { Shown } from '@/components/hidden';
import { decidesForTeam, MY_REQUESTS, MY_TEAM } from '@/components/nav';
import { departmentName } from '@/lib/departments';
import { formatDate, formatDateTime } from '@/lib/format';
import { employmentHidden, labelOf, shownCode } from '@/lib/hidden';
import { hasRole } from '@/lib/roles';
import { shiftTimesText } from '@/lib/shifts';
import { standingInBannerText } from '@/lib/stand-in';
import type { AnnualLeaveBalance, EmployeeProfile, Holiday } from '@/lib/types';
import type { Session } from '@/lib/view-as';
import { getOrNull } from '../approvals/data';
import { ChangeRequestStatusBadge } from '../employees/[id]/change-request/request-parts';
import { daysBetween, termLabel } from '../employees/[id]/contracts/dates';
import { arrangementLabel, employeeRaiseRequestsHref, reportStanding, seesEveryone, StandingBadge, StatusBadge, todayInCairo } from '../employees/ui';
import { myRequests, requestLabel } from '../my-requests/requests';
import { COVERING_HREF, coveringToCome } from '../my-requests/covering';
import { loadMyCovering } from '../my-requests/covering-data';
import { CoveringList } from '../my-requests/covering-list';
import { loadTeam } from '../my-team/data';
import { askedByText, probationOf, raiseNews } from '../my-team/team';
import { loadOwnProfile } from '../own-profile';
import { loadMyBalances, loadMyLeave, loadMyPermissions, loadWaitingLeave, loadWaitingPermissions } from '../leave/data';
import { daysText, leaveHref, leaveWhenText, MY_LEAVE_HREF, NEW_LEAVE_PATH, periodText, requestsLabel, upcomingLeave } from '../leave/list';
import { isPermission, mergeRequests, permissionDayText, permissionHoursLine, permissionHref, permissionInDaysText, permissionWhenText, requestHref, upcomingPermissions } from '../leave/permissions';
import { LeaveStatusBadge } from '../leave/ui';
import { loadEmployeeRaiseRequests } from '../raise-requests/data';
import { effectiveFromText, newRaiseRequestHref, progressText } from '../raise-requests/list';
import { EffectiveFrom, FoldedRequestLog, RaiseRequestStatusBadge, RequestReason, Suggestion } from '../raise-requests/ui';
import { loadMyClaims, loadWaitingClaims } from '../reimbursements/data';
import { correctionDayText, correctionHref, correctionKindName } from '../attendance/corrections/corrections';
import { loadMyCorrections } from '../attendance/corrections/data';
import { claimHref, claimsLabel, NEW_CLAIM_PATH, progressText as claimProgressText } from '../reimbursements/list';
import { ClaimAmount, ClaimStatusBadge } from '../reimbursements/ui';
import { TodayCheckIn, TodayCheckInButton } from '../my-attendance/check-in-card';
import { loadMine } from '../attendance/data';
import {
  cairoHour,
  dayEyebrow,
  greetingAt,
  greetingName,
  holidayWhen,
  holidayYears,
  hoursAndMinutes,
  hoursFigure,
  hoursOn,
  inDaysText,
  monthsOf,
  serviceLength,
  shortDay,
  toDoItems,
  upcomingHolidays,
  weekOf,
  weeklyChange,
  workingDaysText,
} from './dashboard';

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
// leave coming up, with New leave; for a manager with requests waiting, Leave to Approve, with the permission requests
// waiting too (owner, 19 October 2026: permission "In the system, like leave"); My Leave lists their approved permission
// coming up too (owner, 19 October 2026: "upcoming permissions on the employee dashboard"). Today, first (owner, 19
// October 2026: "Check-in through the system (phone or web with the office location check, or a device) to replace
// Zoho"): Check in / Check out with today's punches, for someone with a current employment (my-attendance/
// check-in-card.tsx). Raises (owner, 20 October 2026: "raises not to be visible to employee level for now", then "Hide
// from managers too"): to someone who doesn't see raise requests (seesRaiseRequests, packages/shared raises.ts) none of
// them, not read: no raise on My Requests nor Request a raise, and My Team without its Raise Requests news. Leave
// coverage (owner, 25 October 2026: "Required over 2 days", "To a stand-in", "Names, no leave types"): I'm Covering, the
// colleagues' leave they were named to cover (whom, the days, approved or waiting, the handover note; never its type),
// only when there is some; and while they stand in for an approver on leave, a line saying for whom and until when, the
// team's requests coming to them (the approval cards below show them, as `leads` is true meanwhile).

const dash = <span className="text-muted">—</span>;
const small = 'btn min-h-9 px-3';

// The owner's design (Figma, 30 October 2026): each card a panel with the small capitals over its title (`eyebrow`),
// in a grid of three columns on a computer; `wide` takes two of them, `full` all three.
function Card({
  title,
  eyebrow,
  action,
  wide = false,
  full = false,
  children,
}: {
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
  wide?: boolean;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`card flex flex-col p-[22px] ${full ? 'lg:col-span-3' : wide ? 'lg:col-span-2' : ''}`}>
      <PanelHead eyebrow={eyebrow} title={title} aside={action} />
      <div className="mt-4 flex flex-1 flex-col">{children}</div>
    </section>
  );
}

/** A card's quiet link on its right ("See all"), underlined as the design's "View calendar". */
function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-xs whitespace-nowrap text-ink underline underline-offset-4">
      {children}
    </Link>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

function CardLoading({ title, eyebrow, wide, full }: { title: string; eyebrow?: string; wide?: boolean; full?: boolean }) {
  return (
    <Card title={title} eyebrow={eyebrow} wide={wide} full={full}>
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
    <Card title="Your Job" eyebrow="Profile" action={<CardLink href={`/employees/${p.id}`}>Open my profile</CardLink>}>
      <dl className="divide-y divide-line-soft">
        <Fact label="Name" note={shownCode(p.employeeCode) && <span className="tabular-nums">{p.employeeCode}</span>}>
          <span className="font-medium">{p.fullNameEn}</span>{' '}
          <span lang="ar" dir="rtl" className="inline-block text-muted">
            {p.fullNameAr}
          </span>
        </Fact>
        {e ? (
          <>
            {/* a developer's own job is hidden from them too (owner, 22 October 2026: "Hide per-person details") */}
            <Fact label="Job title" note={employmentHidden(e) ? undefined : labelOf(LABELS.employmentType, e.employmentType)}>
              {e.jobTitle ? <Shown text={e.jobTitle.titleEn} /> : dash}
            </Fact>
            <Fact label={employmentHidden(e) ? 'Department' : e.department?.parent ? 'Department › team' : 'Department'}>
              {e.department ? <Shown text={departmentName(e.department)} /> : dash}
            </Fact>
            <Fact label="Direct manager">{manager || dash}</Fact>
            <Fact label="Joined" note={service}>
              <span className="tabular-nums">
                <Shown text={e.joinDate ? formatDate(e.joinDate) : employmentHidden(e) ? 'Hidden' : ''} />
              </span>
            </Fact>
            <Fact label="Shift" note={arrangementLabel(e)}>
              {e.shift ? `${shiftTimesText(e.shift)}${days?.length ? ` · ${workingDaysText(days)}` : ''}` : dash}
            </Fact>
            <Fact label="Status">
              <StatusBadge status={e.status} employmentType={e.employmentType} />
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
/** The official holidays of a year, read once per page however many cards show them (the stats and the schedule). */
const holidaysOf = cache((year: number) => getOrNull<Holiday[]>(`/payroll/holidays?year=${year}`));

async function UpcomingHolidays({ today }: { today: string }) {
  const years = holidayYears(today);
  const lists = await Promise.all(years.map((y) => holidaysOf(y)));
  if (lists[0] === null) {
    return (
      <Card title="Upcoming Holidays" eyebrow="Schedule">
        <Quiet>The holidays couldn&apos;t be loaded. Please try again in a moment.</Quiet>
      </Card>
    );
  }
  const next = upcomingHolidays(lists.flatMap((l) => l ?? []), today);
  // the design's schedule: the date on the left, a dot on a line, the holiday, how far off it is
  return (
    <Card title="Upcoming Holidays" eyebrow="Schedule">
      {next.length === 0 ? (
        <Quiet>No more official holidays on file for {years.join(' or ')} yet.</Quiet>
      ) : (
        <ol>
          {next.map((h, i) => (
            <li key={h.from} className="grid grid-cols-[4.5rem_1rem_1fr] gap-x-3 text-sm">
              <p className="pt-0.5 text-xs text-muted tabular-nums">{holidayWhen(h)}</p>
              <span aria-hidden="true" className="flex flex-col items-center">
                <span className="mt-1 size-3 shrink-0 rounded-full border border-ink p-[2px]">
                  <span className="block size-full rounded-full bg-ink" />
                </span>
                {i < next.length - 1 && <span className="w-px flex-1 bg-line" />}
              </span>
              <div className="min-w-0 pb-4">
                <p className={`text-xs ${h.inDays <= 7 ? 'text-warn' : 'text-muted'}`}>
                  {inDaysText(h.inDays)}
                  {h.days > 1 && ` · ${h.days} days`}
                </p>
                <p className="mt-0.5">{h.nameEn}</p>
                {h.nameAr && (
                  <span lang="ar" dir="rtl" className="inline-block text-xs text-muted">
                    {h.nameAr}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
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
 * to the raise requests tab", 17 October 2026) and Ask to change my details (the change request page). The raises only
 * for someone who sees raise requests (`seesRaises`, 20 October 2026).
 */
async function MyRequestsCard({ profile: p, seesRaises }: { profile: EmployeeProfile; seesRaises: boolean }) {
  const [raises, claims, corrections] = await Promise.all([seesRaises ? loadEmployeeRaiseRequests(p.id) : null, loadMyClaims(), loadMyCorrections()]);
  const own = raises?.kind === 'ok' ? raises.value : null;
  const open = myRequests({ changes: p.changeRequests ?? [], raises: own?.requests ?? [] }).filter((r) => r.open);
  // their reimbursement claims still being decided (18 October 2026); none from an API from before them
  const openClaims = claims.kind === 'ok' ? claims.value.filter((c) => isOpenReimbursement(c.status)) : [];
  // their attendance corrections being decided (19 October 2026: "Attendance corrections with approval")
  const openCorrections = corrections.kind === 'ok' ? corrections.value.filter((c) => c.status === 'with_manager' || c.status === 'with_hr') : [];
  return (
    <Card title="My Requests" eyebrow="Requests" wide action={<CardLink href={MY_REQUESTS}>See all</CardLink>}>
      {open.length === 0 && openClaims.length === 0 && openCorrections.length === 0 ? (
        <Quiet>No open requests.</Quiet>
      ) : (
        <ul className="divide-y divide-line-soft">
          {openCorrections.map((c) => (
            <li key={`correction:${c.id}`} className="space-y-1 py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <Link href={correctionHref(c.id)} className="font-medium">
                    Attendance correction
                  </Link>
                  <p className="text-xs text-muted tabular-nums">
                    {correctionDayText(c)} · {correctionKindName(c.correctionKind)}
                  </p>
                </div>
                <LeaveStatusBadge status={c.status} confidential={c.confidential} />
              </div>
            </li>
          ))}
          {openClaims.map((c) => (
            <li key={`claim:${c.id}`} className="space-y-1 py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <Link href={claimHref(c.id)} className="font-medium">
                    {c.type.nameEn} reimbursement
                  </Link>
                  <p className="text-xs text-muted">Sent {formatDateTime(c.createdAt)}</p>
                </div>
                <ClaimStatusBadge status={c.status} confidential={c.confidential} />
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
                {/* a C-level person's waiting for HR's stage says "With the CEO" (19 October 2026) */}
                {r.kind === 'details' ? (
                  <ChangeRequestStatusBadge status={r.request.status} confidential={r.request.confidential} />
                ) : (
                  <RaiseRequestStatusBadge status={r.request.status} confidential={r.request.confidential} />
                )}
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
      {raises?.kind === 'failed' && <p className="mt-2 text-xs text-muted">Your raise requests couldn&apos;t be loaded.</p>}
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
    <Card title="Reimbursements to Approve" eyebrow="Your team" action={<CardLink href={MY_TEAM}>Open My Team</CardLink>}>
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
 * before leave. Their approved permission coming up beside it (owner, 19 October 2026: "upcoming permissions on the
 * employee dashboard"): the day, the hours and the times, each opening its page; none from an API from before
 * permission.
 */
async function MyLeaveCard({ profile: p, today }: { profile: EmployeeProfile; today: string }) {
  const year = Number(today.slice(0, 4));
  const [balances, requests, permissions] = await Promise.all([loadMyBalances(year), loadMyLeave(), loadMyPermissions()]);
  if (balances.kind === 'unavailable' && requests.kind === 'unavailable') return null;
  const upcoming = requests.kind === 'ok' ? upcomingLeave(requests.value, today) : [];
  const upcomingHours = permissions.kind === 'ok' ? upcomingPermissions(permissions.value, today) : [];
  return (
    <Card
      title="My Leave"
      eyebrow="Time off"
      action={
        <Link href={MY_LEAVE_HREF} title="See all" className="flex size-9 items-center justify-center rounded-full border border-line text-ink hover:bg-raised">
          <ArrowUpRight aria-hidden="true" className="size-4" strokeWidth={1.6} />
          <span className="sr-only">See all my leave</span>
        </Link>
      }
    >
      {balances.kind === 'ok' ? (
        // the design's (owner, 30 October 2026): the annual days available, large, and the year's days as a bar; every
        // type's figures are on My Leave, one click away
        <AnnualBar annual={balances.value.annual} />
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
                <LeaveStatusBadge status={r.status} confidential={r.confidential} />
                <p className="mt-1 text-xs text-muted">{leaveWhenText(r, today)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-5 text-sm font-semibold">Permission Coming Up</h3>
      {permissions.kind === 'failed' ? (
        <p className="mt-1 text-sm text-muted">Your permission couldn&apos;t be loaded.</p>
      ) : upcomingHours.length === 0 ? (
        <p className="mt-1 text-sm text-muted">No approved permission coming up.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line-soft">
          {upcomingHours.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5 text-sm">
              <div className="min-w-0">
                <Link href={permissionHref(r.id)} className="font-medium tabular-nums">
                  {permissionDayText(r)}
                </Link>
                <p className="text-xs text-muted tabular-nums">{permissionHoursLine(r)}</p>
              </div>
              <div className="text-right">
                <LeaveStatusBadge status={r.status} confidential={r.confidential} />
                <p className="mt-1 text-xs text-muted">{permissionInDaysText(r, today)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {p.employment && (
        <div className="mt-auto pt-5">
          <Link href={NEW_LEAVE_PATH} className="btn btn-secondary w-full">
            Request new leave
          </Link>
        </div>
      )}
    </Card>
  );
}

/**
 * The annual days available, large, and the year's days as one bar: available, taken (and booked), waiting for a
 * decision; under it the entitlement (with what was carried in and adjusted), taken and pending, as the figures say.
 */
function AnnualBar({ annual: a }: { annual: AnnualLeaveBalance }) {
  const year = a.entitlement + a.carriedIn + a.adjustments;
  const used = a.taken + a.booked;
  const total = Math.max(year, a.available + used + a.pending, 1);
  const share = (n: number) => `${Math.max(0, (n / total) * 100)}%`;
  return (
    <div>
      <p className="flex items-end gap-3">
        <span className="text-6xl leading-none font-normal tracking-[-0.07em] tabular-nums">{a.available}</span>
        <span className="pb-1 text-xs leading-tight text-muted">
          days
          <br />
          available
        </span>
      </p>
      <div aria-hidden="true" className="mt-5 flex h-1.5 gap-1 overflow-hidden rounded-full">
        <span className="rounded-full bg-ink" style={{ width: share(a.available) }} />
        <span className="rounded-full bg-muted" style={{ width: share(used) }} />
        <span className="flex-1 rounded-full bg-line-soft" />
      </div>
      <dl className="mt-2.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] text-muted">
        <div className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-ink" />
          <dt>Entitlement</dt>
          <dd className="text-ink tabular-nums">{year}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-muted" />
          <dt>Taken</dt>
          <dd className="text-ink tabular-nums">{used}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-line" />
          <dt>Pending</dt>
          <dd className="text-ink tabular-nums">{a.pending}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * The leave and permission requests waiting for the manager, the first to decide them: who, the type (Permission) and
 * when (a permission's day and hours), each with Decide. Only when some are.
 */
async function LeaveToApproveCard() {
  const [leave, permissions] = await Promise.all([loadWaitingLeave(), loadWaitingPermissions()]);
  const requests = mergeRequests(leave.kind === 'ok' ? leave.value : [], permissions.kind === 'ok' ? permissions.value : []);
  if (requests.length === 0) return null;
  return (
    <Card title="Leave to Approve" eyebrow="Your team" action={<CardLink href={MY_TEAM}>Open My Team</CardLink>}>
      <ul className="divide-y divide-line-soft">
        {requests.map((r) => (
          <li key={`${r.type.id}:${r.id}`} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 py-2.5 text-sm first:pt-0">
            <div className="min-w-0">
              <p className="font-medium">{r.employee.fullNameEn}</p>
              <p className="text-xs text-muted">
                {r.type.nameEn} ·{' '}
                {isPermission(r) ? (
                  <span className="tabular-nums">{permissionWhenText(r)}</span>
                ) : (
                  <>
                    <span className="tabular-nums">{periodText(r)}</span> · {daysText(r.days)}
                  </>
                )}
              </p>
            </div>
            <Link href={requestHref(r)} className={`${small} btn-primary`}>
              Decide<span className="sr-only"> on the {r.type.nameEn} request by {r.employee.fullNameEn}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">{requestsLabel(requests.length)} waiting for you</p>
    </Card>
  );
}

/**
 * The colleagues' leave they cover, current or to come (owner, 25 October 2026: "Required over 2 days"; GET
 * /me/leave/covering): the nearest three, each with whom, the days, approved or waiting and the handover note. Only when
 * there is some.
 */
async function CoveringCard({ today }: { today: string }) {
  const loaded = await loadMyCovering();
  if (loaded.kind !== 'ok') return null;
  const list = coveringToCome(loaded.value, today);
  if (!list.length) return null;
  return (
    <Card title="I’m Covering" eyebrow="Leave coverage" action={<CardLink href={COVERING_HREF}>Open My Requests</CardLink>}>
      <CoveringList list={list.slice(0, 3)} today={today} compact />
      {list.length > 3 && <p className="mt-2 text-xs text-muted">And {list.length - 3} more on My Requests.</p>}
    </Card>
  );
}

// ---------- To Do ----------

/**
 * What is left for them to do, only what applies; a friendly line when nothing is. The design's "Complete your profile
 * — Documents needed" (30 October 2026): the papers HR still needs as tiles, and how complete their profile is.
 */
function ToDoCard({ profile: p }: { profile: EmployeeProfile }) {
  const items = toDoItems(p);
  const papers = items.find((i) => i.key === 'papers');
  const confirm = items.find((i) => i.key === 'confirm');
  const percent = p.completeness.percent;
  return (
    <Card
      title={papers ? 'Documents needed' : 'To Do'}
      eyebrow="Complete your profile"
      full
      action={<span className="text-2xl font-normal tracking-[-0.04em] tabular-nums">{percent}%</span>}
    >
      {items.length === 0 ? (
        <p className="text-sm text-ok">Nothing to do. You&apos;re all set.</p>
      ) : (
        <div className="space-y-4">
          {confirm && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-3 text-sm">
              <p>{confirm.text}</p>
              <Link href={`/employees/${p.id}/confirm`} className={`${small} btn-primary`}>
                Review and confirm
              </Link>
            </div>
          )}
          {papers && (
            <div>
              <p className="sr-only">HR still needs these papers from you:</p>
              <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {papers.papers.map((paper) => (
                  <li key={paper} className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-3 text-sm">
                    <span aria-hidden="true" className="size-[22px] shrink-0 rounded-full border border-line" />
                    <span className="min-w-0">
                      <span className="block">{paper}</span>
                      <span className="block text-[11px] text-muted">Required by HR</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">Bring them to HR, who add them to your file.</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------- My Team (a manager) ----------

/**
 * A manager's direct reports, each linked to their profile, with their job title and status and a probation ending
 * soon; and the raise requests the manager is told about (open, or decided lately), never a figure: only to a manager
 * who sees raise requests (20 October 2026).
 */
async function MyTeamCard({ profile, user, today }: { profile: EmployeeProfile; user: Session; today: string }) {
  const team = await loadTeam(profile);
  const seesRaises = seesRaiseRequests(user);
  const news = team
    .flatMap((m) => (m.raises.kind === 'ok' ? raiseNews(m.raises.value.requests, today) : []))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return (
    <Card title="My Team" eyebrow="Your team" full action={<CardLink href={MY_TEAM}>Open My Team</CardLink>}>
      {team.length === 0 ? (
        <Quiet>No one reports to you at the moment.</Quiet>
      ) : (
        <div className={seesRaises ? 'grid gap-x-8 gap-y-4 lg:grid-cols-2' : undefined}>
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
                  <StandingBadge standing={reportStanding(r)} />
                </li>
              );
            })}
          </ul>
          {seesRaises && (
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
                        <RaiseRequestStatusBadge status={r.status} confidential={r.confidential} />
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
          )}
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

// ---------- the design's figures and the week's hours (30 October 2026) ----------

/**
 * The row of four figures over the cards: the annual leave days available, the hours counted this week (of the shift's
 * week), the requests still being decided, and the next official holiday. Each only from what the API already gives the
 * employee; a figure it can't read shows a dash.
 */
async function Stats({ profile: p, user, today }: { profile: EmployeeProfile; user: Session; today: string }) {
  const year = Number(today.slice(0, 4));
  const week = weekOf(today);
  const [balances, months, leave, permissions, claims, corrections, raises, holidays] = await Promise.all([
    p.employment ? loadMyBalances(year) : null,
    p.employment ? Promise.all(monthsOf(week).map((m) => loadMine(m))) : null,
    loadMyLeave(),
    loadMyPermissions(),
    loadMyClaims(),
    loadMyCorrections(),
    seesRaiseRequests(user) ? loadEmployeeRaiseRequests(p.id) : null,
    Promise.all(holidayYears(today).map((y) => holidaysOf(y))),
  ]);
  const annual = balances?.kind === 'ok' ? balances.value.annual : null;
  // the hours counted on the week's days so far, against the shift's hours a day on its working days
  const read = months?.filter((m) => m.kind === 'ok') ?? [];
  const hours = [...hoursOn(read.flatMap((m) => m.value.person.days), week, today).values()].reduce((a, b) => a + b, 0);
  const hoursADay = read[0]?.value.person.hoursADay ?? null;
  const working = p.employment?.shift?.workingDays?.length ?? 5;
  const target = hoursADay ? hoursADay * working : null;
  // what is still being decided: their changes and raises, claims, corrections, leave and permission
  const own = raises?.kind === 'ok' ? raises.value : null;
  const open =
    myRequests({ changes: p.changeRequests ?? [], raises: own?.requests ?? [] }).filter((r) => r.open).length +
    (claims.kind === 'ok' ? claims.value.filter((c) => isOpenReimbursement(c.status)).length : 0) +
    (corrections.kind === 'ok' ? corrections.value.filter((c) => c.status === 'with_manager' || c.status === 'with_hr').length : 0) +
    (leave.kind === 'ok' ? leave.value.filter((r) => isOpenLeave(r.status)).length : 0) +
    (permissions.kind === 'ok' ? permissions.value.filter((r) => isOpenLeave(r.status)).length : 0);
  const next = holidays[0] === null ? null : (upcomingHolidays(holidays.flatMap((l) => l ?? []), today, 1)[0] ?? null);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        icon={CalendarDays}
        label="Leave balance"
        value={annual ? annual.available : '—'}
        unit={annual ? 'days' : undefined}
        note={annual ? `of ${annual.entitlement + annual.carriedIn + annual.adjustments} this year` : undefined}
        href={MY_LEAVE_HREF}
      />
      <StatTile
        icon={Clock}
        label="Hours this week"
        value={months ? hoursFigure(hours) : '—'}
        unit={months ? 'hrs' : undefined}
        note={target ? `${Math.round((hours / target) * 100)}% of ${hoursFigure(target)}` : undefined}
        href="/my-attendance"
      />
      <StatTile icon={FileText} label="Open requests" value={String(open).padStart(2, '0')} note={open ? 'being decided' : 'none waiting'} href={MY_REQUESTS} />
      <StatTile
        icon={CalendarHeart}
        label="Next holiday"
        value={next ? (next.inDays === 0 ? 'Today' : next.inDays) : '—'}
        unit={next && next.inDays > 0 ? (next.inDays === 1 ? 'day' : 'days') : undefined}
        note={next ? <span className="line-clamp-2 max-w-[8rem]">{next.nameEn}</span> : undefined}
      />
    </div>
  );
}

function StatsLoading() {
  return (
    <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card min-h-[104px]" />
      ))}
    </div>
  );
}

/**
 * The design's "Weekly hours": a bar for each working day of this week, its hours counted (today's the strong one), the
 * average a day and the week's target, and the change from last week's hours by the same day when there were some.
 */
async function WeeklyHours({ profile: p, today }: { profile: EmployeeProfile; today: string }) {
  const week = weekOf(today);
  const last = weekOf(today, 1);
  const months = await Promise.all(monthsOf([...last, ...week]).map((m) => loadMine(m)));
  const ok = months.filter((m) => m.kind === 'ok');
  if (ok.length === 0) return null;
  const days = ok.flatMap((m) => m.value.person.days);
  const hoursADay = ok[0].value.person.hoursADay;
  const working = new Set(p.employment?.shift?.workingDays ?? [0, 1, 2, 3, 4]);
  const shown = week.filter((d) => working.has(new Date(`${d}T00:00:00Z`).getUTCDay()));
  const counted = hoursOn(days, week, today);
  const thisWeek = [...counted.values()].reduce((a, b) => a + b, 0);
  // last week up to the same weekday, so the change compares like with like
  const sameDay = last[week.indexOf(today)] ?? last[6];
  const lastWeek = [...hoursOn(days, last, sameDay).values()].reduce((a, b) => a + b, 0);
  const change = weeklyChange(thisWeek, lastWeek);
  const worked = [...counted.values()].filter((h) => h > 0);
  const average = worked.length ? worked.reduce((a, b) => a + b, 0) / worked.length : null;
  const top = Math.max(hoursADay ?? 8, ...shown.map((d) => counted.get(d) ?? 0)) * 1.1;
  // the strong bar: today, or on a day off the last working day before it (the design marks the day you're on)
  const marked = shown.filter((d) => d <= today).at(-1);
  return (
    <Card
      title="Weekly hours"
      eyebrow="Attendance"
      wide
      action={change !== null && <Pill>{`${change >= 0 ? '↗' : '↘'} ${Math.abs(change)}%`}</Pill>}
    >
      <ul className="flex min-h-44 flex-1 items-end justify-around gap-3 border-b border-line">
        {shown.map((d) => {
          const h = counted.get(d) ?? 0;
          const isToday = d === marked;
          return (
            <li key={d} className="flex h-full w-10 flex-col items-center justify-end">
              <span className="sr-only">
                {shortDay(d)}: {d > today ? 'still to come' : hoursAndMinutes(h)}
              </span>
              <span
                aria-hidden="true"
                className={`w-full rounded-t-[10px] ${isToday ? 'bg-ink' : 'bg-line-soft'}`}
                style={{ height: `${Math.max(d > today ? 0 : 4, (h / top) * 100)}%` }}
              />
            </li>
          );
        })}
      </ul>
      <div aria-hidden="true" className="mt-2 flex justify-around gap-3 text-[11px] text-muted">
        {shown.map((d) => (
          <span key={d} className={`w-10 text-center ${d === marked ? 'text-ink' : ''}`}>
            {shortDay(d).slice(0, 3)}
          </span>
        ))}
      </div>
      <dl className="mt-5 flex gap-10 text-sm">
        <div>
          <dt className="text-[11px] text-muted">Average a day</dt>
          <dd className="mt-0.5 tabular-nums">{average === null ? '—' : hoursAndMinutes(average)}</dd>
        </div>
        {hoursADay && (
          <div>
            <dt className="text-[11px] text-muted">Weekly target</dt>
            <dd className="mt-0.5 tabular-nums">{hoursFigure(hoursADay * shown.length)} hours</dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

export async function Dashboard({ user }: { user: Session }) {
  const profile = await loadOwnProfile(user);
  const today = todayInCairo();
  // standing in for an approver on leave (owner, 25 October 2026: "To a stand-in")
  const standingIn = standingInBannerText(user.standingInFor);
  // the design's head (30 October 2026): the day in small capitals, the greeting by the hour in Cairo, what it's for
  return (
    <div className="space-y-5">
      <PageHead
        eyebrow={dayEyebrow(today)}
        title={profile ? `${greetingAt(cairoHour())}, ${greetingName(profile)}.` : 'Welcome'}
        intro="Here’s what needs your attention today: checking in, your hours, your leave, your requests and what is left to do."
        actions={
          // the design's "Check in for work" / "Checked in · 8:57 AM", for a current employment, as the Today card
          profile?.employment && (
            <Suspense fallback={null}>
              <TodayCheckInButton />
            </Suspense>
          )
        }
      />
      {standingIn && (
        <p role="status" className="rounded-xl border border-line bg-card px-4 py-3 text-sm">
          {standingIn}{' '}
          <Link href={MY_TEAM} className="font-semibold">
            Open My Team
          </Link>
        </p>
      )}
      {!profile && <NoProfile user={user} />}
      {profile && (
        <Suspense fallback={<StatsLoading />}>
          <Stats profile={profile} user={user} today={today} />
        </Suspense>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* checking in on the system (19 October 2026): a current employment's, first */}
        {profile?.employment && (
          <Suspense fallback={<CardLoading title="Today" eyebrow="Today" wide />}>
            <TodayCheckIn className="lg:col-span-2" />
          </Suspense>
        )}
        <Suspense fallback={<CardLoading title="Upcoming Holidays" eyebrow="Schedule" />}>
          <UpcomingHolidays today={today} />
        </Suspense>
        {profile?.employment && (
          <>
            <Suspense fallback={<CardLoading title="Weekly hours" eyebrow="Attendance" wide />}>
              <WeeklyHours profile={profile} today={today} />
            </Suspense>
            {/* leave is a current employment's (the API has no balance without one) */}
            <Suspense fallback={<CardLoading title="My Leave" eyebrow="Time off" />}>
              <MyLeaveCard profile={profile} today={today} />
            </Suspense>
          </>
        )}
        {profile && (
          <>
            <ToDoCard profile={profile} />
            <Suspense fallback={<CardLoading title="My Requests" eyebrow="Requests" wide />}>
              <MyRequestsCard profile={profile} seesRaises={seesRaiseRequests(user)} />
            </Suspense>
            <YourJob profile={profile} user={user} today={today} />
            <Suspense fallback={null}>
              <CoveringCard today={today} />
            </Suspense>
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
              <Suspense fallback={<CardLoading title="My Team" eyebrow="Your team" full />}>
                <MyTeamCard profile={profile} user={user} today={today} />
              </Suspense>
            )}
          </>
        )}
      </div>
    </div>
  );
}
