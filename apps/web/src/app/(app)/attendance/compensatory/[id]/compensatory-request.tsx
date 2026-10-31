import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CLevelBadge } from '@/components/c-level-badge';
import { approverLabel } from '@/lib/department-leads';
import { formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { standingInNoteText } from '@/lib/stand-in';
import { appBack, type Surface } from '@/lib/surface';
import type { LeaveRequestStep } from '@/lib/types';
import { decidingAsTitle, hrStageName, placeOfEmployee } from '../../../leave/list';
import { LeaveStatusBadge, LeaveTimeline } from '../../../leave/ui';
import { BackLink, Empty, UUID } from '../../../organization/ui';
import { notLoadedText } from '../../../payroll/load';
import { cancelCompensatoryByHr, cancelMyCompensatory, decideCompensatory } from '../actions';
import { COMPENSATORY_OUTCOME_LABELS, hoursText } from '@trendlix/shared';
import {
  COMPENSATORY_WITH_OD_NOTE,
  compensatoryAheadText,
  compensatoryBack,
  compensatoryCashAddedText,
  compensatoryDateText,
  compensatoryDaysLine,
  compensatoryDoneText,
  compensatoryHoursFact,
  compensatoryOdHref,
  compensatoryOdText,
  compensatoryProgressText,
  compensatorySourceText,
  compensatoryStepText,
  MY_COMPENSATORY_HREF,
} from '../compensatory';
import { CancelCompensatoryForm, CompensatoryDecisionForm, HrCancelCompensatoryForm } from '../compensatory-forms';
import { loadCompensatory } from '../data';

// A compensatory day request (owner, 26 October 2026: "my compensatory is a compensation with another day in the same
// month. and rarely to be compensated in cash"; "Manager, then HR"), for the employee, the one who decides it first (the approver in charge), HR and the
// CEO; anyone else gets the 404 page, as the API says it isn't there. Its day worked and day off, the reason, how it came
// (asked, or recorded by HR with the warnings it was recorded past), HR's decision, where it stands and who decides it, and its log of every step. While it waits for the user, their decision
// (Approve, or Reject with a comment); the employee's Cancel while it is being decided; HR's Cancel of an approved day,
// with a comment. What was just done on it shows at the top (?done=). A C-level person's has HR's stage decided by the
// CEO (or HR with Super Admin). Shown on the site and on the phone pages, where the back link goes to the section's list
// and what is done on it comes back there. Part of a day worked (owner, 27 October 2026: "Hours off for hours worked")
// shows its hours and the hours off they earned; one an official duty on a rest day or an official holiday carries says
// so, linking to the duty, and is decided and cancelled with it (the API sends it without a decision or Cancel here). A day
// worked asked ahead (owner, 31 October 2026: "or choose a future day in the same month only, for upcomming days") says it
// is still to come, or that it was when asked; HR approves one still to come as a day off, cash instead waiting for it.

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

export async function CompensatoryRequestDetail({
  params,
  searchParams,
  surface = 'site',
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Query>;
  /** The site, or the phone pages' section it is opened in. */
  surface?: Surface;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const [user, loaded] = await Promise.all([getCurrentUser(), loadCompensatory(id)]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind === 'forbidden') return <Empty>This compensatory day request isn&apos;t yours to see.</Empty>;
  if (loaded.kind === 'failed') return <Empty>{notLoadedText(loaded, 'compensatory day request')}</Empty>;
  const r = loaded.value;
  const back = surface === 'site' ? compensatoryBack(user, r) : appBack(surface);
  const hoursOff = r.hoursOff ?? null;
  const hoursFact = compensatoryHoursFact(r);
  const ahead = compensatoryAheadText(r);
  const done = compensatoryDoneText(query, r.status, r.manager, r.confidential, r.outcome, hoursOff);
  const place = placeOfEmployee(r.employee);
  const progress = compensatoryProgressText(r);
  const what = `compensatory day request for ${compensatoryDaysLine(r)}`;
  const own = user.employeeId === r.employee.id;
  // the log as the leave timeline draws it, an import worded its own way (compensatoryStepText)
  const timeline = { ...r, steps: r.steps as unknown as LeaveRequestStep[] };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink href={back.href}>{back.label}</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">Compensatory Day</h1>
          <LeaveStatusBadge status={r.status} confidential={r.confidential} />
          {r.confidential && <CLevelBadge title="A C-level person: the CEO decides HR’s stage, and HR doesn’t see the request." />}
        </div>
        <p className="text-muted">
          {r.employee.fullNameEn}
          {place && ` · ${place}`} · {compensatorySourceText(r).toLowerCase()} {formatDateTime(r.createdAt)}
        </p>
      </div>
      {/* the official duty it goes with (27 October 2026), decided and cancelled with it */}
      {r.od && (
        <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm">
          <Link href={compensatoryOdHref(r.od, surface)} className="font-semibold">
            {compensatoryOdText(r.od)}
          </Link>
          . {COMPENSATORY_WITH_OD_NOTE}
        </p>
      )}
      {done && (
        <p role="status" className={`rounded-lg px-4 py-3 text-sm ${done.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
          {done.text}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="The Days">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Fact label="Day worked">
                <span className="text-base font-semibold tabular-nums">{compensatoryDateText(r.dayWorked)}</span>
                <span className="block text-xs text-muted">A rest day of the shift or an official holiday. Nothing is paid for it when it is compensated with a day.</span>
                {ahead && <span className="mt-1 block text-xs font-medium text-accent">{ahead}</span>}
                {r.noCheckIn && <span className="mt-1 block text-xs font-medium text-warn">No check-in is kept on this day: HR confirms it was worked when deciding.</span>}
              </Fact>
              {/* part of the day worked (27 October 2026: "Hours off for hours worked") */}
              {hoursFact && (
                <Fact label="Hours worked">
                  <span className="font-semibold tabular-nums">{hoursFact}</span>
                  <span className="block text-xs text-muted">Part of the day, by the Compensatory Setup.</span>
                </Fact>
              )}
              <Fact label={r.outcome === 'cash' ? (hoursOff !== null ? 'Hours off' : 'Day off') : hoursOff !== null ? 'Day for the hours off' : 'Day off asked for'}>
                {r.outcome === 'cash' ? (
                  <span className="text-muted">None: paid in cash instead</span>
                ) : r.dayOff ? (
                  <>
                    <span className="text-base font-semibold tabular-nums">
                      {hoursOff !== null && `${hoursText(hoursOff)} off on `}
                      {compensatoryDateText(r.dayOff)}
                    </span>
                    <span className="block text-xs text-muted">
                      {hoursOff !== null
                        ? 'Once approved, those hours count as worked that day, with no deduction: not leave, nothing comes off any balance.'
                        : 'Once approved it counts as a full paid day, not leave: nothing comes off any balance.'}
                    </span>
                  </>
                ) : (
                  <span className="text-muted">None</span>
                )}
              </Fact>
              {r.outcome && (
                <Fact label="HR's decision">
                  <span className="font-semibold">{COMPENSATORY_OUTCOME_LABELS[r.outcome]}</span>
                  {r.outcome === 'cash' && r.status === 'approved' && <span className="block text-xs text-muted">{compensatoryCashAddedText(r)}</span>}
                </Fact>
              )}
              {r.reason && (
                <Fact label="Reason" wide>
                  <span className="whitespace-pre-line">{r.reason}</span>
                </Fact>
              )}
              <Fact label="Where it stands">
                {progress.text}
                {progress.reason && <span className="mt-0.5 block whitespace-pre-line text-muted">“{progress.reason}”</span>}
              </Fact>
              <Fact label={r.manager ? approverLabel(r.manager) : 'Direct manager'}>
                {r.recordedByHr ? (
                  <span className="text-muted">{compensatorySourceText(r)}: no decision needed</span>
                ) : r.manager ? (
                  r.manager.fullNameEn
                ) : (
                  <span className="text-muted">None: sent straight to {hrStageName(r.confidential)}</span>
                )}
              </Fact>
              {r.warnings.length > 0 && (
                <Fact label="Recorded past" wide>
                  <ul className="list-disc space-y-0.5 pl-5 text-warn">
                    {r.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Fact>
              )}
            </dl>
            {own && (
              <p className="mt-4 text-sm text-muted">
                Your other compensatory day requests are on <Link href={surface === 'site' ? MY_COMPENSATORY_HREF : appBack(surface).href}>My Requests</Link>.
              </p>
            )}
          </Section>

          {r.waitingForYou && r.stage && (
            <Section title={`Your Decision as ${decidingAsTitle(user, r.stage, r.manager, r.confidential)}`}>
              {/* deciding it standing in for the approver on leave (owner, 25 October 2026: "To a stand-in") */}
              {standingInNoteText(r.standingInFor) && <p className="mb-4 rounded-lg bg-accent-soft px-4 py-3 text-sm">{standingInNoteText(r.standingInFor)}</p>}
              <CompensatoryDecisionForm
                action={decideCompensatory.bind(null, r.id, r.stage)}
                stage={r.stage}
                name={r.employee.fullNameEn}
                confidential={r.confidential}
                noCheckIn={r.noCheckIn === true}
                upcoming={r.upcoming === true}
                dayWorked={r.dayWorked}
                cashDays={r.cashDays}
                dayOff={r.dayOff}
                hoursOff={hoursOff}
              />
            </Section>
          )}

          {r.canCancel && (
            <Section title="Cancel the Request">
              <p className="mb-3 text-sm text-muted">While it is being decided you can cancel it, e.g. to ask for another day.</p>
              <CancelCompensatoryForm action={cancelMyCompensatory.bind(null, r.id)} what={what} />
            </Section>
          )}
          {!r.canCancel && r.hrCanCancel && (
            <Section title="Cancel the Compensatory Day">
              <p className="mb-3 text-sm text-muted">An approved one HR cancels: the day off is a working day again, or the cash addition leaves the draft payroll (not once the month&apos;s payroll is with the CEO, approved or paid). The employee sees why.</p>
              <HrCancelCompensatoryForm action={cancelCompensatoryByHr.bind(null, r.id)} what={what} />
            </Section>
          )}
        </div>

        <Section title="Every Step">
          <LeaveTimeline request={timeline} stepText={compensatoryStepText} />
        </Section>
      </div>
    </div>
  );
}
