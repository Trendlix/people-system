import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import {
  CLEARANCE_ITEM_STATUS_LABELS,
  CLEARANCE_OWNER_LABELS,
  CUSTODY_KIND_LABELS,
  END_REASON_LABELS,
  EXIT_INTERVIEW_STATUS_LABELS,
  EXIT_RATING_LABELS,
  EXIT_RATINGS,
  EXIT_REASON_LABELS,
  EXIT_RECOMMEND_LABELS,
  exitRatingAverage,
  OFFBOARDING_STATUS_LABELS,
  REHIRE_LABELS,
  type EndReason,
  type OffboardingCaseView,
} from '@trendlix/shared';
import { CUSTODY_PATHS } from '@/lib/asset-paths';
import { formatDate, formatDateTime } from '@/lib/format';
import { BackLink, Empty, Loading, UUID } from '../../organization/ui';
import { addItem, completeCase, declineInterview, markItem, recordInterview, setRehire } from '../actions';
import { loadCase, offboardingNotLoaded } from '../data';
import { AddItemForm, CompleteForm, DeclineForm, ExitInterviewForm, ItemActions, RehireForm } from '../forms';
import { casePrintHref, ITEM_STYLE, OFFBOARDING_PATH, progressText, REHIRE_STYLE, STATUS_STYLE } from '../offboarding';
import { joinShown } from '@/lib/hidden';

// An offboarding case (owner, 22 October 2026: the full module: "clearance checklist (assets returned, laptop, access),
// exit interview, rehire eligibility"): who is leaving and when, the clearance checklist (each item cleared by its owner,
// or by HR, the CEO or a Super Admin; Assets returned and Final settlement paid ticked by the system, with what they still
// hold and the settlement's state), the exit interview (theirs, HR's record, or declined), rehire eligibility, their
// sign-in, and completing the case (a Super Admin anyway, with the reason). Those who only clear items see the
// checklist alone. Print clearance form prints it with signature lines.

export const metadata: Metadata = { title: 'Offboarding Case · People System' };

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="card space-y-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Checklist({ c }: { c: OffboardingCaseView }) {
  return (
    <ol className="divide-y divide-line-soft">
      {c.items.map((i) => (
        <li key={i.id} className="space-y-2 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">{i.label}</p>
              <p className="text-xs text-muted">
                {CLEARANCE_OWNER_LABELS[i.owner]}
                {i.kind !== 'manual' && ' · ticked by the system'}
                {i.doneBy && ` · ${i.doneBy}`}
                {i.doneAt && `, ${formatDateTime(i.doneAt)}`}
              </p>
              {i.note && <p className="mt-1 text-sm">{i.note}</p>}
            </div>
            <span className={`badge ${ITEM_STYLE[i.status]}`}>{CLEARANCE_ITEM_STATUS_LABELS[i.status]}</span>
          </div>
          {i.kind === 'assets' && c.status === 'open' && i.status === 'pending' && (
            <p className="text-sm text-muted">Done once everything they hold is received back on Custody.</p>
          )}
          {i.kind === 'final_settlement' && c.status === 'open' && i.status === 'pending' && c.finalSettlement && (
            <p className="text-sm text-muted">
              {c.finalSettlement.status === 'not_yet' ? 'Their final settlement opens once the employment has ended.' : 'Done once it is marked settled under '}
              {c.finalSettlement.status === 'open' && <Link href="/payroll/unsettled#settlements">Payroll → Unsettled</Link>}
              {c.finalSettlement.status === 'open' && '.'}
            </p>
          )}
          {i.canMark && <ItemActions action={markItem.bind(null, c.id, i.id)} status={i.status} note={i.note} />}
        </li>
      ))}
    </ol>
  );
}

