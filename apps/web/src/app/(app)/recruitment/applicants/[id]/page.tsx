import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import {
  APPLICATION_EVENT_LABELS,
  applicationSourceText,
  FEEDBACK_CRITERIA,
  FEEDBACK_CRITERION_LABELS,
  HIRING_SUGGESTION_LABELS,
  INTERVIEW_KIND_LABELS,
  INTERVIEW_STATUS_LABELS,
  RECOMMENDATION_LABELS,
  type ApplicationAnswerView,
  type ApplicationView,
  type InterviewView,
} from '@trendlix/shared';
import { formatDate, formatDateTime } from '@/lib/format';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { RehireWarning } from '../../../offboarding/rehire-warning';
import { FromTheCv } from '../../cv-card';
import { cancelInterview, giveFeedback, markInterview, moveApplicant, rescheduleInterview, restoreApplicant, saveApplicantNotes, scheduleInterview, suggestNext } from '../../actions';
import { loadApplicant, recruitmentNotLoaded } from '../../data';
import { ActionButton, NotesForm, ReasonButton } from '../../forms';
import { interviewWhen, MY_HIRING_PATH } from '../../hiring';
import { FeedbackForm, MoveInterview, ScheduleInterview, SuggestForm, type PersonOption } from '../../hiring-forms';
import { vacancyOptions } from '../../pickers';
import { applicantCvHref, makeOfferHref, matchText, vacancyHref } from '../../recruitment';
import { StageBadge } from '../../ui';

// An applicant (owner, 22 October 2026: "where will we include the ATS?"): who they are, their match and how each answer
// did (a must-have failed filters them out: kept, restorable), their CV, HR's notes, what can be done now (shortlist,
// move to interview, reject with a reason, restore, Make offer: the job offer form filled in from them and the vacancy),
// the job offers made to them and their history. A warning when they worked here before (offboarding's rehire check).
// Phase 2 (22 October 2026): their interviews (HR schedules, moves, cancels and marks them; the candidate is emailed the
// calendar invitation), the interviewers' scorecards (an interviewer sees the others' once they gave theirs), the hiring
// manager's suggestion, and Reject's "Email the candidate" tick. Their hiring manager and interviewers open it too,
// without the expected salary, HR's notes or the job offers.

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
      {c.reject && (
        <ReasonButton
          action={moveApplicant.bind(null, a.id, 'rejected')}
          label="Reject"
          pendingLabel="Rejecting…"
          reasonLabel="Why (kept with the application, never sent)"
          required
          kind="danger"
          emailOption={c.emailOnReject}
        />
      )}
    </div>
  );
}

function InterviewItem({ i, people, feedbackOf }: { i: InterviewView; people: PersonOption[]; feedbackOf: ApplicationView['feedback'] }) {
  const mine = feedbackOf.find((f) => f.interviewId === i.id && f.mine) ?? null;
  return (
    <li className="space-y-3 border-b border-line-soft py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">
          {interviewWhen(i.startsAt, i.minutes)} · {INTERVIEW_KIND_LABELS[i.kind]}
        </p>
        <span className={`badge ${i.status === 'scheduled' ? 'bg-accent-soft text-accent' : i.status === 'done' ? 'bg-ok-soft text-ok' : 'bg-canvas text-muted'}`}>{INTERVIEW_STATUS_LABELS[i.status]}</span>
      </div>
      {i.location && (
        <p className="text-sm break-words">
          {i.kind === 'online' ? (
            <a href={i.location} target="_blank" rel="noopener noreferrer nofollow">
              {i.location}
            </a>
          ) : (
            i.location
          )}
        </p>
      )}
      <p className="text-sm text-muted">
        With{' '}
        {i.interviewers.map((x, n) => (
          <span key={x.employeeId}>
            {n > 0 ? ', ' : ''}
            {x.name}
            {x.feedbackGiven ? ' (scorecard given)' : ''}
          </span>
        ))}
      </p>
      {i.note && <p className="text-sm whitespace-pre-line">Note to the candidate: {i.note}</p>}
      {i.status === 'cancelled' && i.cancelReason && <p className="text-sm text-muted">Cancelled: {i.cancelReason}</p>}
      {i.emailProblem ? <p className="text-sm text-warn">{i.emailProblem}</p> : i.emailedAt ? <p className="text-xs text-muted">The candidate was emailed {formatDateTime(i.emailedAt)}.</p> : null}
      <div className="flex flex-wrap items-start gap-2">
        {i.can.reschedule && <MoveInterview action={rescheduleInterview.bind(null, i.id)} people={people} interview={i} />}
        {i.can.mark && <ActionButton action={markInterview.bind(null, i.id, 'done')} label="Mark done" pendingLabel="Saving…" kind="primary" />}
        {i.can.mark && <ActionButton action={markInterview.bind(null, i.id, 'no_show')} label="No-show" pendingLabel="Saving…" />}
        {i.can.cancel && <ReasonButton action={cancelInterview.bind(null, i.id)} label="Cancel interview" pendingLabel="Cancelling…" reasonLabel="Why (for the record)" required={false} kind="danger" />}
      </div>
      {i.can.feedback && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">{mine ? 'Your scorecard is in' : 'Your scorecard'}</p>
          <FeedbackForm action={giveFeedback.bind(null, i.id)} mine={mine} />
        </div>
      )}
    </li>
  );
}

