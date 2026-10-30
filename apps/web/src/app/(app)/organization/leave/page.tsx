import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { leaveTypeRulesText, type StaffingUnitView } from '@trendlix/shared';
import { LEAVE_PATH } from '@/components/nav';
import { DeleteForm } from '@/components/form';
import { titleCase } from '@/lib/format';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { LeaveSettingsView, LeaveTypeView, SessionUser } from '@/lib/types';
import { todayInCairo } from '../../employees/ui';
import { loadLeaveSettings, loadLeaveTypes } from '../../leave/data';
import { rulesOf } from '../../leave/request';
import { NotLoaded, SettingRow, SetupSection } from '../payroll/section';
import { Loading } from '../ui';
import { deleteLeaveType, saveLeaveSettings, saveStaffingLimit } from './actions';
import { LeaveSettingsForm } from './settings-form';
import {
  balanceText,
  editsLeaveSetup,
  editsStaffing,
  LEAVE_TYPES_ID,
  leaveTypeHref,
  NEW_LEAVE_TYPE_HREF,
  payText,
  PERMISSION_FIELDS,
  permissionSettingText,
  requestsCountText,
  seesYearClosing,
  SETTING_FIELDS,
  typeSource,
  unitText,
  yearClosingHref,
} from './setup';
import { closingYear } from './year-closing';
import { limitNowText, peopleNowText, STAFFING_ID, staffingGroups, takesLimit, unitLimitText } from './staffing';
import { loadStaffing } from './staffing-data';
import { StaffingLimitForm } from './staffing-form';
import { COMPENSATORY_SETUP_PATH } from '../../attendance/compensatory/compensatory';
import { saveWfhSettings } from '../../attendance/wfh/actions';
import { loadWfhSettings } from '../../attendance/wfh/data';
import { WfhSettingsForm } from '../../attendance/wfh/wfh-forms';

// Organization → Leave, beside Holidays (owner, 18 October 2026: "can you apply the leaves according to the law?", "make
// it with decision with the year closing"): the Leave Setup, in three sections. 1 Annual Leave: its days by Labour Law
// 14/2025 Art. 124 (15 in the first year, pro rata and usable after six months; 21 from the second; 30 after 10 full
// years' service with any employer, or over 50; 45 with a disability; 7 more for hazardous, unhealthy or remote work),
// and how long carried days may stay (Art. 125: three years). 2 Leave Types: the law's, seeded (annual, casual, sick, a
// child's birth, exams, maternity, Hajj, childcare off as it is for companies of 50 or more, unpaid), each a card with
// its days, pay, balance and rules in words, on or off; HR adds and changes them, a Super Admin deletes one no request
// uses. 3 Year Closing: what of each employee's unused days is carried and what is paid, HR's decision at the year's end.
// HR changes it; the other staff read it (the API checks every request again). Permission (owner, 19 October 2026: "4
// hours per month with a maximum 2 hours per day", asked where its limits live, "Yes, in Leave Setup") is in the first
// section, Annual Leave and Permission: its hours a month and most hours a day, saved with the annual leave's days.
// Working from home (owner, 21 October 2026: "its 2 days per month with a gap of 1 week between each record
// (Biweekly)", the limits in Leave Setup) has a section of its own after it: the days a month and the days between two,
// HR's to change, read by the other staff. Staffing (owner, 25 October 2026: "if there are leaves applied by an employee
// and another employee in the same department is on a leave, how can we manage it without affecting the workflow?";
// asked, "Warn and need HR"), after the types: each team's limit for annual leave (a department's without teams), "At
// most N people on annual leave at once" and/or "At least P% at work", set by HR and a Super Admin, read by the other
// staff; a request over it is still sent, with a warning, and HR approves it too; never sick or casual leave.
// Compensatory days' cash rate, after Work From Home since 26 October 2026, moved to the Compensatory Setup (owner, 27
// October 2026: "i need a setup dashboard for the compensatory leaves"): a pointer to it stays here.

export const metadata: Metadata = { title: 'Leave Setup · People System' };

const Section = ({ children }: { children: React.ReactNode }) => <Suspense fallback={<Loading />}>{children}</Suspense>;

const INTRO =
  'Leave as Labour Law 14/2025 gives it (Arts. 124–133, and 54–57 for maternity and childcare). Each year runs from January to December: the annual leave is earned month by month, and at the year’s end HR decides in the Year Closing what of the unused days is carried and what is paid.';