function Holdings({ c }: { c: OffboardingCaseView }) {
  if (!c.holdings.length) return <p className="text-sm text-muted">They hold nothing in custody.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Custody Record</th>
            <th>Return By</th>
          </tr>
        </thead>
        <tbody>
          {c.holdings.map((h) => (
            <tr key={`${h.custodyCode}-${h.assetCode}`}>
              <td>
                <span className="font-mono text-sm">{h.assetCode}</span> {h.assetName}
              </td>
              <td>
                <Link href={CUSTODY_PATHS.record(h.custodyCode)} className="font-mono text-sm">
                  {h.custodyCode}
                </Link>
                <div className="text-xs text-muted">{CUSTODY_KIND_LABELS[h.custodyKind as keyof typeof CUSTODY_KIND_LABELS] ?? h.custodyKind}</div>
              </td>
              <td className="tabular-nums">{h.dueDate ? formatDate(h.dueDate) : <span className="text-muted">At clearance</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm text-muted">Receive each back on its custody record. Anything missing or damaged goes to HR for a deduction there.</p>
    </div>
  );
}

function Interview({ c }: { c: OffboardingCaseView }) {
  const i = c.interview!;
  if (i.status === 'submitted' && i.answers) {
    const a = i.answers;
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          {i.filledBy === 'employee' ? 'Sent by them' : 'Recorded by HR'}
          {i.recordedBy && ` · ${i.recordedBy}`}
          {i.recordedAt && `, ${formatDateTime(i.recordedAt)}`}
        </p>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[14rem_1fr]">
          <dt className="text-muted">Main reason for leaving</dt>
          <dd>{EXIT_REASON_LABELS[a.reason]}</dd>
          {EXIT_RATINGS.map((k) => (
            <div key={k} className="contents">
              <dt className="text-muted">{EXIT_RATING_LABELS[k]}</dt>
              <dd className="tabular-nums">{a.ratings[k]} of 5</dd>
            </div>
          ))}
          <dt className="text-muted">Average</dt>
          <dd className="tabular-nums">{exitRatingAverage(a.ratings)} of 5</dd>
          <dt className="text-muted">Would recommend working here</dt>
          <dd>{EXIT_RECOMMEND_LABELS[a.recommend]}</dd>
          {a.comments && (
            <>
              <dt className="text-muted">Comments</dt>
              <dd className="whitespace-pre-line">{a.comments}</dd>
            </>
          )}
        </dl>
        {c.can.interview && (
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-accent">Correct HR&apos;s record</summary>
            <div className="pt-4">
              <ExitInterviewForm action={recordInterview.bind(null, c.id)} submitLabel="Save the exit interview" />
            </div>
          </details>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {i.status === 'declined'
          ? `Declined${i.declinedNote ? `: ${i.declinedNote}` : ''}${i.recordedBy ? ` · ${i.recordedBy}` : ''}.`
          : 'Not done yet. They can fill it in under My Requests while they can still sign in; or record it here from a conversation with them.'}
      </p>
      {c.can.interview && (
        <>
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-accent">Record it</summary>
            <div className="pt-4">
              <ExitInterviewForm action={recordInterview.bind(null, c.id)} submitLabel="Save the exit interview" />
            </div>
          </details>
          {i.status === 'pending' && <DeclineForm action={declineInterview.bind(null, c.id)} label="They declined it" />}
        </>
      )}
    </div>
  );
}

async function Case({ params }: { params: PageProps<'/offboarding/[id]'>['params'] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const loaded = await loadCase(id);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{offboardingNotLoaded(loaded, 'offboarding case')}</Empty>;
  const c = loaded.value;
  const pending = c.items.filter((i) => i.status === 'pending').length;
  return (
    <>
      <BackLink href={OFFBOARDING_PATH}>Offboarding</BackLink>
      <section className="card space-y-3 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{c.employee.fullNameEn}</h1>
          <span className={`badge ${STATUS_STYLE[c.status]}`}>{OFFBOARDING_STATUS_LABELS[c.status]}</span>
          {c.rehire && <span className={`badge ${REHIRE_STYLE[c.rehire]}`}>Rehire: {REHIRE_LABELS[c.rehire]}</span>}
        </div>
        <p className="text-muted">{joinShown([c.jobTitle, c.department, c.employee.employeeCode])}</p>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="text-muted">Joined</dt>
          <dd className="tabular-nums">{formatDate(c.joinDate)}</dd>
          <dt className="text-muted">Last working day</dt>
          <dd className="tabular-nums">
            {c.lastWorkingDay ? formatDate(c.lastWorkingDay) : '—'}
            {c.lastDayAgreed ? ' · agreed' : ''}
            {c.lastDayAgreed && c.ending?.noticeEndsOn ? ` · notice ends ${formatDate(c.ending.noticeEndsOn)}` : ''}
            {c.ended ? ' · employment ended' : ''}
          </dd>
          {c.endReason && (
            <>
              <dt className="text-muted">Reason</dt>
              <dd>{END_REASON_LABELS[c.endReason as EndReason] ?? c.endReason}</dd>
            </>
          )}
          {c.ending && (
            <>
              <dt className="text-muted">Ending</dt>
              <dd>
                {c.ending.rule}, notice given {formatDate(c.ending.noticeGivenOn)}
                {c.ending.reason && <span className="text-muted"> · {c.ending.reason}</span>}
              </dd>
            </>
          )}
          <dt className="text-muted">Clearance</dt>
          <dd>{progressText(c.progress)}</dd>
          {c.completedAt && (
            <>
              <dt className="text-muted">Completed</dt>
              <dd>
                {formatDateTime(c.completedAt)}
                {c.completedBy && ` · ${c.completedBy}`}
                {c.overrideReason && <span className="text-warn"> · with items pending: {c.overrideReason}</span>}
              </dd>
            </>
          )}
        </dl>
        {c.can.manage && (
          <div>
            <Link href={casePrintHref(c.id)} className="btn btn-secondary no-underline">
              Print clearance form
            </Link>
          </div>
        )}
      </section>

      <Section title="Clearance Checklist" aside={<span className="text-sm text-muted tabular-nums">{progressText(c.progress)}</span>}>
        <Checklist c={c} />
        {c.can.addItem && (
          <div className="border-t border-line pt-4">
            <h3 className="mb-2 font-semibold">Add an Item</h3>
            <AddItemForm action={addItem.bind(null, c.id)} />
          </div>
        )}
      </Section>

      {(c.can.manage || c.holdings.length > 0) && (
        <Section title="What They Hold">
          <Holdings c={c} />
        </Section>
      )}

      {c.interview && (
        <Section title="Exit Interview" aside={<span className="text-sm text-muted">{EXIT_INTERVIEW_STATUS_LABELS[c.interview.status]}</span>}>
          <Interview c={c} />
        </Section>
      )}

      {c.can.rehire && (
        <Section title="Rehire Eligibility">
          {c.rehire && c.rehireSetBy && (
            <p className="text-sm text-muted">
              {REHIRE_LABELS[c.rehire]}, set by {c.rehireSetBy}
              {c.rehireReason && `: ${c.rehireReason}`}
            </p>
          )}
          <RehireForm action={setRehire.bind(null, c.id)} eligibility={c.rehire} reason={c.rehireReason} />
        </Section>
      )}

      {c.signIn && (
        <Section title="Sign-In">
          <p className="text-sm">
            {c.signIn.email && <span className="font-medium">{c.signIn.email}: </span>}
            {c.signIn.note}
          </p>
        </Section>
      )}

      {c.can.complete && (
        <Section title="Complete the Case">
          <CompleteForm action={completeCase.bind(null, c.id)} pending={pending} override={c.can.override} />
        </Section>
      )}
    </>
  );
}

export default function OffboardingCasePage({ params }: PageProps<'/offboarding/[id]'>) {
  return (
    <div className="max-w-5xl space-y-6">
      <Suspense fallback={<Loading />}>
        <Case params={params} />
      </Suspense>
    </div>
  );
}
