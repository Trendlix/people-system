import { notFound } from 'next/navigation';
import { coverRequired, LEAVE_PAY_LABELS } from '@trendlix/shared';
import { CLevelBadge } from '@/components/c-level-badge';
import { DocumentViewer } from '@/components/document-viewer';
import { StandingInNote } from '@/components/standing-in-note';
import { formatDateTime, titleCase } from '@/lib/format';
import { approverLabel } from '@/lib/department-leads';
import { actionablePeople } from '@/lib/confidential';
import { withCode } from '@/lib/hidden';
import { getCurrentUser } from '@/lib/session';
import { appBack, type Surface } from '@/lib/surface';
import type { EmployeeProfile, EmployeeSummary, LeaveRequestView } from '@/lib/types';
import { getOrNull } from '../../approvals/data';
import { todayInCairo } from '../../employees/ui';
import { sizeText } from '../../reimbursements/claim';
import { BackLink, Empty, UUID } from '../../organization/ui';
import { notLoadedText } from '../../payroll/load';
import { cancelLeaveByHr, cancelMyLeave, changeLeaveCover, decideLeave, editLeave, restoreLeave } from '../actions';
import { standInText } from '../coverage';
import { RequestCoverage } from '../coverage-fields';
import { CancelLeaveForm, ChangeCoverForm, EditLeaveForm, HrCancelLeaveForm, LeaveDecisionForm, RestoreLeaveForm } from '../leave-forms';
import { loadEmployeeLeave, loadHolidaysOf, loadLeaveCoverage, loadLeaveRequest, loadLeaveTypes, loadOwnCoverage } from '../data';
import { daysNumber, daysText, decidingAsTitle, hrStageName, leaveBack, leaveDocumentHref, leaveDoneText, periodText, placeOfEmployee, recordsLeave } from '../list';
import { editTypes } from '../edit';
import { restoreWarning } from '../restore';
import { personFacts } from '../request';
import { LeaveProgress, LeaveStatusBadge, LeaveTimeline, OverLimitBadge, PayrollLockedNotice } from '../ui';

// A leave request (owner, 18 October 2026: "can you apply the leaves according to the law?"), for the employee, their
// direct manager, HR and the CEO (anyone else gets the 404 page: the API says it isn't there): the type and its pay, when
// and how many days (as the law counts them: working days, the holidays and rest days left out, Art. 124), the reason,
// the documents in the document viewer, where it stands and the annual balance after it, and its log of every step.
// While it waits for the user, their decision (Approve, or Reject with a comment); the employee's Cancel while it is
// being decided or before it starts; HR's Cancel of an approved one, with a comment, its days given back. What was just
// done on it shows at the top (?done=). Someone without a direct manager has it decided first by their team lead, else
// their department's head (owner, 19 October 2026: "i want to add department lead person, the person in charge"): the
// page says which. A C-level person's request (owner, 19 October 2026: "make C level Employees details not visible to
// HR") has HR's stage decided by the CEO (or HR with Super Admin): it says so ("With the CEO"), and the CEO gets the
// decision form when it waits for them (`waitingForYou`, the API's).
// Shown on the site and on the phone pages (owner, 20 October 2026: the employee app, "managers and team leads approve
// from the phone"), where the back link goes to the section's list and what is done on it comes back there.
// Leave coverage (owner, 25 October 2026: "Names, no leave types", "Warn and need HR", "Required over 2 days", "To a
// stand-in"): while it is being decided or approved, who else of the team is off on its days (its employee reads names
// only, an approver names and "leave", HR and the CEO the types), "N of M at work", the clash with the team's staffing
// limit highlighted ("Over the staffing limit": HR approves it too) and the colleagues its employee covers then; the
// colleague who covers it and the handover note, which its employee may change; an approver's stand-in for its days (to
// its employee, HR and the CEO); and "Standing in for Ahmed" when the user decides it for an approver on leave.

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

