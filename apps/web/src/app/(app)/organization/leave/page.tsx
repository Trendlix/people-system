import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { leaveTypeRulesText } from '@trendlix/shared';
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
import { deleteLeaveType, saveLeaveSettings } from './actions';
import { LeaveSettingsForm } from './settings-form';
import { balanceText, editsLeaveSetup, LEAVE_TYPES_ID, leaveTypeHref, NEW_LEAVE_TYPE_HREF, payText, requestsCountText, seesYearClosing, SETTING_FIELDS, typeSource, unitText, yearClosingHref } from './setup';
import { closingYear } from './year-closing';

// Organization → Leave, beside Holidays (owner, 18 October 2026: "can you apply the leaves according to the law?", "make
// it with decision with the year closing"): the Leave Setup, in three sections. 1 Annual Leave: its days by Labour Law
// 14/2025 Art. 124 (15 in the first year, pro rata and usable after six months; 21 from the second; 30 after 10 full
// years' service with any employer, or over 50; 45 with a disability; 7 more for hazardous, unhealthy or remote work),
// and how long carried days may stay (Art. 125: three years). 2 Leave Types: the law's, seeded (annual, casual, sick, a
// child's birth, exams, maternity, Hajj, childcare off as it is for companies of 50 or more, unpaid), each a card with
// its days, pay, balance and rules in words, on or off; HR adds and changes them, a Super Admin deletes one no request
// uses. 3 Year Closing: what of each employee's unused days is carried and what is paid, HR's decision at the year's end.
// HR changes it; the other staff read it (the API checks every request again).

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
      </dl>
    );
  }
  return (
    <SetupSection
      id="annual-leave"
      title="Annual Leave"
      intro="The days a year by service, age and disability (Art. 124: “لا يدخل فى حسابها أيام عطلات الأعياد والمناسبات الرسمية والراحة الأسبوعية”: holidays and rest days aren’t counted). Each employee’s prior service, disability and hazardous work are on their profile."
    >
      {body}
    </SetupSection>
  );
}

function TypeCard({ type: t, edits, deletes }: { type: LeaveTypeView; edits: boolean; deletes: boolean }) {
  return (
    <li className={`space-y-3 rounded-lg border border-line p-4 ${t.active ? 'bg-white' : 'bg-canvas'}`}>
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
        <LeaveTypes user={user} />
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
