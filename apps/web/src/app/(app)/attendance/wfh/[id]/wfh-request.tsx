import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CLevelBadge } from '@/components/c-level-badge';
import { approverLabel } from '@/lib/department-leads';
import { formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { standingInNoteText } from '@/lib/stand-in';
import { appBack, appRequestsHref, type Surface } from '@/lib/surface';
import type { LeaveRequestStep } from '@/lib/types';
import { decidingAsTitle, hrStageName, placeOfEmployee } from '../../../leave/list';
import { LeaveStatusBadge, LeaveTimeline, PayrollLockedNotice } from '../../../leave/ui';
import { BackLink, Empty, UUID } from '../../../organization/ui';
import { notLoadedText } from '../../../payroll/load';
import { cancelMyWfh, cancelWfhByHr, decideWfh } from '../actions';
import { loadWfh } from '../data';
import { MY_WFH_HREF, wfhBack, wfhDayText, wfhDoneText, wfhProgressText, wfhSourceText, wfhStepText } from '../wfh';
import { CancelWfhForm, HrCancelWfhForm, WfhDecisionForm } from '../wfh-forms';

// A work from home request (owner, 21 October 2026: "think about how should we handle the working from home in out
// erp"; asked, "Manager, then HR"), for the employee, the one who decides it first (the approver in charge), HR and the
// CEO; anyone else gets the 404 page, as the API says it isn't there. Its day, the reason, how many of its month's days
// its person has taken, how it came (asked, recorded by HR with the warnings it was recorded past, or imported from Zoho
// People), where it stands and who decides it, and its log of every step. While it waits for the user, their decision
// (Approve, or Reject with a comment); the employee's Cancel while it is being decided; HR's Cancel of an approved day,
// with a comment. What was just done on it shows at the top (?done=). A C-level person's has HR's stage decided by the
// CEO (or HR with Super Admin). Shown on the site and on the phone pages, where the back link goes to the section's list
// and what is done on it comes back there.

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

export async function WfhRequestDetail({
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
  const [user, loaded] = await Promise.all([getCurrentUser(), loadWfh(id)]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind === 'forbidden') return <Empty>This work from home request isn&apos;t yours to see.</Empty>;
  if (loaded.kind === 'failed') return <Empty>{notLoadedText(loaded, 'work from home request')}</Empty>;
  const r = loaded.value;
  const back = surface === 'site' ? wfhBack(user, r) : appBack(surface);
  const done = wfhDoneText(query, r.status, r.manager, r.confidential);
  const place = placeOfEmployee(r.employee);
  const progress = wfhProgressText(r);
  const what = `work from home request for ${wfhDayText(r)}`;
  const own = user.employeeId === r.employee.id;
  // the log as the leave timeline draws it, an import worded its own way (wfhStepText)
  const timeline = { ...r, steps: r.steps as unknown as LeaveRequestStep[] };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink href={back.href}>{back.label}</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">Work From Home</h1>
          <LeaveStatusBadge status={r.status} confidential={r.confidential} />
          {r.confidential && <CLevelBadge title="A C-level person: the CEO decides HR’s stage, and HR doesn’t see the request." />}
        </div>
        <p className="text-muted">
          {r.employee.fullNameEn}
          {place && ` · ${place}`} · {wfhSourceText(r).toLowerCase()} {formatDateTime(r.createdAt)}
        </p>
      </div>
      {done && (
        <p role="status" className={`rounded-lg px-4 py-3 text-sm ${done.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
          {done.text}
        </p>
      )}
      {/* recorded, approved or cancelled for a month whose payroll had moved on (27 October 2026) */}
      <PayrollLockedNotice months={r.payrollLocked} />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="The Day">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Fact label="Day">
                <span className="text-base font-semibold tabular-nums">{wfhDayText(r)}</span>
                <span className="block text-xs text-muted">A working day from home, not leave: checked in from home as any day</span>
              </Fact>
              {r.monthUsed !== null && (
                <Fact label="Its month">
                  <span className="tabular-nums">{r.monthUsed} taken</span>
                  <span className="block text-xs text-muted">Approved and waiting, this one counted</span>
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
                  <span className="text-muted">{wfhSourceText(r)}: no decision needed</span>
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
                Your other work from home requests are on <Link href={surface === 'site' ? MY_WFH_HREF : appRequestsHref('wfh')}>My Requests</Link>.
              </p>
            )}
          </Section>

          {r.waitingForYou && r.stage && (
            <Section title={`Your Decision as ${decidingAsTitle(user, r.stage, r.manager, r.confidential)}`}>
              {/* deciding it standing in for the approver on leave (owner, 25 October 2026: "To a stand-in") */}
              {standingInNoteText(r.standingInFor) && <p className="mb-4 rounded-lg bg-accent-soft px-4 py-3 text-sm">{standingInNoteText(r.standingInFor)}</p>}
              <WfhDecisionForm action={decideWfh.bind(null, r.id, r.stage)} stage={r.stage} name={r.employee.fullNameEn} confidential={r.confidential} />
            </Section>
          )}

          {r.canCancel && (
            <Section title="Cancel the Request">
              <p className="mb-3 text-sm text-muted">While it is being decided you can cancel it, e.g. to ask for another day.</p>
              <CancelWfhForm action={cancelMyWfh.bind(null, r.id)} what={what} />
            </Section>
          )}
          {!r.canCancel && r.hrCanCancel && (
            <Section title="Cancel the Day">
              <p className="mb-3 text-sm text-muted">An approved day HR cancels: they are expected at the office that day again, and see why.</p>
              <HrCancelWfhForm action={cancelWfhByHr.bind(null, r.id)} what={what} />
            </Section>
          )}
        </div>

        <Section title="Every Step">
          <LeaveTimeline request={timeline} stepText={wfhStepText} />
        </Section>
      </div>
    </div>
  );
}
