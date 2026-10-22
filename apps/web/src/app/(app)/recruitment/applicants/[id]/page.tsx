import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { APPLICATION_EVENT_LABELS, APPLICATION_SOURCE_LABELS, type ApplicationAnswerView, type ApplicationView } from '@trendlix/shared';
import { formatDate, formatDateTime } from '@/lib/format';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { RehireWarning } from '../../../offboarding/rehire-warning';
import { moveApplicant, restoreApplicant, saveApplicantNotes } from '../../actions';
import { loadApplicant, recruitmentNotLoaded } from '../../data';
import { ActionButton, NotesForm, ReasonButton } from '../../forms';
import { applicantCvHref, makeOfferHref, matchText, vacancyHref } from '../../recruitment';
import { StageBadge } from '../../ui';

// An applicant (owner, 22 October 2026: "where will we include the ATS?"): who they are, their match and how each answer
// did (a must-have failed filters them out: kept, restorable), their CV, HR's notes, what can be done now (shortlist,
// move to interview, reject with a reason, restore, Make offer: the job offer form filled in from them and the vacancy),
// the job offers made to them and their history. A warning when they worked here before (offboarding's rehire check).

export const metadata: Metadata = { title: 'Applicant · People System' };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  );
}

function answerText(a: ApplicationAnswerView): string {
  if (a.answer === null || a.answer === '') return '—';
  if (a.kind === 'yes_no') return a.answer === 'yes' ? 'Yes' : 'No';
  return String(a.answer);
}

function Actions({ a }: { a: ApplicationView }) {
  const c = a.can;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {c.makeOffer && (
        <Link href={makeOfferHref(a.id)} className="btn btn-primary no-underline">
          Make offer
        </Link>
      )}
      {c.shortlist && <ActionButton action={moveApplicant.bind(null, a.id, 'shortlisted')} label={a.stage === 'interview' ? 'Back to shortlisted' : 'Shortlist'} pendingLabel="Saving…" kind={a.stage === 'applied' ? 'primary' : 'secondary'} />}
      {c.interview && <ActionButton action={moveApplicant.bind(null, a.id, 'interview')} label="Move to interview" pendingLabel="Saving…" />}
      {c.restore && <ActionButton action={restoreApplicant.bind(null, a.id)} label="Restore" pendingLabel="Restoring…" kind="primary" />}
      {c.reject && <ReasonButton action={moveApplicant.bind(null, a.id, 'rejected')} label="Reject" pendingLabel="Rejecting…" reasonLabel="Why (kept with the application, never sent)" required kind="danger" />}
    </div>
  );
}

