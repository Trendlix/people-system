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
import { LeaveStatusBadge, LeaveTimeline } from '../../../leave/ui';
import { BackLink, Empty, UUID } from '../../../organization/ui';
import { notLoadedText } from '../../../payroll/load';
import { cancelMyOd, cancelOdByHr, decideOd } from '../actions';
import { loadOd } from '../data';
import { MY_OD_HREF, odBack, odDoneText, odProgressText, odSourceText, odSpanText, odStepText, odWhenWords } from '../od';
import { CancelOdForm, HrCancelOdForm, OdDecisionForm } from '../od-forms';

// An official duty request (owner, 23 October 2026: "Official duty (OD) requests"; asked, "Manager, then HR", "Ahead
// or up to 3 days after"), for the employee, the one who decides it first (the approver in charge), HR and the CEO;
// anyone else gets the 404 page, as the API says it isn't there. Its days and hours, where, why, whether it was asked
// after its first day, where it stands and who decides it, and its log of every step. While it waits for the user,
// their decision (Approve, or Reject with a comment); the employee's Cancel while it is being decided; HR's Cancel of an
// approved one, with a comment. What was just done on it shows at the top (?done=). A C-level person's has HR's stage
// decided by the CEO (or HR with Super Admin). One HR recorded (owner, 26 October 2026: "HR records it") says so, with
// what it was recorded past (more than 3 days after); one a leave import brought over says it was imported. Shown on the
// site and on the phone pages, where the back link goes to the section's list and what is done on it comes back there.

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

export async function OdRequestDetail({
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
  const [user, loaded] = await Promise.all([getCurrentUser(), loadOd(id)]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind === 'forbidden') return <Empty>This official duty request isn&apos;t yours to see.</Empty>;
  if (loaded.kind === 'failed') return <Empty>{notLoadedText(loaded, 'official duty request')}</Empty>;
  const r = loaded.value;
  const back = surface === 'site' ? odBack(user, r) : appBack(surface);
  const done = odDoneText(query, r.status, r.manager, r.confidential);
  const place = placeOfEmployee(r.employee);
  const progress = odProgressText(r);
  const when = odWhenWords(r);
  const what = `official duty request for ${when}`;
  const own = user.employeeId === r.employee.id;
  // recorded by HR or imported (26 October 2026): no decision was asked for, and "requested after" isn't theirs
  const byHr = r.recordedByHr === true || r.imported === true;
  const warnings = r.warnings ?? [];
  // the log as the leave timeline draws it, HR's recording, an import and a cancelling worded their own way (odStepText)
  const timeline = { ...r, recordedByHr: r.recordedByHr === true, steps: r.steps as unknown as LeaveRequestStep[] };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink href={back.href}>{back.label}</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Official Duty</h1>
          <LeaveStatusBadge status={r.status} confidential={r.confidential} />
          {byHr ? (
            <span className="badge bg-line-soft text-muted">{odSourceText(r)}</span>
          ) : (
            r.late && (
              <span className="badge bg-warn-soft text-warn" title="Asked after its first day, within the 3 days allowed.">
                Requested after
              </span>
            )
          )}
          {r.confidential && <CLevelBadge title="A C-level person: the CEO decides HR’s stage, and HR doesn’t see the request." />}
        </div>
        <p className="text-muted">
          {r.employee.fullNameEn}
          {place && ` · ${place}`} · {byHr ? `${odSourceText(r).toLowerCase()} ${formatDateTime(r.createdAt)}` : `asked ${formatDateTime(r.createdAt)}`}
        </p>
      </div>
      {done && (
        <p role="status" className={`rounded-lg px-4 py-3 text-sm ${done.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
          {done.text}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="The Duty">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Fact label={r.startDate === r.endDate ? 'Day' : 'Days'}>
                <span className="text-base font-semibold tabular-nums">{when}</span>
                <span className="block text-xs text-muted">{odSpanText(r)}: a working day away from the office, not leave</span>
              </Fact>
              <Fact label="Where">
                <span className="whitespace-pre-line">{r.dutyPlace}</span>
              </Fact>
              <Fact label="Reason" wide>
                <span className="whitespace-pre-line">{r.reason}</span>
              </Fact>
              {r.late && !byHr && (
                <Fact label="Asked" wide>
                  <span className="text-warn">After its first day: requested after, within the 3 days allowed.</span>
                </Fact>
              )}
              {warnings.length > 0 && (
                <Fact label="Recorded past" wide>
                  <ul className="list-disc space-y-0.5 pl-5 text-warn">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Fact>
              )}
              <Fact label="Where it stands">
                {progress.text}
                {progress.reason && <span className="mt-0.5 block whitespace-pre-line text-muted">“{progress.reason}”</span>}
              </Fact>
              <Fact label={r.manager ? approverLabel(r.manager) : 'Direct manager'}>
                {byHr && r.status !== 'with_manager' && r.status !== 'with_hr' ? (
                  <span className="text-muted">{odSourceText(r)}: no decision needed</span>
                ) : r.manager ? (
                  r.manager.fullNameEn
                ) : (
                  <span className="text-muted">None: sent straight to {hrStageName(r.confidential)}</span>
                )}
              </Fact>
            </dl>
            {r.status === 'approved' && (
              <p className="mt-4 text-sm text-muted">
                On its days (or within its hours) the check-in is taken from where they are, without the office location or network, and the days count as
                attended for its hours.
              </p>
            )}
            {own && (
              <p className="mt-4 text-sm text-muted">
                Your other official duty requests are on <Link href={surface === 'site' ? MY_OD_HREF : appRequestsHref('od')}>My Requests</Link>.
              </p>
            )}
          </Section>

          {r.waitingForYou && r.stage && (
            <Section title={`Your Decision as ${decidingAsTitle(user, r.stage, r.manager, r.confidential)}`}>
              {/* deciding it standing in for the approver on leave (owner, 25 October 2026: "To a stand-in") */}
              {standingInNoteText(r.standingInFor) && <p className="mb-4 rounded-lg bg-accent-soft px-4 py-3 text-sm">{standingInNoteText(r.standingInFor)}</p>}
              <OdDecisionForm action={decideOd.bind(null, r.id, r.stage)} stage={r.stage} name={r.employee.fullNameEn} confidential={r.confidential} />
            </Section>
          )}

          {r.canCancel && (
            <Section title="Cancel the Request">
              <p className="mb-3 text-sm text-muted">While it is being decided you can cancel it, e.g. when the visit is called off.</p>
              <CancelOdForm action={cancelMyOd.bind(null, r.id)} what={what} />
            </Section>
          )}
          {!r.canCancel && r.hrCanCancel && (
            <Section title="Cancel the Official Duty">
              <p className="mb-3 text-sm text-muted">An approved official duty HR cancels: its days are expected as usual again, and the employee sees why.</p>
              <HrCancelOdForm action={cancelOdByHr.bind(null, r.id)} what={what} />
            </Section>
          )}
        </div>

        <Section title="Every Step">
          <LeaveTimeline request={timeline} stepText={odStepText} />
        </Section>
      </div>
    </div>
  );
}