async function AnnualLeave({ user }: { user: SessionUser }) {
  const loaded = await loadLeaveSettings();
  const edits = editsLeaveSetup(user);
  let body: React.ReactNode;
  if (loaded.kind !== 'ok') {
    body = <NotLoaded what="the leave setup" loaded={loaded.kind === 'unavailable' ? loaded : { kind: 'failed', message: loaded.kind === 'failed' ? loaded.messages.join(' ') : 'Only staff can see it.' }} />;
  } else if (edits) {
    body = <LeaveSettingsForm action={saveLeaveSettings} settings={loaded.value} />;
  } else {
    const s: LeaveSettingsView = loaded.value;
    body = (
      <dl>
        {SETTING_FIELDS.map((f) => (
          <SettingRow key={f.key} label={f.label}>
            <span className="tabular-nums">{unitText(s[f.key], f.unit)}</span>
            <span lang="ar" dir="rtl" className="mt-0.5 block text-xs text-muted">
              {f.law}
            </span>
          </SettingRow>
        ))}
        {/* permission's hours (19 October 2026), when the API has them */}
        {PERMISSION_FIELDS.map((f) => {
          const hours = s[f.key];
          return typeof hours === 'number' ? (
            <SettingRow key={f.key} label={f.label}>
              <span className="tabular-nums">{permissionSettingText(hours)}</span>
            </SettingRow>
          ) : null;
        })}
      </dl>
    );
  }
  const permission = loaded.kind === 'ok' && typeof loaded.value.permissionHoursPerMonth === 'number';
  return (
    <SetupSection
      id="annual-leave"
      title={permission ? 'Annual Leave and Permission' : 'Annual Leave'}
      intro={`The days a year by service, age and disability (Art. 124: “لا يدخل فى حسابها أيام عطلات الأعياد والمناسبات الرسمية والراحة الأسبوعية”: holidays and rest days aren’t counted). Each employee’s prior service, disability and hazardous work are on their profile.${permission ? ' Then permission: the hours a month and the most a day an employee may be away from a working day.' : ''}`}
    >
      {body}
    </SetupSection>
  );
}