/** The documents, each opened in the document viewer on its own (fetched only then, under the web domain). */
function Documents({ request: r }: { request: LeaveRequestView }) {
  if (!r.documents.length) return <p className="text-sm text-muted">No document attached.</p>;
  return (
    <ul className="divide-y divide-line-soft">
      {r.documents.map((d, i) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
          <span className="min-w-0 break-all">
            {d.fileName || `Document ${i + 1}`}{' '}
            <span className="text-muted tabular-nums">
              · {d.mimeType === 'application/pdf' ? 'PDF' : 'Photo'} · {sizeText(d.sizeBytes)}
            </span>
          </span>
          <DocumentViewer
            title={`Document ${i + 1} · ${r.type.nameEn} · ${r.employee.fullNameEn}`}
            files={[{ alt: `Document ${i + 1} of the ${r.type.nameEn} request by ${r.employee.fullNameEn}`, src: leaveDocumentHref(r.id, d.id), mimeType: d.mimeType }]}
          >
            View<span className="sr-only"> {d.fileName}</span>
          </DocumentViewer>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the Edit the Leave form needs, for a Super Admin (owner, 26 October 2026): the types, the employee's shift days and
 * gender, their balances and the holidays of the leave's year (the form reads another year's when the first day moves), and
 * the colleagues who may cover it. Null: the types couldn't be read.
 */
async function loadEditData(r: LeaveRequestView) {
  const year = Number(r.startDate.slice(0, 4));
  const [types, profile, leave, holidays, people] = await Promise.all([
    loadLeaveTypes(),
    getOrNull<EmployeeProfile>(`/employees/${encodeURIComponent(r.employee.id)}`),
    loadEmployeeLeave(r.employee.id, year),
    loadHolidaysOf(year),
    getOrNull<EmployeeSummary[]>('/employees'),
  ]);
  if (types.kind !== 'ok') return null;
  const facts = profile ? personFacts(profile) : null;
  return {
    types: editTypes(types.value, r.type.id, facts?.gender ?? null),
    workingDays: facts?.workingDays ?? null,
    initial: { year, balances: leave.kind === 'ok' ? leave.value : null, holidays: holidays.kind === 'ok' ? holidays.value : [] },
    colleagues: people
      ? actionablePeople(people)
          .filter((p) => p.employment)
          .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn, 'en'))
          .map((p) => ({ id: p.id, label: withCode(p.fullNameEn, p.employeeCode) }))
      : null,
  };
}

export async function LeaveRequestDetail({
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
  const [user, loaded] = await Promise.all([getCurrentUser(), loadLeaveRequest(id)]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind === 'forbidden') return <Empty>This leave request isn&apos;t yours to see.</Empty>;
  if (loaded.kind === 'failed') return <Empty>{notLoadedText(loaded, 'leave request')}</Empty>;
  const r = loaded.value;
  // who else is off on its days, while it is being decided or approved; the colleagues who may cover it, for its employee
  // changing the cover (25 October 2026)
  const live = r.status === 'with_manager' || r.status === 'with_hr' || r.status === 'approved';
  const [coverage, own] = await Promise.all([live ? loadLeaveCoverage(r.id) : null, r.canChangeCover ? loadOwnCoverage(r) : null]);
  // a Super Admin's edit form (26 October 2026)
  const editing = r.canEdit ? await loadEditData(r) : null;
  const back = surface === 'site' ? leaveBack(user, r) : appBack(surface);
  const done = leaveDoneText(query, r.status, r.manager, r.confidential);
  const place = placeOfEmployee(r.employee);
  const what = `${r.type.nameEn.toLowerCase()} (${periodText(r)})`;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink href={back.href}>{back.label}</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">{titleCase(r.type.nameEn)}</h1>
          <LeaveStatusBadge status={r.status} confidential={r.confidential} />
          {r.overStaffingLimit && <OverLimitBadge />}
          {r.confidential && <CLevelBadge title="A C-level person: the CEO decides HR’s stage, and HR doesn’t see the request." />}
        </div>
        <p className="text-muted">
          {r.employee.fullNameEn}
          {place && ` · ${place}`} · {r.recordedByHr ? 'recorded by HR' : 'sent'} {formatDateTime(r.createdAt)}
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
          <Section title="The Leave">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Fact label="Type">
                {r.type.nameEn}{' '}
                <span lang="ar" dir="rtl" className="inline-block text-muted">
                  {r.type.nameAr}
                </span>
                <span className="block text-xs text-muted">{LEAVE_PAY_LABELS[r.type.paid] ?? r.type.paid}</span>
              </Fact>
              <Fact label="When">
                <span className="tabular-nums">{periodText(r)}</span>
              </Fact>
              <Fact label="Days">
                <span className="text-base font-semibold tabular-nums">{daysText(r.days)}</span>
              </Fact>
              {r.balanceAfter !== null && (
                <Fact label="Annual balance after it">
                  <span className="text-base font-semibold tabular-nums">{daysNumber(r.balanceAfter)}</span>
                  <span className="block text-xs text-muted">Available once this is taken</span>
                </Fact>
              )}
              {r.reason && (
                <Fact label="Reason" wide>
                  <span className="whitespace-pre-line">{r.reason}</span>
                </Fact>
              )}
              <Fact label="Where it stands">
                <LeaveProgress request={r} />
              </Fact>
              <Fact label={r.manager ? approverLabel(r.manager) : 'Direct manager'}>
                {r.recordedByHr ? (
                  <span className="text-muted">Recorded by HR: no decision needed</span>
                ) : r.manager ? (
                  r.manager.fullNameEn
                ) : (
                  <span className="text-muted">None: sent straight to {hrStageName(r.confidential)}</span>
                )}
              </Fact>
              {r.overStaffingLimit && (
                <Fact label="Staffing limit">
                  <span className="text-warn">Over its team’s limit when sent</span>
                  <span className="block text-xs text-muted">So {hrStageName(r.confidential)} approves it too, after the manager.</span>
                </Fact>
              )}
              {r.cover !== undefined && (
                <Fact label="Covered by">
                  {r.cover ? r.cover.fullNameEn : <span className="text-muted">Nobody named</span>}
                  {r.cover && <span className="block text-xs text-muted">Told, and sees the handover note</span>}
                </Fact>
              )}
              {r.standIn && (
                <Fact label="Stand-in">
                  {standInText(r.standIn)}
                  <span className="block text-xs text-muted">Decides what waits for {r.employee.fullNameEn} during these days, once approved</span>
                </Fact>
              )}
              {r.handoverNote && (
                <Fact label="Handover note" wide>
                  <span className="whitespace-pre-line">{r.handoverNote}</span>
                </Fact>
              )}
            </dl>
          </Section>

          {coverage?.kind === 'ok' && (
            <Section title="Who Else Is Off">
              <RequestCoverage coverage={coverage.value} employeeName={r.employee.fullNameEn} />
            </Section>
          )}
          {coverage?.kind === 'failed' && (
            <Section title="Who Else Is Off">
              <p className="text-sm text-muted">{notLoadedText(coverage, 'who else is off')}</p>
            </Section>
          )}

          <Section title="Documents">
            <Documents request={r} />
          </Section>

          {r.waitingForYou && r.stage && (
            <Section title={`Your Decision as ${decidingAsTitle(user, r.stage, r.manager, r.confidential)}`}>
              {r.standingInFor && (
                <div className="mb-4">
                  <StandingInNote person={r.standingInFor} />
                </div>
              )}
              <LeaveDecisionForm action={decideLeave.bind(null, r.id, r.stage)} stage={r.stage} name={r.employee.fullNameEn} confidential={r.confidential} />
            </Section>
          )}

          {r.canChangeCover && (
            <Section title="Who Covers It">
              <p className="mb-3 text-sm text-muted">
                {r.cover ? `${r.cover.fullNameEn} covers your work on these days.` : 'Nobody is named to cover your work on these days.'} If they can’t any more, choose
                someone else: both are told.
              </p>
              <ChangeCoverForm
                action={changeLeaveCover.bind(null, r.id)}
                cover={r.cover ?? null}
                note={r.handoverNote ?? null}
                candidates={own?.kind === 'ok' ? own.value.cover.candidates : null}
                required={!r.recordedByHr && coverRequired(r.type.key, r.days)}
                groupName={own?.kind === 'ok' ? (own.value.group?.nameEn ?? null) : null}
              />
            </Section>
          )}

          {r.canEdit && (
            <Section title="Edit the Leave">
              {editing ? (
                <EditLeaveForm
                  // a form again once saved: it opens with the leave as it is then
                  key={`${r.type.id}|${r.startDate}|${r.endDate}|${r.halfDay}|${r.reason ?? ''}|${r.cover?.id ?? ''}|${r.steps.length}`}
                  action={editLeave.bind(null, r.id)}
                  request={r}
                  types={editing.types}
                  person={{ workingDays: editing.workingDays }}
                  initial={editing.initial}
                  colleagues={editing.colleagues}
                  today={todayInCairo()}
                />
              ) : (
                <p className="text-sm text-muted">The leave types couldn’t be loaded, so it can’t be edited now. Please try again in a moment.</p>
              )}
            </Section>
          )}

          {r.canRestore && (
            <Section title="Undo the Cancellation">
              <p className="mb-3 text-sm text-muted">
                Put the leave back where it stood before it was cancelled, then edit its dates if they were wrong. It is checked as an edit is: no clash with other
                leave, the year open, and no payroll month with the CEO, approved or paid.
              </p>
              <RestoreLeaveForm action={restoreLeave.bind(null, r.id)} what={what} warning={restoreWarning(r)} />
            </Section>
          )}

          {r.canCancel && (
            <Section title="Cancel the Leave">
              <p className="mb-3 text-sm text-muted">
                {r.status === 'approved'
                  ? 'Approved and not started yet: you can still cancel it, and its days go back to your balance.'
                  : 'While it is being decided you can cancel it, e.g. to ask again for other days.'}
              </p>
              <CancelLeaveForm action={cancelMyLeave.bind(null, r.id)} what={what} />
            </Section>
          )}
          {!r.canCancel && (r.hrCanCancel ?? (recordsLeave(user) && r.status === 'approved' && user.employeeId !== r.employee.id)) && (
            <Section title="Cancel the Leave">
              <p className="mb-3 text-sm text-muted">Approved leave HR cancels gives its days back to the balance; the employee sees why.</p>
              <HrCancelLeaveForm action={cancelLeaveByHr.bind(null, r.id)} what={what} />
            </Section>
          )}
        </div>

        <Section title="Every Step">
          <LeaveTimeline request={r} />
        </Section>
      </div>
    </div>
  );
}
