import { notFound } from 'next/navigation';
import { CLevelBadge } from '@/components/c-level-badge';
import { DocumentViewer } from '@/components/document-viewer';
import { StandingInNote } from '@/components/standing-in-note';
import { approverLabel } from '@/lib/department-leads';
import { formatDate, formatDateTime, titleCase } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { appBack, type Surface } from '@/lib/surface';
import type { ReimbursementClaimView } from '@/lib/types';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { BackLink, Empty, UUID } from '../../organization/ui';
import { notLoadedText } from '../../payroll/load';
import { cancelClaim, decideClaim } from '../actions';
import { CancelClaimForm, DecisionForm } from '../claim-forms';
import { sizeText } from '../claim';
import { loadClaim } from '../data';
import { claimBack, currentAmount, decidingAsTitle, doneText, lowerApproved, payMonthOf, placeOfClaim, receiptHref } from '../list';
import { ClaimProgress, ClaimStatusBadge, ClaimTimeline } from '../ui';

// A reimbursement claim (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific preset
// up conditions"), for the employee who claimed it, their direct manager, HR, Finance and the CEO (anyone else gets the
// 404 page: the API says it isn't there): what was claimed and for what, the receipts in the document viewer, where it
// stands and the payroll it is paid with, and its log of every step. While it waits for the user, their decision
// (Approve, Approve a lower amount, Reject, with a comment for the last two); while it is being decided, the employee's
// Cancel. What was just done on it shows at the top (?done=). Someone without a direct manager has it decided first by
// their team lead, else their department's head (owner, 19 October 2026: "i want to add department lead person, the
// person in charge"): the page says which. A C-level person's claim (owner, 19 October 2026: "make C level Employees
// details not visible to HR") has HR's and Finance's stages decided by the CEO (or HR, or Finance, with Super Admin): it
// says so ("With the CEO"), and the CEO gets the decision form at each when it waits for them (`waitingForYou`).
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

/** The receipts, each opened in the document viewer on its own (fetched only then, under the web domain). */
function Receipts({ claim: c }: { claim: ReimbursementClaimView }) {
  if (!c.receipts.length) {
    return <p className="text-sm text-muted">{c.type.receiptRequired ? 'No receipt attached.' : 'No receipt attached; this type needs none.'}</p>;
  }
  return (
    <ul className="divide-y divide-line-soft">
      {c.receipts.map((r, i) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
          <span className="min-w-0 break-all">
            {r.fileName || `Receipt ${i + 1}`}{' '}
            <span className="text-muted tabular-nums">
              · {r.mimeType === 'application/pdf' ? 'PDF' : 'Photo'} · {sizeText(r.sizeBytes)}
            </span>
          </span>
          <DocumentViewer
            title={`Receipt ${i + 1} · ${c.type.nameEn} · ${c.employee.fullNameEn}`}
            files={[{ alt: `Receipt ${i + 1} of the ${c.type.nameEn} claim by ${c.employee.fullNameEn}`, src: receiptHref(c.id, r.id), mimeType: r.mimeType }]}
          >
            View<span className="sr-only"> {r.fileName}</span>
          </DocumentViewer>
        </li>
      ))}
    </ul>
  );
}

export async function ClaimDetail({
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
  const [user, loaded] = await Promise.all([getCurrentUser(), loadClaim(id)]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind === 'forbidden') return <Empty>This claim isn&apos;t yours to see.</Empty>;
  if (loaded.kind === 'failed') return <Empty>{notLoadedText(loaded, 'claim')}</Empty>;
  const c = loaded.value;
  const back = surface === 'site' ? claimBack(user, c) : appBack(surface);
  const done = doneText(query, c.status, c.manager, c.confidential);
  const place = placeOfClaim(c.employee);
  const lower = lowerApproved(c);
  const month = payMonthOf(c);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink href={back.href}>{back.label}</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">{titleCase(`${c.type.nameEn} claim`)}</h1>
          <ClaimStatusBadge status={c.status} confidential={c.confidential} />
          {c.confidential && <CLevelBadge title="A C-level person: the CEO decides HR’s and Finance’s stages, and neither sees the claim." />}
        </div>
        <p className="text-muted">
          {c.employee.fullNameEn}
          {place && ` · ${place}`} · sent {formatDateTime(c.createdAt)}
        </p>
      </div>
      {done && (
        <p role="status" className={`rounded-lg px-4 py-3 text-sm ${done.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
          {done.text}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="The Claim">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Fact label="Type">
                {c.type.nameEn}{' '}
                <span lang="ar" dir="rtl" className="inline-block text-muted">
                  {c.type.nameAr}
                </span>
              </Fact>
              <Fact label="Date of the expense">
                <span className="tabular-nums">{formatDate(c.expenseDate)}</span>
              </Fact>
              <Fact label="Amount claimed">
                <span className="text-base font-semibold tabular-nums">{formatEgp(c.amount)}</span>
              </Fact>
              {c.approvedAmount !== null && c.status !== 'rejected' && (
                <Fact label={c.status === 'approved' ? 'Amount approved' : 'Approved so far'}>
                  <span className="text-base font-semibold tabular-nums">{formatEgp(c.approvedAmount)}</span>
                  {lower !== null && <span className="block text-xs text-muted">Less than claimed: see the comment in the log.</span>}
                </Fact>
              )}
              <Fact label="What it was for" wide>
                <span className="whitespace-pre-line">{c.description}</span>
              </Fact>
              <Fact label="Where it stands">
                <ClaimProgress claim={c} />
              </Fact>
              <Fact label={c.manager ? approverLabel(c.manager) : 'Direct manager'}>
                {c.manager ? c.manager.fullNameEn : <span className="text-muted">None: sent straight to {c.confidential ? 'the CEO' : 'HR'}</span>}
              </Fact>
              {month && <Fact label="Paid with">{`The ${month} payroll, untaxed`}</Fact>}
            </dl>
          </Section>

          <Section title="Receipts">
            <Receipts claim={c} />
          </Section>

          {c.waitingForYou && c.stage && (
            <Section title={`Your Decision as ${decidingAsTitle(user, c.stage, `the ${titleCase(approverLabel(c.manager))}`, c.confidential)}`}>
              {/* deciding the manager step for a manager on leave (owner, 25 October 2026: "To a stand-in") */}
              {c.standingInFor && (
                <div className="mb-4">
                  <StandingInNote person={c.standingInFor} />
                </div>
              )}
              <DecisionForm
                action={decideClaim.bind(null, c.id, currentAmount(c), c.stage)}
                stage={c.stage}
                current={currentAmount(c)}
                name={c.employee.fullNameEn}
                confidential={c.confidential}
              />
            </Section>
          )}

          {c.canCancel && (
            <Section title="Cancel the Claim">
              <p className="mb-3 text-sm text-muted">While it is being decided you can cancel it, e.g. to send it again with another amount or receipt.</p>
              <CancelClaimForm action={cancelClaim.bind(null, c.id)} what={`${c.type.nameEn} claim of ${formatEgp(c.amount)}`} />
            </Section>
          )}
        </div>

        <Section title="Every Step">
          <ClaimTimeline claim={c} />
        </Section>
      </div>
    </div>
  );
}