async function Applicant({ params }: { params: PageProps<'/recruitment/applicants/[id]'>['params'] }) {
  const { id } = await params;
  const loaded = await loadApplicant(id);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'applicant')}</Empty>;
  const a = loaded.value;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink href={vacancyHref(a.vacancy.id)}>{a.vacancy.title}</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{a.fullName}</h1>
          <StageBadge stage={a.stage} filteredOut={a.filteredOut} />
        </div>
        <p className="text-sm text-muted">
          {a.number} · applied {formatDateTime(a.appliedAt)} · {APPLICATION_SOURCE_LABELS[a.source]}
        </p>
      </div>

      {a.stage !== 'hired' && <RehireWarning email={a.email} />}

      {a.rejectReason && (
        <div role="note" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          <p className="font-semibold">Rejected</p>
          <p>{a.rejectReason}</p>
        </div>
      )}
      {a.filteredOut && (
        <div role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          They didn&apos;t meet a must-have question, so they were filtered out. Restore them to consider them anyway.
        </div>
      )}

      <Actions a={a} />

      <section aria-labelledby="applicant-details" className="card space-y-4 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="applicant-details" className="text-lg font-semibold">
            Details
          </h2>
          <p className="text-sm">
            Match <span className="font-semibold tabular-nums">{matchText(a.matchPercent)}</span>
            {a.maxPoints > 0 && (
              <span className="text-muted tabular-nums">
                {' '}
                ({a.points} of {a.maxPoints} points)
              </span>
            )}
          </p>
        </div>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact label="Email">
            <a href={`mailto:${a.email}`}>{a.email}</a>
          </Fact>
          <Fact label="Mobile">
            <a href={`tel:${a.mobile.replace(/[^\d+]/g, '')}`}>{a.mobile}</a>
          </Fact>
          <Fact label="Experience">{a.yearsExperience === null ? '—' : `${a.yearsExperience} years`}</Fact>
          <Fact label="LinkedIn">
            {a.linkedin ? (
              <a href={a.linkedin} target="_blank" rel="noopener noreferrer nofollow">
                Open profile
              </a>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label="Portfolio">
            {a.portfolio ? (
              <a href={a.portfolio} target="_blank" rel="noopener noreferrer nofollow">
                Open portfolio
              </a>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label="Notice period">{a.noticePeriod ?? '—'}</Fact>
          <Fact label="Expected salary, EGP a month">{a.expectedSalary === null ? '—' : a.expectedSalary.toLocaleString('en-US')}</Fact>
          <Fact label="Consent">{formatDate(a.consentAt)}</Fact>
          <Fact label="CV">
            {a.cv ? (
              <span className="flex flex-wrap gap-3">
                {a.cv.mimeType === 'application/pdf' && (
                  <a href={applicantCvHref(a.id)} target="_blank" rel="noopener noreferrer">
                    Open
                  </a>
                )}
                <a href={applicantCvHref(a.id, true)}>Download</a>
                <span className="text-muted">{Math.max(1, Math.round(a.cv.sizeBytes / 1024))} KB</span>
              </span>
            ) : (
              'None'
            )}
          </Fact>
        </dl>
      </section>

      {a.answers.length > 0 && (
        <section aria-labelledby="applicant-answers" className="card overflow-x-auto">
          <h2 id="applicant-answers" className="px-6 pt-5 text-lg font-semibold">
            Answers
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th>Question</th>
                <th>Answer</th>
                <th className="text-right">Points</th>
                <th>Must-have</th>
              </tr>
            </thead>
            <tbody>
              {a.answers.map((x) => (
                <tr key={x.key}>
                  <td className="text-sm">{x.text}</td>
                  <td className="text-sm whitespace-pre-line">{answerText(x)}</td>
                  <td className="text-right tabular-nums">{x.maxPoints ? `${x.points} / ${x.maxPoints}` : '—'}</td>
                  <td className="text-sm">{x.passed === null ? '—' : x.passed ? <span className="text-ok">Met</span> : <span className="text-danger">Not met</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {a.can.editNotes && (
        <section aria-labelledby="applicant-notes" className="card space-y-2 p-6">
          <h2 id="applicant-notes" className="text-lg font-semibold">
            Notes
          </h2>
          <NotesForm action={saveApplicantNotes.bind(null, a.id)} notes={a.notes} />
        </section>
      )}
      {!a.can.editNotes && a.notes && (
        <section aria-labelledby="applicant-notes" className="card space-y-2 p-6">
          <h2 id="applicant-notes" className="text-lg font-semibold">
            Notes
          </h2>
          <p className="text-sm whitespace-pre-line">{a.notes}</p>
        </section>
      )}

      {a.offers.length > 0 && (
        <section aria-labelledby="applicant-offers" className="card space-y-2 p-6">
          <h2 id="applicant-offers" className="text-lg font-semibold">
            Job Offers
          </h2>
          <ul className="space-y-1 text-sm">
            {a.offers.map((o) => (
              <li key={o.id}>
                <Link href={`/offers/${o.id}`}>{o.number}</Link> <span className="text-muted">· {o.status}</span>
              </li>
            ))}
          </ul>
          {a.employeeId && (
            <p className="text-sm">
              Hired: <Link href={`/employees/${a.employeeId}`}>open their profile</Link>
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="applicant-history" className="card space-y-2 p-6">
        <h2 id="applicant-history" className="text-lg font-semibold">
          History
        </h2>
        <ol className="space-y-2 text-sm">
          {a.history.map((h, i) => (
            <li key={i}>
              <span className="font-semibold">{APPLICATION_EVENT_LABELS[h.event]}</span>
              {h.note && <span> · {h.note}</span>}
              <span className="block text-xs text-muted">
                {formatDateTime(h.at)}
                {h.by ? ` · ${h.by.name ?? h.by.email}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function ApplicantPage({ params }: PageProps<'/recruitment/applicants/[id]'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <Applicant params={params} />
      </Suspense>
    </div>
  );
}
