import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { seesRaiseRequests } from '@trendlix/shared';
import { formatDate, formatDateTime } from '@/lib/format';
import { hasRole } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { EmployeeProfile } from '@/lib/types';
import { NoProfile } from '../dashboard/cards';
import { ChangeRequestStatusBadge, ChangesTable } from '../employees/[id]/change-request/request-parts';
import { Loading, todayInCairo } from '../employees/ui';
import { loadTeam } from '../my-team/data';
import { loadOwnProfile } from '../own-profile';
import { RaiseCard } from './raise-card';
import { loadEmployeeRaiseRequests } from '../raise-requests/data';
import { justSent, newRaiseRequestHref } from '../raise-requests/list';
import { RequestSent } from '../raise-requests/ui';
import { loadLeaveTypes, loadMyBalances, loadMyLeave, loadMyPermissionMonth, loadMyPermissions } from '../leave/data';
import { NEW_LEAVE_PATH, requestsLabel } from '../leave/list';
import { asksPermission as offersPermission, NEW_PERMISSION_PATH, PERMISSION_OFF_TEXT, permissionMonthText } from '../leave/permissions';
import { LeaveBalanceFigures, MyLeaveTable, MyPermissionTable } from '../leave/ui';
import { loadMyClaims } from '../reimbursements/data';
import { claimsLabel, NEW_CLAIM_PATH } from '../reimbursements/list';
import { MyClaimsTable } from '../reimbursements/ui';
import { ASK_CORRECTION_PATH } from '../attendance/corrections/corrections';
import { loadMyCorrections } from '../attendance/corrections/data';
import { CorrectionsTable } from '../attendance/corrections/ui';
import { loadMyHomes } from '../home-locations/data';
import { asksHome, homeProgressText, MY_HOME_ID, NEW_HOME_PATH, placesInForce } from '../home-locations/home-locations';
import { HomeMap, MyHomesTable } from '../home-locations/ui';
import { loadMyExitInterview } from '../offboarding/data';
import { MY_EXIT_INTERVIEW_PATH } from '../offboarding/offboarding';
import { loadMyWfh, loadWfhAllowance } from '../attendance/wfh/data';
import { NEW_WFH_PATH, wfhAllowanceLine } from '../attendance/wfh/wfh';
import { WfhTable } from '../attendance/wfh/ui';
import { loadMyOd, loadOdForm } from '../attendance/official-duty/data';
import { NEW_OD_PATH } from '../attendance/official-duty/od';
import { OdTable } from '../attendance/official-duty/ui';
import {
  askedByManager,
  filterRequests,
  myRequests,
  myRequestsHref,
  noRequestsText,
  readRequestFilters,
  REQUEST_KIND_LABELS,
  REQUEST_STATE_LABELS,
  REQUEST_STATES,
  requestCounts,
  requestKindsFor,
  requestTitle,
  type MyRequest,
  type RequestFilters,
  type RequestKind,
} from './requests';

// My Requests (owner, 17 October 2026: "my suggestion for the employee side bar is 1- Dashboard 2- My Profile 3- My
// Requests"): everything the employee asked for, newest first, filtered by kind and status in the address (so a link
// keeps them), each with its decisions as the API gives them to the employee; buttons to ask again; for a direct
// manager also the raises they asked for for their direct reports (no figure: the API sends a manager none). The
// changes to their details are their profile's: the one waiting for HR and the latest ten decided. Leave has a section
// of its own (below), and attendance corrections too (19 October 2026). Cancelling a change waiting for HR stays on the change request page. Request a raise opens the
// request form under Requests → Raise Requests for themself (17 October 2026: "i think raising a request should be moved
// from the Employee tab to the raise requests tab"), which comes back here once sent, saying so; each raise shows the
// month it is asked from ("Effective from"). Reimbursements (owner, 18 October 2026: "allow the employee to add
// reimbursement request … for specific preset up conditions") have a section of their own below: their claims, newest
// first, each opening its page (receipts, every step, Cancel while it is being decided), and New reimbursement. Leave
// (owner, 18 October 2026: "can you apply the leaves according to the law?") has one too, above it: the annual balance
// of the year and what is left of the other types, their requests, newest first, each opening its page, and New leave.
// Permission (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2 hours per
// day", asked "In the system, like leave") is a part of it: this month's hours (approved, waiting, left of the Leave
// Setup's), their permission requests, the latest day first, each opening its page, and New permission beside New leave.
// Raises (owner, 20 October 2026: "raises not to be visible to employee level for now", then "Hide from managers too"):
// to someone who doesn't see raise requests (seesRaiseRequests, packages/shared raises.ts) nothing of them, their own
// nor their team's: no Request a raise, no raise cards, no Raises or For my team filter; their details changes alone.
// Home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"): a section of their own, with the home in force on a small map, their requests newest first, each opening its
// page (every step, Withdraw while it is being decided, Remove once approved), and Home location to ask for one.
// Working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp"): a
// section of its own, their requests the latest day first, each opening its page, and Work from home to ask for a day,
// hidden when their work arrangement never needs one (Work from home, Outdoor, Indoor and outdoor; a freelancer).