function Scorecards({ a }: { a: ApplicationView }) {
  if (!a.feedback.length && !a.feedbackHidden) return null;
  return (
    <section aria-labelledby="applicant-scorecards" className="card space-y-3 p-6">
      <h2 id="applicant-scorecards" className="text-lg font-semibold">
        Scorecards
      </h2>
      {a.feedbackHidden > 0 && (
        <p className="text-sm text-muted">
          {a.feedbackHidden} {a.feedbackHidden === 1 ? 'scorecard is' : 'scorecards are'} hidden until you give yours, so you score them on your own.
        </p>
      )}
      <ul className="space-y-4">
        {a.feedback.map((f) => (
          <li key={f.id} className="space-y-1 border-b border-line-soft pb-3 last:border-b-0">
            <p className="font-semibold">
              {f.interviewer.name}
              {f.mine ? ' (you)' : ''} · {RECOMMENDATION_LABELS[f.recommendation]}
            </p>
            <p className="text-sm text-muted">{FEEDBACK_CRITERIA.map((c) => `${FEEDBACK_CRITERION_LABELS[c]} ${f.ratings[c]}/5`).join(' · ')}</p>
            {f.notes && <p className="text-sm whitespace-pre-line">{f.notes}</p>}
            <p className="text-xs text-muted">{formatDateTime(f.updatedAt)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Interviews({ a }: { a: ApplicationView }) {
  const manages = a.viewer === 'manages';
  const people: PersonOption[] = manages && (a.can.scheduleInterview || a.interviews.some((i) => i.can.reschedule)) ? (await vacancyOptions()).managers : [];
  if (!a.interviews.length && !a.can.scheduleInterview) return null;
  return (
    <section aria-labelledby="applicant-interviews" className="card space-y-3 p-6">
      <h2 id="applicant-interviews" className="text-lg font-semibold">
        Interviews
      </h2>
      {a.interviews.length > 0 && (
        <ul>
          {a.interviews.map((i) => (
            <InterviewItem key={i.id} i={i} people={people} feedbackOf={a.feedback} />
          ))}
        </ul>
      )}
      {a.can.scheduleInterview && <ScheduleInterview action={scheduleInterview.bind(null, a.id)} people={people} defaultInterviewerIds={a.position.hiringManagerId ? [a.position.hiringManagerId] : []} />}
    </section>
  );
}

async function Applicant({ params }: { params: PageProps<'/recruitment/applicants/[id]'>['params'] }) {
  const { id } = await params;
  const loaded = await loadApplicant(id);
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'applicant')}</Empty>;
  const a = loaded.value;
  const participant = a.viewer === 'hiring_manager' || a.viewer === 'interviewer';
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {a.viewer === 'interviewer' ? <BackLink href={MY_HIRING_PATH}>My Hiring</BackLink> : <BackLink href={vacancyHref(a.vacancy.id)}>{a.vacancy.title}</BackLink>}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{a.fullName}</h1>
          <StageBadge stage={a.stage} filteredOut={a.filteredOut} />
        </div>
        <p className="text-sm text-muted">
          {a.number} · applied {formatDateTime(a.appliedAt)} · {applicationSourceText(a)}
        </p>
      </div>

      {a.stage !== 'hired' && !participant && <RehireWarning email={a.email} />}

      {a.suggestion && (
        <div role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          <p className="font-semibold">
            The hiring manager suggests: {HIRING_SUGGESTION_LABELS[a.suggestion.kind]}
            {a.suggestion.by ? ` (${a.suggestion.by.name ?? a.suggestion.by.email}, ${formatDateTime(a.suggestion.at)})` : ''}
          </p>
          {a.suggestion.note && <p>{a.suggestion.note}</p>}
        </div>
      )}

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
          {!participant && <Fact label="Expected salary, EGP a month">{a.expectedSalary === null ? '—' : a.expectedSalary.toLocaleString('en-US')}</Fact>}
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

      {/* What the CV's text says (22 October 2026: "make the OCR egine reads the CV and analyse it"; "Built-in rules only"). */}
      {a.cv && a.cvReading && (
        <Suspense fallback={<Loading />}>
          <FromTheCv reading={a.cvReading} subject={{ applicationId: a.id }} />
        </Suspense>
      )}

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

      <Suspense fallback={<Loading />}>
        <Interviews a={a} />
      </Suspense>

      <Scorecards a={a} />

      {a.can.suggest && (
        <section aria-labelledby="applicant-suggest" className="card space-y-2 p-6">
          <h2 id="applicant-suggest" className="text-lg font-semibold">
            Your Suggestion
          </h2>
          <p className="text-sm text-muted">As the hiring manager, tell HR what you think should happen next. HR acts on it.</p>
          <SuggestForm action={suggestNext.bind(null, a.id)} />
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

      {a.offers.length > 0 && !participant && (
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
