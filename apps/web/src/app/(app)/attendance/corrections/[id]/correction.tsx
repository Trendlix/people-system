import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ATTENDANCE_SOURCE_LABELS, CORRECTION_KIND_NAMES } from '@trendlix/shared';
import { CLevelBadge } from '@/components/c-level-badge';
import { approverLabel } from '@/lib/department-leads';
import { formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { appAttendanceHref, appBack, appRequestsHref, type Surface } from '@/lib/surface';
import { CancelLeaveForm, LeaveDecisionForm } from '../../../leave/leave-forms';
import { decidingAsTitle, hrStageName, placeOfEmployee } from '../../../leave/list';
import { LeaveProgress, LeaveStatusBadge, LeaveTimeline } from '../../../leave/ui';
import { BackLink, Empty, UUID } from '../../../organization/ui';
import { notLoadedText } from '../../../payroll/load';
import { cancelMyCorrection, decideCorrection } from '../actions';
import { correctionBack, correctionDayText, correctionDoneText, correctionStepText, dayBeforeText, MY_CORRECTIONS_HREF, rightTimesText, seesCorrections } from '../corrections';
import { loadCorrection } from '../data';

// An attendance correction (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check out")"),
// for the employee, the one who decides it first (their direct manager, else their team lead, else their department's
// head), HR and the CEO; anyone else gets the 404 page, as the API says it isn't there. Its day, what was wrong, what was
// on record when it was asked, the right times, why, where it stands and who decides it, and its log of every step.
// While it waits for the user, their decision (Approve, or Reject with a comment); the employee's Cancel while it is
// being decided. Approved, the day is corrected: the person's month shows it "corrected from" what it was. What was
// just done on it shows at the top (?done=). A C-level person's has HR's stage decided by the CEO: it says so.
// Shown on the site and on the phone pages (owner, 20 October 2026: the employee app, "managers and team leads approve
// from the phone"), where the back link goes to the section's list and what is done on it comes back there.

type Query = Record<string, string | string[] | undefined>;

function Fact({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export async function CorrectionDetail({
  params,
  searchParams,
  surface = 'site',
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Query>;
  /** The site, or the phone pages' section it is opened in (owner, 20 October 2026: the employee app). */
  surface?: Surface;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const [user, loaded] = await Promise.all([getCurrentUser(), loadCorrection(id)]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind === 'forbidden') return <Empty>This correction isn&apos;t yours to see.</Empty>;
  if (loaded.kind === 'failed') return <Empty>{notLoadedText(loaded, 'correction')}</Empty>;
  const r = loaded.value;
  const back = surface === 'site' ? correctionBack(user, r) : appBack(surface);
  const done = correctionDoneText(query, r.status, r.manager, r.confidential);
  const place = placeOfEmployee(r.employee);
  const own = user.employeeId === r.employee.id;
  const what = `correction of ${correctionDayText(r)}`;
  // the person's month, where the day shows corrected: for those who open everyone's attendance, and the employee's own
  // on the phone pages, the employee's own month there (HR's view of a person's month is the site's)
  const monthHref = own
    ? surface === 'site'
      ? `/my-attendance?month=${r.date.slice(0, 7)}`
      : appAttendanceHref(r.date.slice(0, 7))
    : seesCorrections(user) && surface === 'site'
      ? `/attendance/${r.employee.id}?month=${r.date.slice(0, 7)}`
      : null;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink href={back.href}>{back.label}</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Attendance Correction</h1>
          <LeaveStatusBadge status={r.status} confidential={r.confidential} />
          {r.confidential && <CLevelBadge title="A C-level person: the CEO decides HR’s stage, and HR doesn’t see the correction." />}
        </div>
        <p className="text-muted">
          {r.employee.fullNameEn}
          {place && ` · ${place}`} · {r.recordedByHr ? 'corrected by HR' : 'sent'} {formatDateTime(r.createdAt)}
        </p>
      </div>
      {done && (
        <p role="status" className={`rounded-lg px-4 py-3 text-sm ${done.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
          {done.text}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="The Correction">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Fact label="Day">
                <span className="tabular-nums">{correctionDayText(r)}</span>
              </Fact>
              <Fact label="What was wrong">{CORRECTION_KIND_NAMES[r.correctionKind] ?? r.correctionKind}</Fact>
              <Fact label="On record when asked">
                <span className="tabular-nums">{dayBeforeText(r.dayBefore)}</span>
                {r.dayBefore && <span className="block text-xs text-muted">{ATTENDANCE_SOURCE_LABELS[r.dayBefore.source] ?? r.dayBefore.source}</span>}
              </Fact>
              <Fact label="The right times">
                <span className="text-base font-semibold tabular-nums">{rightTimesText(r)}</span>
                {r.correctionKind === 'worked_remotely' && <span className="block text-xs text-muted">Counted as remote work, no longer flagged once approved</span>}
              </Fact>
              <Fact label="Why" wide>
                <span className="whitespace-pre-line">{r.reason}</span>
              </Fact>
              <Fact label="Where it stands">
                <LeaveProgress request={r} />
                {r.appliedAt && <span className="block text-xs text-muted">The day was corrected {formatDateTime(r.appliedAt)}</span>}
              </Fact>
              <Fact label={r.manager ? approverLabel(r.manager) : 'Direct manager'}>
                {r.recordedByHr ? (
                  <span className="text-muted">Corrected by HR directly: no decision needed</span>
                ) : r.manager ? (
                  r.manager.fullNameEn
                ) : (
                  <span className="text-muted">None: sent straight to {hrStageName(r.confidential)}</span>
                )}
              </Fact>
            </dl>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {monthHref && <Link href={monthHref}>{own ? 'Open My Attendance' : 'Open their month'}</Link>}
              {own && <Link href={surface === 'site' ? MY_CORRECTIONS_HREF : appRequestsHref('correction')}>Your other corrections are on My Requests</Link>}
            </div>
          </Section>

          {r.waitingForYou && r.stage && (
            <Section title={`Your Decision as ${decidingAsTitle(user, r.stage, r.manager, r.confidential)}`}>
              <LeaveDecisionForm action={decideCorrection.bind(null, r.id, r.stage)} stage={r.stage} name={r.employee.fullNameEn} confidential={r.confidential} kind="correction" />
            </Section>
          )}

          {r.canCancel && (
            <Section title="Cancel the Correction">
              <p className="mb-3 text-sm text-muted">While it is being decided you can cancel it, e.g. to ask again with other times. The day stays as it is.</p>
              <CancelLeaveForm action={cancelMyCorrection.bind(null, r.id)} what={what} kind="correction" />
            </Section>
          )}
        </div>

        <Section title="Every Step">
          <LeaveTimeline request={r} stepText={correctionStepText} />
        </Section>
      </div>
    </div>
  );
}