export const metadata: Metadata = { title: 'My Requests · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';

function Chip({ href, label, count, active }: { href: string; label: string; count: number; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`${chip} ${active ? 'border-ink bg-ink text-white hover:text-white' : 'border-line bg-white text-ink hover:bg-canvas hover:text-ink'}`}
    >
      {label}
      <span className={`tabular-nums ${active ? 'opacity-75' : 'text-muted'}`}>{count}</span>
    </Link>
  );
}

function Item({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/** A change to their details they asked HR for: what they asked for, their note, and HR's decision with its note. */
function DetailsCard({ item, employeeId }: { item: Extract<MyRequest, { kind: 'details' }>; employeeId: string }) {
  const r = item.request;
  return (
    <li className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{requestTitle(item)}</h3>
          <p className="text-sm text-muted">Sent {formatDateTime(r.requestedAt)}</p>
        </div>
        {/* a C-level person's waits for the CEO, not HR (19 October 2026) */}
        <ChangeRequestStatusBadge status={r.status} confidential={r.confidential} />
      </div>
      <ChangesTable changes={r.changes} fromLabel="Was" toLabel="Asked for" caption={`What you asked for on ${formatDate(r.requestedAt)}`} />
      {(r.note || r.decidedAt || r.decisionNote) && (
        <dl className="grid gap-3 text-sm">
          {r.note && (
            <Item label="Your note">
              <span className="whitespace-pre-line">{r.note}</span>
            </Item>
          )}
          {r.decidedAt && (
            <Item label={r.status === 'cancelled' ? 'Cancelled' : r.confidential ? 'Decided' : 'Decided by HR'}>
              {r.status !== 'cancelled' && r.decidedBy?.email && <>{r.decidedBy.email} · </>}
              {formatDateTime(r.decidedAt)}
            </Item>
          )}
          {r.decisionNote && (
            <Item label={r.confidential ? 'Note on the decision' : "HR's note"}>
              <span className="whitespace-pre-line">{r.decisionNote}</span>
            </Item>
          )}
        </dl>
      )}
      {item.open && (
        <Link href={`/employees/${employeeId}/change-request`} className="inline-block text-sm font-semibold">
          See or cancel this request
        </Link>
      )}
    </li>
  );
}

function Filters({ all, f, offered, team }: { all: MyRequest[]; f: RequestFilters; offered: readonly RequestKind[]; team: boolean }) {
  const counts = requestCounts(all, f);
  const kinds = offered.filter((k) => k !== 'team' || team || f.kind === 'team');
  return (
    <div className="space-y-2">
      <nav aria-label="Filter by kind" className="flex flex-wrap gap-2">
        <Chip href={myRequestsHref({ ...f, kind: '' })} label="All" count={counts.kinds['']} active={!f.kind} />
        {kinds.map((k) => (
          <Chip key={k} href={myRequestsHref({ ...f, kind: k })} label={REQUEST_KIND_LABELS[k]} count={counts.kinds[k]} active={f.kind === k} />
        ))}
      </nav>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        <Chip href={myRequestsHref({ ...f, status: '' })} label="Any status" count={counts.states['']} active={!f.status} />
        {REQUEST_STATES.map((s) => (
          <Chip key={s} href={myRequestsHref({ ...f, status: s })} label={REQUEST_STATE_LABELS[s]} count={counts.states[s]} active={f.status === s} />
        ))}
      </nav>
    </div>
  );
}

function NewRequestButtons({ profile, canRequestRaise }: { profile: EmployeeProfile; canRequestRaise: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/employees/${profile.id}/change-request`} className="btn btn-secondary">
        Ask to change my details
      </Link>
      {canRequestRaise && (
        <Link href={newRaiseRequestHref(profile.id)} className="btn btn-primary">
          Request a raise
        </Link>
      )}
    </div>
  );
}

async function Requests({ searchParams }: { searchParams: PageProps<'/my-requests'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const profile = await loadOwnProfile(user);
  if (!profile) return <NoProfile user={user} />;
  // raise requests, their own and their team's, only for those who see them (20 October 2026); not even read otherwise
  const seesRaises = seesRaiseRequests(user);
  const manager = seesRaises && hasRole(user, 'manager');
  const [raises, team] = await Promise.all([seesRaises ? loadEmployeeRaiseRequests(profile.id) : null, manager ? loadTeam(profile) : []]);
  const own = raises?.kind === 'ok' ? raises.value : null;
  const forTeam = team.flatMap((m) => (m.raises.kind === 'ok' ? askedByManager(m.raises.value.requests, user.email) : []));
  const all = myRequests({ changes: profile.changeRequests ?? [], raises: own?.requests ?? [], team: forTeam });
  const offered = requestKindsFor(seesRaises);
  const f = readRequestFilters(query, offered);
  const shown = filterRequests(all, f);
  const unloaded = raises?.kind === 'failed' || team.some((m) => m.raises.kind === 'failed');

  return (
    <div className="space-y-5">
      {seesRaises && justSent(query) && <RequestSent />}
      <NewRequestButtons profile={profile} canRequestRaise={!!own?.canRequest} />
      {unloaded && <p className="text-sm text-muted">Some of your raise requests couldn&apos;t be loaded. Please try again in a moment.</p>}
      {all.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-muted">{noRequestsText(seesRaises)}</div>
      ) : (
        <>
          <Filters all={all} f={f} offered={offered} team={forTeam.length > 0} />
          {shown.length === 0 ? (
            <div className="card px-6 py-10 text-center text-sm text-muted">
              No requests match these filters. <Link href={myRequestsHref({ kind: '', status: '' })}>Show all</Link>
            </div>
          ) : (
            <ul className="space-y-4">
              {shown.map((item) =>
                item.kind === 'details' ? (
                  <DetailsCard key={`details:${item.id}`} item={item} employeeId={profile.id} />
                ) : (
                  <RaiseCard key={`${item.kind}:${item.id}`} item={item} />
                ),
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Their permission (owner, 19 October 2026): this month's hours (GET /me/permissions/allowance) and their requests, the
 * latest day first (GET /me/permissions), each opening its page. Nothing from an API from before permission; turned off
 * in Leave Setup, said so (their past requests still listed).
 */
async function Permission({ month }: { month: string }) {
  const [requests, figures] = await Promise.all([loadMyPermissions(), loadMyPermissionMonth(month)]);
  if (requests.kind === 'unavailable') return null;
  return (
    <div id="my-permission" className="scroll-mt-6 space-y-3 pt-4">
      <div>
        <h3 className="font-semibold">Permission</h3>
        <p className="text-sm text-muted">
          A few hours away from a working day, e.g. to leave early or come late, in half hours. Decided as leave is; approved, its hours count as worked.
        </p>
      </div>
      {figures.kind === 'ok' ? (
        <p className="card px-5 py-4 text-sm font-semibold tabular-nums">
          {figures.value.hoursPerMonth > 0 ? permissionMonthText(figures.value, month) : PERMISSION_OFF_TEXT}
        </p>
      ) : (
        figures.kind !== 'unavailable' &&
        figures.kind !== 'forbidden' && <div className="card px-6 py-6 text-sm text-muted">Your permission hours couldn&apos;t be loaded. Please try again in a moment.</div>
      )}
      {requests.kind !== 'ok' ? (
        <div className="card px-6 py-6 text-sm text-muted">Your permission requests couldn&apos;t be loaded. Please try again in a moment.</div>
      ) : requests.value.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-muted">You haven&apos;t asked for permission yet. Ask with New permission.</div>
      ) : (
        <div className="card">
          <MyPermissionTable requests={requests.value} />
          <p className="border-t border-line px-4 py-3 text-sm text-muted">{requestsLabel(requests.value.length)}, the latest day first.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Their leave (owner, 18 October 2026): the annual balance of this year (the entitlement, carried in, adjusted, taken,
 * booked, waiting, available, and from when it may be used in a first year) and what is left of the other types, and
 * their requests, newest first (GET /me/leave/requests), each opening its page; and New leave. Nothing from an API from
 * before leave, nor without a profile of their own. Their permission below it, and New permission beside New leave (19
 * October 2026) while they have a current employment under the labour law and Leave Setup gives permission hours.
 */
async function Leave() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return null;
  const today = todayInCairo();
  const year = Number(today.slice(0, 4));
  const month = today.slice(0, 7);
  const [requests, balances, types, permission] = await Promise.all([loadMyLeave(), loadMyBalances(year), loadLeaveTypes(), loadMyPermissionMonth(month)]);
  if (requests.kind === 'unavailable') return null;
  const asksPermission = offersPermission(profile.employment, permission.kind === 'ok' ? permission.value : null);
  return (
    <section id="my-leave" aria-labelledby="my-leave-heading" className="mt-10 scroll-mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="my-leave-heading" className="text-lg font-semibold">
            Leave
          </h2>
          <p className="text-sm text-muted">Your leave balance, your permission hours and your requests. Your direct manager decides each request first, then HR.</p>
        </div>
        {profile.employment && (
          <div className="flex flex-wrap gap-2">
            <Link href={NEW_LEAVE_PATH} className="btn btn-primary">
              New leave
            </Link>
            {asksPermission && (
              <Link href={NEW_PERMISSION_PATH} className="btn btn-secondary">
                New permission
              </Link>
            )}
          </div>
        )}
      </div>
      {balances.kind === 'ok' ? (
        <div className="card p-5">
          <LeaveBalanceFigures balances={balances.value} types={types.kind === 'ok' ? types.value : null} />
        </div>
      ) : (
        // no employment, no balance: the API answers so
        balances.kind !== 'unavailable' &&
        profile.employment && <div className="card px-6 py-6 text-sm text-muted">Your leave balance couldn&apos;t be loaded. Please try again in a moment.</div>
      )}
      {requests.kind !== 'ok' ? (
        <div className="card px-6 py-6 text-sm text-muted">Your leave requests couldn&apos;t be loaded. Please try again in a moment.</div>
      ) : requests.value.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-muted">You haven&apos;t asked for leave yet. Ask with New leave.</div>
      ) : (
        <div className="card">
          <MyLeaveTable requests={requests.value} />
          <p className="border-t border-line px-4 py-3 text-sm text-muted">{requestsLabel(requests.value.length)}, newest first.</p>
        </div>
      )}
      <Permission month={month} />
    </section>
  );
}

/**
 * Their reimbursement claims (GET /me/reimbursements): the type, the expense's date, the amount claimed and the one
 * approved, where it stands and the payroll month it is paid with; and New reimbursement. Nothing from an API from before
 * them, nor without a profile of their own (the requests above say so).
 */
async function Reimbursements() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return null;
  const claims = await loadMyClaims();
  if (claims.kind === 'unavailable') return null;
  return (
    <section aria-labelledby="my-reimbursements" className="mt-10 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="my-reimbursements" className="text-lg font-semibold">
            Reimbursements
          </h2>
          <p className="text-sm text-muted">
            Expenses you paid for the company, claimed back. Your direct manager decides each first, then HR, then Finance; once approved, it is
            paid with the next payroll.
          </p>
        </div>
        <Link href={NEW_CLAIM_PATH} className="btn btn-primary">
          New reimbursement
        </Link>
      </div>
      {claims.kind !== 'ok' ? (
        <div className="card px-6 py-6 text-sm text-muted">Your reimbursement claims couldn&apos;t be loaded. Please try again in a moment.</div>
      ) : claims.value.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-muted">You haven&apos;t claimed a reimbursement yet. Claim one with New reimbursement.</div>
      ) : (
        <div className="card">
          <MyClaimsTable claims={claims.value} />
          <p className="border-t border-line px-4 py-3 text-sm text-muted">{claimsLabel(claims.value.length)}, newest first.</p>
        </div>
      )}
    </section>
  );
}

/**
 * Their attendance corrections (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check
 * out")"; GET /me/attendance/corrections): the day, what was wrong, the right times and where each stands, the latest day
 * first, each opening its page (every step, Cancel while it is being decided); Ask for a correction. Nothing from an API
 * from before them, nor without a profile of their own.
 */
async function Corrections() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return null;
  const corrections = await loadMyCorrections();
  if (corrections.kind === 'unavailable') return null;
  return (
    <section id="my-corrections" aria-labelledby="my-corrections-heading" className="mt-10 scroll-mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="my-corrections-heading" className="text-lg font-semibold">
            Attendance Corrections
          </h2>
          <p className="text-sm text-muted">
            Days you asked to correct: a check-in or check-out forgotten, a time wrong, work away from the office. Your direct manager decides each
            first, then HR; approved, the day is corrected.
          </p>
        </div>
        {profile.employment && (
          <Link href={ASK_CORRECTION_PATH} className="btn btn-secondary">
            Ask for a correction
          </Link>
        )}
      </div>
      {corrections.kind !== 'ok' ? (
        <div className="card px-6 py-6 text-sm text-muted">Your corrections couldn&apos;t be loaded. Please try again in a moment.</div>
      ) : corrections.value.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-muted">You haven&apos;t asked for a correction. Ask from My Attendance, on the day that isn&apos;t right.</div>
      ) : (
        <CorrectionsTable corrections={corrections.value} note="the latest day first." />
      )}
    </section>
  );
}

/**
 * Their work from home days (owner, 21 October 2026: "think about how should we handle the working from home in out
 * erp"; GET /me/wfh): the day, how it came and where each stands, the latest day first, each opening its page (every
 * step, Cancel while it is being decided); "x of 2 this month · next possible from DD/MM/YYYY" and Work from home to ask
 * for a day, both only when their arrangement needs one (GET /me/wfh/allowance: offered, no refusal). Nothing from an
 * API from before it, nor without a profile of their own; a section with no requests and nothing to ask for is left out.
 */
async function WorkFromHome() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return null;
  const [requests, allowance] = await Promise.all([loadMyWfh(), loadWfhAllowance()]);
  if (requests.kind === 'unavailable') return null;
  const asks = allowance.kind === 'ok' && allowance.value.offered && !allowance.value.refusal && allowance.value.daysPerMonth > 0;
  const list = requests.kind === 'ok' ? requests.value : [];
  if (!asks && requests.kind === 'ok' && list.length === 0) return null;
  return (
    <section id="my-wfh" aria-labelledby="my-wfh-heading" className="mt-10 scroll-mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="my-wfh-heading" className="text-lg font-semibold">
            Work From Home
          </h2>
          <p className="text-sm text-muted">
            A working day from home instead of the office, asked a day before at the latest. Your direct manager decides it first, then HR; it is not
            leave, you check in from home as on any day.
          </p>
        </div>
        {asks && (
          <Link href={NEW_WFH_PATH} className="btn btn-secondary">
            Work from home
          </Link>
        )}
      </div>
      {asks && allowance.kind === 'ok' && <p className="card px-5 py-4 text-sm font-semibold tabular-nums">{wfhAllowanceLine(allowance.value)}</p>}
      {requests.kind !== 'ok' ? (
        <div className="card px-6 py-6 text-sm text-muted">Your work from home requests couldn&apos;t be loaded. Please try again in a moment.</div>
      ) : list.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-muted">You haven&apos;t asked to work from home. Ask with Work from home.</div>
      ) : (
        <WfhTable requests={list} note="the latest day first." />
      )}
    </section>
  );
}

/**
 * Their official duties (owner, 23 October 2026: "Official duty (OD) requests"; GET /me/official-duty): the days and
 * hours, where, and where each stands, the latest first day first, each opening its page (every step, Cancel while it
 * is being decided); Request official duty to ask for one, while its form says nothing refuses them (an employment, not
 * a freelancer: GET /me/official-duty/form). Nothing from an API from before it, nor without a profile of their own; a
 * section with no requests and nothing to ask for is left out.
 */
async function OfficialDuty() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return null;
  const [requests, form] = await Promise.all([loadMyOd(), loadOdForm()]);
  if (requests.kind === 'unavailable') return null;
  const asks = form.kind === 'ok' && !form.value.refusal;
  const list = requests.kind === 'ok' ? requests.value : [];
  if (!asks && requests.kind === 'ok' && list.length === 0) return null;
  return (
    <section id="my-od" aria-labelledby="my-od-heading" className="mt-10 scroll-mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="my-od-heading" className="text-lg font-semibold">
            Official Duty
          </h2>
          <p className="text-sm text-muted">
            Work for the company away from the office, e.g. at a client&apos;s site, asked ahead or up to 3 days after. Your direct manager decides it
            first, then HR; on an approved day you check in from where you are, and the day counts as attended.
          </p>
        </div>
        {asks && (
          <Link href={NEW_OD_PATH} className="btn btn-secondary">
            Request official duty
          </Link>
        )}
      </div>
      {requests.kind !== 'ok' ? (
        <div className="card px-6 py-6 text-sm text-muted">Your official duty requests couldn&apos;t be loaded. Please try again in a moment.</div>
      ) : list.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-muted">You haven&apos;t asked for an official duty. Ask with Request official duty.</div>
      ) : (
        <OdTable requests={list} where note="the latest first day first." />
      )}
    </section>
  );
}

/**
 * Their home location (owner, 20 October 2026: "allow other users to request to add their home locations when working
 * from home"; GET /me/home-locations): the home in force, on a small map, and their requests, newest first, each opening
 * its page; Home location to ask for one while none is being decided. Nothing from an API from before them, nor without
 * a profile of their own. Since 24 October 2026 every check-in location (owner: "(Home Location - Remote Site - Client
 * Location)"): the places in force of every type, each on a small map, their requests of every type, and "Request a
 * check-in location" while a type is still free (one being decided at a time of each).
 */
async function HomeLocation() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return null;
  const homes = await loadMyHomes();
  if (homes.kind === 'unavailable') return null;
  const list = homes.kind === 'ok' ? homes.value : [];
  const inForce = placesInForce(list);
  return (
    <section id={MY_HOME_ID} aria-labelledby={`${MY_HOME_ID}-heading`} className="mt-10 scroll-mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id={`${MY_HOME_ID}-heading`} className="text-lg font-semibold">
            Check-in Locations
          </h2>
          <p className="text-sm text-muted">
            Places you check in from besides the office: your home, a remote site or a client&apos;s place. HR approves each, then the CEO; approved, a
            check-in there shows with its name. Your home and remote sites are only for you, seen by you, HR and the CEO, never your manager; a client
            location counts for every employee.
          </p>
        </div>
        {homes.kind === 'ok' && asksHome(list) && (
          <Link href={NEW_HOME_PATH} className="btn btn-secondary">
            Request a check-in location
          </Link>
        )}
      </div>
      {homes.kind !== 'ok' ? (
        <div className="card px-6 py-6 text-sm text-muted">Your check-in locations couldn&apos;t be loaded. Please try again in a moment.</div>
      ) : list.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-muted">You haven&apos;t asked for a check-in location. Ask with Request a check-in location.</div>
      ) : (
        <>
          {inForce.length > 0 && (
            <ul className="grid gap-4 sm:grid-cols-2">
              {inForce.map((place) => (
                <li key={place.id} className="card space-y-3 p-5">
                  <p className="text-sm font-semibold">{homeProgressText(place).text}</p>
                  <HomeMap request={place} own height="h-[180px]" />
                </li>
              ))}
            </ul>
          )}
          <MyHomesTable requests={list} note="newest first." />
        </>
      )}
    </section>
  );
}

/**
 * The exit interview (owner, 22 October 2026: offboarding, the full module), while the person's offboarding case is open
 * and it isn't done: a card above everything else, opening its form. Nothing otherwise.
 */
async function ExitInterview() {
  const loaded = await loadMyExitInterview();
  if (loaded.kind !== 'ok' || !loaded.value.interview || loaded.value.interview.status !== 'pending') return null;
  const i = loaded.value.interview;
  return (
    <section aria-labelledby="exit-interview" className="card mt-6 flex flex-wrap items-center justify-between gap-3 border-accent/40 p-5">
      <div>
        <h2 id="exit-interview" className="text-lg font-semibold">
          Exit Interview
        </h2>
        <p className="mt-1 text-sm text-muted">
          A few questions about your time here{i.lastWorkingDay ? `, before your last working day, ${formatDate(i.lastWorkingDay)}` : ''}. Your manager never sees
          your answers.
        </p>
      </div>
      <Link href={MY_EXIT_INTERVIEW_PATH} className="btn btn-primary no-underline">
        Fill it in
      </Link>
    </section>
  );
}

export default function MyRequestsPage({ searchParams }: PageProps<'/my-requests'>) {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">My Requests</h1>
      <p className="mt-1 text-muted">What you have asked for, newest first, with each decision as it is made.</p>
      <Suspense fallback={null}>
        <ExitInterview />
      </Suspense>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Requests searchParams={searchParams} />
        </Suspense>
      </div>
      <Suspense fallback={null}>
        <Leave />
      </Suspense>
      <Suspense fallback={null}>
        <Corrections />
      </Suspense>
      <Suspense fallback={null}>
        <WorkFromHome />
      </Suspense>
      <Suspense fallback={null}>
        <OfficialDuty />
      </Suspense>
      <Suspense fallback={null}>
        <HomeLocation />
      </Suspense>
      <Suspense fallback={null}>
        <Reimbursements />
      </Suspense>
    </div>
  );
}
