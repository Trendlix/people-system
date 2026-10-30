import { FileText, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { seesRaiseRequests } from '@trendlix/shared';
import { PageHead } from '@/components/design';
import { formatDate, formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { EmployeeProfile } from '@/lib/types';
import { NoProfile } from '../dashboard/cards';
import { ChangeRequestStatusBadge, ChangesTable } from '../employees/[id]/change-request/request-parts';
import { Loading, todayInCairo } from '../employees/ui';
import { loadOwnProfile } from '../own-profile';
import { RaiseCard } from './raise-card';
import { COVERING_ID, coveringCountText, coveringToCome } from './covering';
import { loadMyCovering } from './covering-data';
import { CoveringList } from './covering-list';
import { justSent, newRaiseRequestHref } from '../raise-requests/list';
import { RequestSent } from '../raise-requests/ui';
import { loadMyPermissionMonth, loadMyPermissions, loadMyLeave } from '../leave/data';
import { NEW_LEAVE_PATH, requestsLabel } from '../leave/list';
import { asksPermission as offersPermission, NEW_PERMISSION_PATH, PERMISSION_OFF_TEXT, permissionMonthText } from '../leave/permissions';
import { MyLeaveTable, MyPermissionTable } from '../leave/ui';
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
import { loadCompensatoryForm, loadMyCompensatory } from '../attendance/compensatory/data';
import { NEW_COMPENSATORY_PATH } from '../attendance/compensatory/compensatory';
import { CompensatoryTable } from '../attendance/compensatory/ui';
import { loadMyWfh, loadWfhAllowance } from '../attendance/wfh/data';
import { NEW_WFH_PATH, wfhAllowanceLine } from '../attendance/wfh/wfh';
import { WfhTable } from '../attendance/wfh/ui';
import { loadMyResignation } from '../resignations/data';
import { RESIGN_PATH } from '../resignations/resignation';
import { ResignationsTable } from '../resignations/ui';
import { loadMyOd, loadOdForm } from '../attendance/official-duty/data';
import { NEW_OD_PATH } from '../attendance/official-duty/od';
import { OdTable } from '../attendance/official-duty/ui';
import { loadChangesAndRaises, loadOverview, type Overview } from './data';
import { detailsRequestAnchor, historyRows, readHistoryAll, readHistoryFilter, twoDigits, yearSummary } from './history';
import { otherLeaveTypes, permissionFigure } from './overview';
import { AnnualLeaveCard, FigureTile, HistoryPanel, KIND_ICONS, OtherLeaveCards, SectionHead, StartCard } from './parts';
import {
  filterRequests,
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
// Requests"): everything the employee asked for, newest first, with each decision as the API gives it to the employee.
// Drawn to the owner's design (Figma "PeopleTrendlix", the desktop version, 30 October 2026) on top: the page's head with
// Create request (to the requests to start); the annual leave of the year, the requests asked this year and this month's
// permission hours; Recent requests, every kind in one table with All / Approved / Waiting; the Other leave balances; and
// Start another request, a card for each request they may ask for now. Under them, each kind's section, as before, with
// every detail of its requests (the overview's rows open the same pages).
//
// The kinds, and the owner's decisions they keep:
// The changes to their details are their profile's: the one waiting for HR and the latest ten decided, filtered by kind
// and status in the address (so a link keeps them). Cancelling a change waiting for HR stays on the change request page.
// For a direct manager also the raises they asked for for their direct reports (no figure: the API sends a manager none).
// Request a raise opens the request form under Requests → Raise Requests for themself (17 October 2026: "i think raising a
// request should be moved from the Employee tab to the raise requests tab"), which comes back here once sent, saying so;
// each raise shows the month it is asked from ("Effective from"). Raises (owner, 20 October 2026: "raises not to be
// visible to employee level for now", then "Hide from managers too"): to someone who doesn't see raise requests
// (seesRaiseRequests, packages/shared raises.ts) nothing of them, their own nor their team's: no Request a raise, no raise
// cards or rows, no Raises or For my team filter; their details changes alone.
// Leave (owner, 18 October 2026: "can you apply the leaves according to the law?"): the annual balance of the year (the
// card at the top) and what is left of the other types (Other leave), their requests, newest first, each opening its
// page, and New leave. Permission (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a
// maximum 2 hours per day", asked "In the system, like leave"): this month's hours (approved, waiting, left of the Leave
// Setup's), their permission requests, the latest day first, each opening its page, and New permission. Attendance
// corrections too (19 October 2026).
// Reimbursements (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific preset up
// conditions"): their claims, newest first, each opening its page (receipts, every step, Cancel while it is being
// decided), and New reimbursement.
// Home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"): the home in force on a small map, their requests newest first, each opening its page (every step, Withdraw
// while it is being decided, Remove once approved), and a way to ask for one.
// Working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp"): their
// requests the latest day first, each opening its page, and Work from home to ask for a day, offered only when their work
// arrangement needs one (not Work from home, Outdoor, Indoor and outdoor; nor a freelancer).
// I'm Covering (owner, 25 October 2026: "Required over 2 days", "Names, no leave types"): the colleagues' leave they were
// named to cover, current or to come, each with whom, the days, approved or waiting and the handover note, never its
// type; only when there is some (#covering, where a cover's notification opens).

export const metadata: Metadata = { title: 'My Requests · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm no-underline';

/** The changes and raises section's anchor: its filters come back to it. */
const CHANGES_ID = 'changes-and-raises';

type Query = Awaited<PageProps<'/my-requests'>['searchParams']>;

/** The address for the changes-and-raises filters, keeping Recent requests' choice (?show=, ?all=) and landing on the section. */
function changesHref(f: RequestFilters, query: Query): string {
  const [path, qs = ''] = myRequestsHref(f).split('?');
  const params = new URLSearchParams(qs);
  for (const key of ['show', 'all'] as const) {
    const v = query[key];
    if (typeof v === 'string' && v) params.set(key, v);
  }
  const s = params.toString();
  return `${path}${s ? `?${s}` : ''}#${CHANGES_ID}`;
}

function Chip({ href, label, count, active }: { href: string; label: string; count: number; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`${chip} ${active ? 'border-accent bg-accent text-on-accent hover:text-on-accent' : 'border-line bg-card text-ink hover:bg-raised hover:text-ink'}`}
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

/** What a section says in place of what it couldn't load, or before anything is asked for: quiet, a dashed line round it. */
function Note({ children, roomy = false }: { children: React.ReactNode; roomy?: boolean }) {
  return <div className={`rounded-[14px] border border-dashed border-line px-5 text-sm text-muted ${roomy ? 'py-6' : 'py-4'}`}>{children}</div>;
}

/** A change to their details they asked HR for: what they asked for, their note, and HR's decision with its note. */
function DetailsCard({ item, employeeId }: { item: Extract<MyRequest, { kind: 'details' }>; employeeId: string }) {
  const r = item.request;
  return (
    <li id={detailsRequestAnchor(r.id)} className="card scroll-mt-6 space-y-4 p-[22px] target:ring-2 target:ring-accent">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium">{requestTitle(item)}</h3>
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
        <Link href={`/employees/${employeeId}/change-request`} className="inline-block text-sm font-medium">
          See or cancel this request
        </Link>
      )}
    </li>
  );
}

function Filters({ all, f, offered, team, query }: { all: MyRequest[]; f: RequestFilters; offered: readonly RequestKind[]; team: boolean; query: Query }) {
  const counts = requestCounts(all, f);
  const kinds = offered.filter((k) => k !== 'team' || team || f.kind === 'team');
  return (
    <div className="space-y-2">
      <nav aria-label="Filter by kind" className="flex flex-wrap gap-2">
        <Chip href={changesHref({ ...f, kind: '' }, query)} label="All" count={counts.kinds['']} active={!f.kind} />
        {kinds.map((k) => (
          <Chip key={k} href={changesHref({ ...f, kind: k }, query)} label={REQUEST_KIND_LABELS[k]} count={counts.kinds[k]} active={f.kind === k} />
        ))}
      </nav>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        <Chip href={changesHref({ ...f, status: '' }, query)} label="Any status" count={counts.states['']} active={!f.status} />
        {REQUEST_STATES.map((s) => (
          <Chip key={s} href={changesHref({ ...f, status: s }, query)} label={REQUEST_STATE_LABELS[s]} count={counts.states[s]} active={f.status === s} />
        ))}
      </nav>
    </div>
  );
}

/** Create request, in the page's head: to the requests they may start (only with a profile of their own). */
async function CreateRequest() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return null;
  return (
    <a href="#start-request" className="btn btn-primary shadow-card">
      <Plus aria-hidden="true" className="size-[18px]" strokeWidth={1.6} />
      Create request
    </a>
  );
}

/** The requests they may start now, each as its section offers it (the same checks), in the order of the sections. */
function startCards(o: Overview, profile: EmployeeProfile) {
  const cards: ({ key: string } & React.ComponentProps<typeof StartCard>)[] = [];
  const leaveOn = o.leave.kind !== 'unavailable';
  if (leaveOn && profile.employment) {
    cards.push({
      key: 'leave',
      icon: KIND_ICONS.leave,
      title: 'Leave',
      text: 'Time off: annual, casual, sick or another type of leave.',
      href: NEW_LEAVE_PATH,
      action: 'New leave',
    });
  }
  // while they have a current employment under the labour law and Leave Setup gives permission hours (19 October 2026)
  if (leaveOn && o.permissions.kind !== 'unavailable' && offersPermission(profile.employment, o.permissionMonth.kind === 'ok' ? o.permissionMonth.value : null)) {
    cards.push({
      key: 'permission',
      icon: KIND_ICONS.permission,
      title: 'Permission',
      text: 'A few hours away from a working day, in half-hour blocks.',
      href: NEW_PERMISSION_PATH,
      action: 'New permission',
    });
  }
  if (o.corrections.kind !== 'unavailable' && profile.employment) {
    cards.push({
      key: 'correction',
      icon: KIND_ICONS.correction,
      title: 'Attendance correction',
      text: 'Correct a check-in or check-out that is missing or not right.',
      href: ASK_CORRECTION_PATH,
      action: 'Ask for a correction',
    });
  }
  if (
    o.wfh.kind !== 'unavailable' &&
    o.wfhAllowance.kind === 'ok' &&
    o.wfhAllowance.value.offered &&
    !o.wfhAllowance.value.refusal &&
    o.wfhAllowance.value.daysPerMonth > 0
  ) {
    cards.push({
      key: 'wfh',
      icon: KIND_ICONS.wfh,
      title: 'Work from home',
      text: 'A working day from home instead of the office.',
      href: NEW_WFH_PATH,
      action: 'Work from home',
    });
  }
  if (o.od.kind !== 'unavailable' && o.odForm.kind === 'ok' && !o.odForm.value.refusal) {
    cards.push({
      key: 'od',
      icon: KIND_ICONS.od,
      title: 'Official duty',
      text: 'Work for the company away from the office, e.g. at a client’s site.',
      href: NEW_OD_PATH,
      action: 'Request official duty',
    });
  }
  if (o.compensatory.kind !== 'unavailable' && o.compensatoryForm.kind === 'ok' && o.compensatoryForm.value.offered && !o.compensatoryForm.value.refusal) {
    cards.push({
      key: 'compensatory',
      icon: KIND_ICONS.compensatory,
      title: 'Compensatory days',
      text: 'A day off for a rest day or an official holiday you worked.',
      href: NEW_COMPENSATORY_PATH,
      action: 'Compensatory day',
    });
  }
  if (o.homes.kind === 'ok' && asksHome(o.homes.value)) {
    cards.push({
      key: 'home',
      icon: KIND_ICONS.home,
      title: 'Check-in locations',
      text: 'Ask for a place to check in from besides the office.',
      href: NEW_HOME_PATH,
      action: 'Request a check-in location',
    });
  }
  if (o.claims.kind !== 'unavailable') {
    cards.push({
      key: 'claim',
      icon: KIND_ICONS.claim,
      title: 'Reimbursements',
      text: 'Claim back an expense you paid for the company.',
      href: NEW_CLAIM_PATH,
      action: 'New reimbursement',
    });
  }
  cards.push({
    key: 'details',
    icon: KIND_ICONS.details,
    title: 'My details',
    text: 'Ask HR to change your details on your profile.',
    href: `/employees/${profile.id}/change-request`,
    action: 'Ask to change my details',
  });
  if (o.changes.own?.canRequest) {
    cards.push({
      key: 'raise',
      icon: KIND_ICONS.raise,
      title: 'Raise',
      text: 'Ask for a raise: HR, then the CEO, decide it.',
      href: newRaiseRequestHref(profile.id),
      action: 'Request a raise',
    });
  }
  if (o.resignation?.kind === 'ok' && o.resignation.value.form.offered) {
    cards.push({
      key: 'resignation',
      icon: KIND_ICONS.resignation,
      title: 'Resignation',
      text: 'Tell HR you wish to resign, and when you plan to leave.',
      href: RESIGN_PATH,
      action: 'Resign',
    });
  }
  return cards;
}

/** The kinds of requests that couldn't be read, for the line over Recent requests. */
function failedKinds(o: Overview): string[] {
  const named: [boolean, string][] = [
    [o.leave.kind === 'failed', 'leave'],
    [o.permissions.kind === 'failed', 'permission'],
    [o.corrections.kind === 'failed', 'attendance corrections'],
    [o.wfh.kind === 'failed', 'work from home'],
    [o.od.kind === 'failed', 'official duty'],
    [o.compensatory.kind === 'failed', 'compensatory days'],
    [o.homes.kind === 'failed', 'check-in locations'],
    [o.claims.kind === 'failed', 'reimbursements'],
    [o.resignation?.kind === 'failed', 'resignation'],
    [o.changes.unloaded, 'raise requests'],
  ];
  return named.filter(([failed]) => failed).map(([, name]) => name);
}

/**
 * The overview, the owner's design (30 October 2026): the annual leave card, the requests asked this year and this
 * month's permission hours; Recent requests; Other leave; and Start another request. Nothing without a profile of their
 * own: it says so (the sections below have nothing either).
 */
async function OverviewPart({ searchParams }: { searchParams: PageProps<'/my-requests'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const profile = await loadOwnProfile(user);
  if (!profile) return <NoProfile user={user} />;
  const today = todayInCairo();
  const year = Number(today.slice(0, 4));
  const o = await loadOverview(user, profile, year, today.slice(0, 7));
  const rows = historyRows({
    leave: o.leave.kind === 'ok' ? o.leave.value : undefined,
    permissions: o.permissions.kind === 'ok' ? o.permissions.value : undefined,
    corrections: o.corrections.kind === 'ok' ? o.corrections.value : undefined,
    wfh: o.wfh.kind === 'ok' ? o.wfh.value : undefined,
    od: o.od.kind === 'ok' ? o.od.value : undefined,
    compensatory: o.compensatory.kind === 'ok' ? o.compensatory.value : undefined,
    homes: o.homes.kind === 'ok' ? o.homes.value : undefined,
    claims: o.claims.kind === 'ok' ? o.claims.value : undefined,
    resignations: o.resignation?.kind === 'ok' ? o.resignation.value.requests : undefined,
    requests: o.changes.all,
  });
  const thisYear = yearSummary(rows, String(year));
  const permission = o.permissionMonth.kind === 'ok' ? permissionFigure(o.permissionMonth.value) : null;
  // the balance: none without an employment (the API answers so), nor from an API from before leave
  const balanceShown = o.balances.kind === 'ok' || (o.balances.kind !== 'unavailable' && !!profile.employment);
  const types = o.types.kind === 'ok' ? o.types.value : null;
  const cards = startCards(o, profile);
  const grid = !balanceShown
    ? 'grid-cols-2 lg:grid-cols-4'
    : permission
      ? 'grid-cols-2 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)]'
      : 'grid-cols-2 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]';
  const wide = 'col-span-2 lg:col-span-1';
  const others = o.balances.kind === 'ok' ? otherLeaveTypes(o.balances.value, types) : [];
  return (
    <>
      <div className={`grid gap-3 ${grid}`}>
        {o.balances.kind === 'ok' ? (
          <AnnualLeaveCard balances={o.balances.value} today={today} className={wide} />
        ) : (
          balanceShown && (
            <div className={`card flex items-center p-[22px] text-sm text-muted ${wide}`}>Your leave balance couldn&apos;t be loaded. Please try again in a moment.</div>
          )
        )}
        <FigureTile icon={FileText} label="Requests this year" value={twoDigits(thisYear.count)} spoken={String(thisYear.count)} note={thisYear.note} />
        {permission && (
          <FigureTile
            icon={KIND_ICONS.permission}
            label={permission.off ? 'Permission' : 'Permission left'}
            value={permission.value}
            note={permission.off ? PERMISSION_OFF_TEXT : permission.note}
          />
        )}
      </div>
      <div className="mt-3">
        <HistoryPanel rows={rows} show={readHistoryFilter(query)} all={readHistoryAll(query)} query={query} failed={failedKinds(o)} />
      </div>
      {o.balances.kind === 'ok' && others.length > 0 && (
        <section aria-labelledby="other-leave-heading" className="mt-[34px]">
          <SectionHead id="other-leave-heading" eyebrow="Balances" title="Other leave" />
          <div className="mt-4">
            <OtherLeaveCards balances={o.balances.value} types={types} />
          </div>
        </section>
      )}
      <section aria-labelledby="start-request-heading" id="start-request" className="mt-[34px] scroll-mt-6">
        <SectionHead
          id="start-request-heading"
          eyebrow="Self service"
          title="Start another request"
          intro="Choose a request type and we’ll guide you through the details."
        />
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(({ key, ...c }) => (
            <StartCard key={key} {...c} />
          ))}
        </ul>
      </section>
    </>
  );
}

/**
 * The changes to their details and the raises (owner, 17 October 2026), filtered by kind and status in the address, each
 * with its decisions; the first sections' heading for someone who sees raise requests, else "Changes to your details".
 */
async function ChangesAndRaises({ searchParams }: { searchParams: PageProps<'/my-requests'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const profile = await loadOwnProfile(user);
  if (!profile) return null;
  const { seesRaises, forTeam, all, unloaded } = await loadChangesAndRaises(user, profile);
  const offered = requestKindsFor(seesRaises);
  const f = readRequestFilters(query, offered);
  const shown = filterRequests(all, f);
  return (
    <>
      {/* where the overview ends and each kind's section, with every detail, begins */}
      <div className="mt-14 flex items-center gap-4">
        <p className="eyebrow shrink-0">Every request, by kind</p>
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
      </div>
      <section id={CHANGES_ID} aria-labelledby={`${CHANGES_ID}-heading`} className="mt-6 scroll-mt-6 space-y-4">
        <SectionHead
          id={`${CHANGES_ID}-heading`}
          eyebrow="Your profile"
          title={seesRaises ? 'Changes and raises' : 'Changes to your details'}
          intro={
            seesRaises
              ? 'The changes to your details you asked HR for, and the raises you asked for, each with every decision.'
              : 'The changes to your details you asked HR for, each with HR’s decision.'
          }
        />
        {unloaded && <p className="text-sm text-muted">Some of your raise requests couldn&apos;t be loaded. Please try again in a moment.</p>}
        {all.length === 0 ? (
          <Note roomy>{noRequestsText(seesRaises)}</Note>
        ) : (
          <>
            <Filters all={all} f={f} offered={offered} team={forTeam.length > 0} query={query} />
            {shown.length === 0 ? (
              <Note roomy>
                No requests match these filters. <Link href={changesHref({ kind: '', status: '' }, query)}>Show all</Link>
              </Note>
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
      </section>
    </>
  );
}

/**
 * Their permission (owner, 19 October 2026): this month's hours (GET /me/permissions/allowance) and their requests, the
 * latest day first (GET /me/permissions), each opening its page. Nothing from an API from before permission; turned off
 * in Leave Setup, said so (their past requests still listed).
 */
async function Permission() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return null;
  const month = todayInCairo().slice(0, 7);
  const [leave, requests, figures] = await Promise.all([loadMyLeave(), loadMyPermissions(), loadMyPermissionMonth(month)]);
  if (leave.kind === 'unavailable' || requests.kind === 'unavailable') return null;
  return (
    <section id="my-permission" aria-labelledby="my-permission-heading" className="mt-[34px] scroll-mt-6 space-y-4">
      <SectionHead
        id="my-permission-heading"
        eyebrow="Time off"
        title="Permission"
        intro="A few hours away from a working day, e.g. to leave early or come late, in half hours. Decided as leave is; approved, its hours count as worked."
      />
      {figures.kind === 'ok' ? (
        <p className="card px-5 py-4 text-sm tabular-nums">{figures.value.hoursPerMonth > 0 ? permissionMonthText(figures.value, month) : PERMISSION_OFF_TEXT}</p>
      ) : (
        figures.kind !== 'unavailable' && figures.kind !== 'forbidden' && <Note>Your permission hours couldn&apos;t be loaded. Please try again in a moment.</Note>
      )}
      {requests.kind !== 'ok' ? (
        <Note>Your permission requests couldn&apos;t be loaded. Please try again in a moment.</Note>
      ) : requests.value.length === 0 ? (
        <Note roomy>You haven&apos;t asked for permission yet. Ask with New permission.</Note>
      ) : (
        <div className="card overflow-hidden">
          <MyPermissionTable requests={requests.value} />
          <p className="border-t border-line px-4 py-3 text-sm text-muted">{requestsLabel(requests.value.length)}, the latest day first.</p>
        </div>
      )}
    </section>
  );
}

/**
 * Their leave requests (owner, 18 October 2026), newest first (GET /me/leave/requests), each opening its page; the
 * balance is the card at the top and Other leave, and New leave is with the requests to start. Nothing from an API from
 * before leave, nor without a profile of their own. Their permission follows it (19 October 2026).
 */
async function Leave() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return null;
  const requests = await loadMyLeave();
  if (requests.kind === 'unavailable') return null;
  return (
    <section id="my-leave" aria-labelledby="my-leave-heading" className="mt-[34px] scroll-mt-6 space-y-4">
      <SectionHead
        id="my-leave-heading"
        eyebrow="Time off"
        title="Leave"
        intro="Your leave requests. Your direct manager decides each request first, then HR; your balance is at the top of the page."
      />
      {requests.kind !== 'ok' ? (
        <Note>Your leave requests couldn&apos;t be loaded. Please try again in a moment.</Note>
      ) : requests.value.length === 0 ? (
        <Note roomy>You haven&apos;t asked for leave yet. Ask with New leave.</Note>
      ) : (
        <div className="card overflow-hidden">
          <MyLeaveTable requests={requests.value} />
          <p className="border-t border-line px-4 py-3 text-sm text-muted">{requestsLabel(requests.value.length)}, newest first.</p>
        </div>
      )}
    </section>
  );
}

/**
 * Their reimbursement claims (GET /me/reimbursements): the type, the expense's date, the amount claimed and the one
 * approved, where it stands and the payroll month it is paid with; New reimbursement is with the requests to start.
 * Nothing from an API from before them, nor without a profile of their own.
 */
async function Reimbursements() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return null;
  const claims = await loadMyClaims();
  if (claims.kind === 'unavailable') return null;
  return (
    <section aria-labelledby="my-reimbursements" className="mt-[34px] space-y-4">
      <SectionHead
        id="my-reimbursements"
        eyebrow="Expenses"
        title="Reimbursements"
        intro="Expenses you paid for the company, claimed back. Your direct manager decides each first, then HR, then Finance; once approved, it is paid with the next payroll."
      />
      {claims.kind !== 'ok' ? (
        <Note>Your reimbursement claims couldn&apos;t be loaded. Please try again in a moment.</Note>
      ) : claims.value.length === 0 ? (
        <Note roomy>You haven&apos;t claimed a reimbursement yet. Claim one with New reimbursement.</Note>
      ) : (
        <div className="card overflow-hidden">
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
 * first, each opening its page (every step, Cancel while it is being decided); Ask for a correction is with the requests
 * to start. Nothing from an API from before them, nor without a profile of their own.
 */
async function Corrections() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return null;
  const corrections = await loadMyCorrections();
  if (corrections.kind === 'unavailable') return null;
  return (
    <section id="my-corrections" aria-labelledby="my-corrections-heading" className="mt-[34px] scroll-mt-6 space-y-4">
      <SectionHead
        id="my-corrections-heading"
        eyebrow="Attendance"
        title="Attendance corrections"
        intro="Days you asked to correct: a check-in or check-out forgotten, a time wrong, work away from the office. Your direct manager decides each first, then HR; approved, the day is corrected."
      />
      {corrections.kind !== 'ok' ? (
        <Note>Your corrections couldn&apos;t be loaded. Please try again in a moment.</Note>
      ) : corrections.value.length === 0 ? (
        <Note roomy>You haven&apos;t asked for a correction. Ask from My Attendance, on the day that isn&apos;t right.</Note>
      ) : (
        <CorrectionsTable corrections={corrections.value} note="the latest day first." />
      )}
    </section>
  );
}

/**
 * Their work from home days (owner, 21 October 2026: "think about how should we handle the working from home in out
 * erp"; GET /me/wfh): the day, how it came and where each stands, the latest day first, each opening its page (every
 * step, Cancel while it is being decided); "x of 2 this month · next possible from DD/MM/YYYY" while their arrangement
 * needs a request (GET /me/wfh/allowance: offered, no refusal), Work from home being with the requests to start. Nothing
 * from an API from before it, nor without a profile of their own; a section with no requests and nothing to ask for is
 * left out.
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
    <section id="my-wfh" aria-labelledby="my-wfh-heading" className="mt-[34px] scroll-mt-6 space-y-4">
      <SectionHead
        id="my-wfh-heading"
        eyebrow="Attendance"
        title="Work from home"
        intro="A working day from home instead of the office, asked a day before at the latest. Your direct manager decides it first, then HR; it is not leave, you check in from home as on any day."
      />
      {asks && allowance.kind === 'ok' && <p className="card px-5 py-4 text-sm tabular-nums">{wfhAllowanceLine(allowance.value)}</p>}
      {requests.kind !== 'ok' ? (
        <Note>Your work from home requests couldn&apos;t be loaded. Please try again in a moment.</Note>
      ) : list.length === 0 ? (
        <Note roomy>You haven&apos;t asked to work from home. Ask with Work from home.</Note>
      ) : (
        <WfhTable requests={list} note="the latest day first." />
      )}
    </section>
  );
}

/**
 * Their compensatory days (owner, 26 October 2026: "my compensatory is a compensation with another day in the same
 * month. and rarely to be compensated in cash"; GET /me/compensatory): the day worked, the day off and where each stands,
 * the latest first, each opening its page (every step, Cancel while it is being decided); Compensatory day, with the
 * requests to start, while its form says nothing refuses them (an employment, not a freelancer: GET
 * /me/compensatory/form). Nothing from an API from before it, nor without a profile of their own; a section with no
 * requests and nothing to ask for is left out.
 */
async function Compensatory() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return null;
  const [requests, form] = await Promise.all([loadMyCompensatory(), loadCompensatoryForm()]);
  if (requests.kind === 'unavailable') return null;
  const asks = form.kind === 'ok' && form.value.offered && !form.value.refusal;
  const list = requests.kind === 'ok' ? requests.value : [];
  if (!asks && requests.kind === 'ok' && list.length === 0) return null;
  return (
    <section id="my-compensatory" aria-labelledby="my-compensatory-heading" className="mt-[34px] scroll-mt-6 space-y-4">
      <SectionHead
        id="my-compensatory-heading"
        eyebrow="Attendance"
        title="Compensatory days"
        intro="A day off in the same month in exchange for a rest day or an official holiday you worked, asked a day before at the latest. Your direct manager decides it first, then HR, who approves it as a day off or, rarely, pays it in cash instead."
      />
      {requests.kind !== 'ok' ? (
        <Note>Your compensatory day requests couldn&apos;t be loaded. Please try again in a moment.</Note>
      ) : list.length === 0 ? (
        <Note roomy>You haven&apos;t asked for a compensatory day. Ask with Compensatory day.</Note>
      ) : (
        <CompensatoryTable requests={list} note="the latest day worked first." />
      )}
    </section>
  );
}

/**
 * Their resignation (owner, 26 October 2026: "but the employee has to request resignation and then the HR generates the
 * document"): Resign, with the requests to start, while they may send one (a current employment under the labour law,
 * none waiting, no ending recorded), and their requests, newest first, each opening its page (Withdraw while HR hasn't
 * recorded it). Nothing from an API from before it; a section with no requests and nothing to send is left out.
 */
async function Resignation() {
  const user = await getCurrentUser();
  if (!user.employeeId) return null;
  const mine = await loadMyResignation();
  if (mine.kind !== 'ok') return null;
  const { requests, form } = mine.value;
  if (!form.offered && requests.length === 0) return null;
  return (
    <section id="my-resignation" aria-labelledby="my-resignation-heading" className="mt-[34px] scroll-mt-6 space-y-4">
      <SectionHead
        id="my-resignation-heading"
        eyebrow="Employment"
        title="Resignation"
        intro="Tell HR you wish to resign. HR records it, and you can withdraw it until then."
      />
      {requests.length === 0 ? <Note roomy>You haven&apos;t sent a resignation request.</Note> : <ResignationsTable requests={requests} note="Newest first." />}
    </section>
  );
}

/**
 * Their official duties (owner, 23 October 2026: "Official duty (OD) requests"; GET /me/official-duty): the days and
 * hours, where, and where each stands, the latest first day first, each opening its page (every step, Cancel while it
 * is being decided); Request official duty, with the requests to start, while its form says nothing refuses them (an
 * employment, not a freelancer: GET /me/official-duty/form). Nothing from an API from before it, nor without a profile
 * of their own; a section with no requests and nothing to ask for is left out.
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
    <section id="my-od" aria-labelledby="my-od-heading" className="mt-[34px] scroll-mt-6 space-y-4">
      <SectionHead
        id="my-od-heading"
        eyebrow="Attendance"
        title="Official duty"
        intro="Work for the company away from the office, e.g. at a client’s site, asked ahead or up to 3 days after. Your direct manager decides it first, then HR; on an approved day you check in from where you are, and the day counts as attended."
      />
      {requests.kind !== 'ok' ? (
        <Note>Your official duty requests couldn&apos;t be loaded. Please try again in a moment.</Note>
      ) : list.length === 0 ? (
        <Note roomy>You haven&apos;t asked for an official duty. Ask with Request official duty.</Note>
      ) : (
        <OdTable requests={list} where note="the latest first day first." />
      )}
    </section>
  );
}

/**
 * Their home location (owner, 20 October 2026: "allow other users to request to add their home locations when working
 * from home"; GET /me/home-locations): the home in force, on a small map, and their requests, newest first, each opening
 * its page. Nothing from an API from before them, nor without a profile of their own. Since 24 October 2026 every
 * check-in location (owner: "(Home Location - Remote Site - Client Location)"): the places in force of every type, each
 * on a small map, their requests of every type, and "Request a check-in location", with the requests to start, while a
 * type is still free (one being decided at a time of each).
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
    <section id={MY_HOME_ID} aria-labelledby={`${MY_HOME_ID}-heading`} className="mt-[34px] scroll-mt-6 space-y-4">
      <SectionHead
        id={`${MY_HOME_ID}-heading`}
        eyebrow="Attendance"
        title="Check-in locations"
        intro="Places you check in from besides the office: your home, a remote site or a client’s place. HR approves each, then the CEO; approved, a check-in there shows with its name. Your home and remote sites are only for you, seen by you, HR and the CEO, never your manager; a client location counts for every employee."
      />
      {homes.kind !== 'ok' ? (
        <Note>Your check-in locations couldn&apos;t be loaded. Please try again in a moment.</Note>
      ) : list.length === 0 ? (
        <Note roomy>You haven&apos;t asked for a check-in location. Ask with Request a check-in location.</Note>
      ) : (
        <>
          {inForce.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {inForce.map((place) => (
                <li key={place.id} className="card space-y-3 p-[22px]">
                  <p className="text-sm font-medium">{homeProgressText(place).text}</p>
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
 * The colleagues' leave they cover (owner, 25 October 2026: "Required over 2 days"; GET /me/leave/covering): current or to
 * come, the nearest first, with whom, the days, approved or still waiting, and the handover note; never the leave's type.
 * Only when there is some; nothing from an API from before it.
 */
async function Covering() {
  const loaded = await loadMyCovering();
  if (loaded.kind !== 'ok') return null;
  const today = todayInCairo();
  const list = coveringToCome(loaded.value, today);
  if (!list.length) return null;
  return (
    <section id={COVERING_ID} aria-labelledby={`${COVERING_ID}-heading`} className="mt-[34px] scroll-mt-6 space-y-4">
      <SectionHead
        id={`${COVERING_ID}-heading`}
        eyebrow="Colleagues"
        title="I’m covering"
        intro={`Colleagues who named you to cover their work while they are away: ${coveringCountText(list.length)}, the nearest first. Asking for leave on these days yourself is still possible, with a warning, and HR sees it.`}
      />
      <CoveringList list={list} today={today} />
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
    <section aria-labelledby="exit-interview" className="card mt-7 flex flex-wrap items-center justify-between gap-4 border-accent/40 p-[22px]">
      <div>
        <p className="eyebrow">Offboarding</p>
        <h2 id="exit-interview" className="mt-1.5 text-xl font-medium tracking-[-0.035em]">
          Exit interview
        </h2>
        <p className="mt-1 text-sm text-muted">
          A few questions about your time here
          {i.lastWorkingDay ? `, before your last working day, ${formatDate(i.lastWorkingDay)}` : ''}. Your manager never sees your answers.
        </p>
      </div>
      <Link href={MY_EXIT_INTERVIEW_PATH} className="btn btn-primary no-underline">
        Fill it in
      </Link>
    </section>
  );
}

/** A raise request just sent (?sent=1), said at the top, for someone who sees raise requests. */
async function Sent({ searchParams }: { searchParams: PageProps<'/my-requests'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!seesRaiseRequests(user) || !justSent(query)) return null;
  return (
    <div className="mt-6">
      <RequestSent />
    </div>
  );
}

export default function MyRequestsPage({ searchParams }: PageProps<'/my-requests'>) {
  return (
    <div>
      <PageHead
        eyebrow="People System · Requests"
        title="My Requests"
        intro="What you have asked for, newest first, with each decision as it is made."
        actions={
          <Suspense fallback={null}>
            <CreateRequest />
          </Suspense>
        }
      />
      <Suspense fallback={null}>
        <Sent searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={null}>
        <ExitInterview />
      </Suspense>
      <div className="mt-7">
        <Suspense fallback={<Loading />}>
          <OverviewPart searchParams={searchParams} />
        </Suspense>
      </div>
      <Suspense fallback={null}>
        <ChangesAndRaises searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={null}>
        <Covering />
      </Suspense>
      <Suspense fallback={null}>
        <Leave />
      </Suspense>
      <Suspense fallback={null}>
        <Permission />
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
        <Compensatory />
      </Suspense>
      <Suspense fallback={null}>
        <HomeLocation />
      </Suspense>
      <Suspense fallback={null}>
        <Reimbursements />
      </Suspense>
      <Suspense fallback={null}>
        <Resignation />
      </Suspense>
    </div>
  );
}