function TypeCard({ type: t, edits, deletes }: { type: LeaveTypeView; edits: boolean; deletes: boolean }) {
  return (
    <li className={`space-y-3 rounded-lg border border-line p-4 ${t.active ? 'bg-card' : 'bg-canvas'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">
            {titleCase(t.nameEn)}{' '}
            <span lang="ar" dir="rtl" className="inline-block font-normal text-muted">
              {t.nameAr}
            </span>
          </h3>
          <p className="text-xs text-muted">{typeSource(t)}</p>
        </div>
        <div className="flex items-center gap-3">
          {t.active ? <span className="badge bg-ok-soft text-ok">On</span> : <span className="badge bg-line-soft text-muted">Off</span>}
          {edits && (
            <Link href={leaveTypeHref(t.id)} className="text-sm font-semibold">
              Edit<span className="sr-only"> {t.nameEn}</span>
            </Link>
          )}
        </div>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3" aria-label={`Days and pay of ${t.nameEn}`}>
        <div className="rounded-lg bg-canvas px-3 py-2">
          <dt className="text-xs text-muted">Days</dt>
          <dd className="text-sm font-semibold">{balanceText(t)}</dd>
        </div>
        <div className="rounded-lg bg-canvas px-3 py-2">
          <dt className="text-xs text-muted">Pay</dt>
          <dd className="text-sm font-semibold">{payText(t)}</dd>
        </div>
        <div className="rounded-lg bg-canvas px-3 py-2">
          <dt className="text-xs text-muted">Counted in</dt>
          <dd className="text-sm font-semibold">{t.calendarDays ? 'Calendar days' : 'Working days'}</dd>
        </div>
      </dl>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted">Rules</dt>
        <dd>{leaveTypeRulesText(rulesOf(t))}</dd>
        {t.requests !== undefined && (
          <>
            <dt className="text-muted">Requests</dt>
            <dd className="tabular-nums">{requestsCountText(t.requests)}</dd>
          </>
        )}
      </dl>
      {/* only a Super Admin deletes (owner's decision, 15 October 2026), and only a type no request uses */}
      {deletes && t.requests === 0 && (
        <DeleteForm action={deleteLeaveType.bind(null, t.id)} confirmText={`Delete the leave type ${t.nameEn}? No request uses it. This cannot be undone.`} label="Delete type" />
      )}
    </li>
  );
}

async function LeaveTypes({ user }: { user: SessionUser }) {
  const loaded = await loadLeaveTypes();
  const edits = editsLeaveSetup(user);
  let body: React.ReactNode;
  if (loaded.kind !== 'ok') {
    body = <NotLoaded what="the leave types" loaded={loaded.kind === 'unavailable' ? loaded : { kind: 'failed', message: loaded.kind === 'failed' ? loaded.messages.join(' ') : 'Only staff can see them.' }} />;
  } else if (loaded.value.length === 0) {
    body = <p className="text-sm text-muted">No leave types yet.</p>;
  } else {
    const types = [...loaded.value].sort((a, b) => Number(b.active) - Number(a.active) || a.sortOrder - b.sortOrder);
    body = (
      <ul className="space-y-3">
        {types.map((t) => (
          <TypeCard key={t.id} type={t} edits={edits} deletes={canDelete(user)} />
        ))}
      </ul>
    );
  }
  return (
    <SetupSection
      id={LEAVE_TYPES_ID}
      title="Leave Types"
      intro="The kinds of leave employees ask for from My Requests, the law's to start with: each with its days, its pay and its rules. A request goes to the direct manager, then HR. Off: not offered for new requests. A change applies to the requests sent afterwards."
    >
      {edits && loaded.kind === 'ok' && (
        <div className="mb-4">
          <Link href={NEW_LEAVE_TYPE_HREF} className="btn btn-primary">
            Add a leave type
          </Link>
        </div>
      )}
      {body}
    </SetupSection>
  );
}

/** A team's (or a department's) row of Staffing: its name, its people now, its limit in words and what it means, and its form. */
function StaffingRow({ unit: u, edits }: { unit: StaffingUnitView; edits: boolean }) {
  const now = limitNowText(u);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-semibold">
          {titleCase(u.nameEn)} {u.team && <span className="text-xs font-normal text-muted">Team</span>}
        </h3>
        <span className="text-sm text-muted tabular-nums">{peopleNowText(u.members)}</span>
      </div>
      {takesLimit(u) ? (
        <>
          <p className="text-sm">{unitLimitText(u)}</p>
          {now && <p className="text-xs text-muted">{now}</p>}
          {edits && <StaffingLimitForm action={saveStaffingLimit.bind(null, u.id, u.nameEn)} unit={u} />}
        </>
      ) : (
        <p className="text-sm text-muted">It has teams: each team below has its own limit.</p>
      )}
    </div>
  );
}

/**
 * The teams' staffing limits for annual leave (owner, 25 October 2026: "Warn and need HR"; GET /leave/staffing): every
 * department with its teams under it, each team (or a department without teams) with its people now and its limit; HR
 * and a Super Admin change them row by row (editsStaffing), the other staff read them. Nothing from an API from before it.
 */
async function Staffing({ user }: { user: SessionUser }) {
  const loaded = await loadStaffing();
  if (loaded.kind === 'unavailable') return null;
  const edits = editsStaffing(user);
  let body: React.ReactNode;
  if (loaded.kind === 'forbidden') body = <p className="text-sm text-muted">Only HR, the CEO, Finance and Admins see the staffing limits.</p>;
  else if (loaded.kind === 'failed') body = <NotLoaded what="the staffing limits" loaded={{ kind: 'failed', message: loaded.messages.join(' ') }} />;
  else if (loaded.value.length === 0) body = <p className="text-sm text-muted">No departments yet: they are added on Organization → Departments.</p>;
  else {
    body = (
      <ul className="space-y-4">
        {staffingGroups(loaded.value).map((g) => (
          <li key={g.department.id} className="rounded-lg border border-line p-4">
            <StaffingRow unit={g.department} edits={edits} />
            {g.teams.length > 0 && (
              <ul className="mt-4 space-y-4 border-l-2 border-line-soft pl-4" aria-label={`Teams of ${g.department.nameEn}`}>
                {g.teams.map((t) => (
                  <li key={t.id}>
                    <StaffingRow unit={t} edits={edits} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <SetupSection
      id={STAFFING_ID}
      title="Staffing"
      intro="How many of a team may be on annual leave at once, so leave doesn't stop its work: at most so many people, or at least a share of them at work, either, both or none; a department without teams has its own. A request of annual or unpaid leave that would break it on any day, counting the approved and waiting ones, is still sent: the employee is warned, the manager and HR see the clash, and HR approves it too, marked Over the staffing limit. Sick and casual leave are never limited, as the law doesn't let them be refused. HR and the Super Admin set the limits."
    >
      {body}
    </SetupSection>
  );
}

/**
 * Working from home (owner, 21 October 2026: "its 2 days per month with a gap of 1 week between each record
 * (Biweekly)"): the days a calendar month someone may work from home and the fewest days between two, HR's to change
 * (GET and PATCH /wfh/settings). Nothing from an API from before it.
 */
async function WorkFromHome({ user }: { user: SessionUser }) {
  const loaded = await loadWfhSettings();
  if (loaded.kind === 'unavailable') return null;
  return (
    <SetupSection
      id="work-from-home"
      title="Work From Home"
      intro="A working day from home instead of the office, not leave: no balance, no pay effect, its hours counted as any day's. Asked a day before at the latest by someone expected at the office that day, decided by their manager, then HR. At most these days a calendar month, any two at least these days apart, across months too; HR may record a day past them, with a warning."
    >
      {loaded.kind === 'ok' ? (
        <WfhSettingsForm action={saveWfhSettings} settings={loaded.value} canEdit={editsLeaveSetup(user)} />
      ) : (
        <NotLoaded what="the work from home limits" loaded={{ kind: 'failed', message: loaded.kind === 'failed' ? loaded.messages.join(' ') : 'Only staff can see it.' }} />
      )}
    </SetupSection>
  );
}

/**
 * Compensatory days (owner, 26 October 2026: "if paid in cash make it 1.5"): their cash rate was here until their rules
 * moved to a page of their own, the Compensatory Setup, with the hours that earn hours off or a whole day and when the day
 * off is taken (owner, 27 October 2026: "i need a setup dashboard for the compensatory leaves"; the cash rate "moves here
 * from Leave Setup"); a pointer to it in its place.
 */
function CompensatoryDays() {
  return (
    <SetupSection
      id="compensatory-days"
      title="Compensatory Days"
      intro="A day off in exchange for a rest day or an official holiday worked, or hours off for part of one, decided by the manager, then HR, who approves it as time off, which adds no pay, or, rarely, as cash instead. The cash rate, the hours that earn hours off or a whole day, and when the day off is taken are on the Compensatory Setup."
    >
      <Link href={COMPENSATORY_SETUP_PATH} className="btn btn-secondary no-underline">
        Compensatory Setup
      </Link>
    </SetupSection>
  );
}

function YearClosingSection({ user }: { user: SessionUser }) {
  const year = closingYear({}, todayInCairo());
  return (
    <SetupSection
      id="year-closing"
      title="Year Closing"
      intro="At a year's end, HR decides for each employee how many of their unused annual days are carried into the new year and how many are paid: together they are all the unused days, as leave can't be lost, and days carried for three years are paid (Art. 125). The pay is added to the January payroll as Unused leave paid. Someone who leaves is paid their balance in the final settlement."
    >
      {seesYearClosing(user) ? (
        <div className="flex flex-wrap gap-2">
          <Link href={yearClosingHref(year)} className="btn btn-primary">
            {editsLeaveSetup(user) ? `Year closing of ${year}` : `See the year closing of ${year}`}
          </Link>
          <Link href={yearClosingHref(year - 1)} className="btn btn-secondary">
            {year - 1}
          </Link>
        </div>
      ) : (
        <p className="text-sm text-muted">Only HR and the CEO see the year closing.</p>
      )}
    </SetupSection>
  );
}

async function LeaveSetup() {
  const user = await getCurrentUser();
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted">
        {INTRO} Requests are on <Link href={LEAVE_PATH}>Requests → Leave Requests</Link>.
      </p>
      <Section>
        <AnnualLeave user={user} />
      </Section>
      <Section>
        <WorkFromHome user={user} />
      </Section>
      <CompensatoryDays />
      <Section>
        <LeaveTypes user={user} />
      </Section>
      <Section>
        <Staffing user={user} />
      </Section>
      <YearClosingSection user={user} />
    </div>
  );
}

export default function LeaveSetupPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LeaveSetup />
    </Suspense>
  );
}
