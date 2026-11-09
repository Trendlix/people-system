import type { Metadata } from 'next';
import { LinkedInProfileLink } from '../../linkedin-link-ui';
import Link from 'next/link';
import { Suspense } from 'react';
import {
  APPLICATION_EVENT_LABELS,
  applicationSourceText,
  FEEDBACK_CRITERIA,
  FEEDBACK_CRITERION_LABELS,
  INTERVIEW_KIND_LABELS,
  INTERVIEW_STATUS_LABELS,
  RECOMMENDATION_LABELS,
  RECORDED_EARLIER_MARK,
  applicationKey,
  applicationStageLabel,
  SCREENING_CALL_LABELS,
  type ApplicationAnswerView,
  type ApplicationView,
  type InterviewView,
} from '@trendlix/shared';
import { suggestionShown } from '@trendlix/shared';
import { SetUpEmailLink } from '@/components/set-up-email-link';
import { isEmailNotSetUp, setsUpEmail } from '@/lib/email-setup';
import { formatDate, formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { RehireWarning } from '../../../offboarding/rehire-warning';
import { splitApplication } from '../../candidate-actions';
import { CandidateApplicationsTable, EmployeeCard, MatchesCard } from '../../candidate-ui';
import { candidateHref } from '../../candidates';
import { FromTheCv } from '../../cv-card';
import { MatchValue, OpenPositions } from '../../cv-fit-ui';
import { CvDialogHost, CvOpenButton } from '../../cv-dialog';
import { DeleteApplicantButton } from '../../delete-ui';
import { APPLICANT_GONE } from '../../deletes';
import { cancelInterview, decideApplicant, giveFeedback, markInterview, moveApplicant, rescheduleInterview, restoreApplicant, scheduleInterview, suggestNext } from '../../actions';
import { loadApplicant, loadApplicantComments, loadApplicants, recruitmentNotLoaded } from '../../data';
import { ActionButton, ReasonButton } from '../../forms';
import { interviewWhen, MY_HIRING_PATH } from '../../hiring';
import { FeedbackForm, MoveInterview, ScheduleInterview, SuggestForm, type PersonOption } from '../../hiring-forms';
import { vacancyOptions } from '../../pickers';
import { APPLICANTS_PATH, applicantCvHref, applicantHref, applicantsHref, listFromOf, makeOfferHref, matchText, sortApplicants, vacancyHref, type ApplicantsQuery } from '../../recruitment';
import { levelLabel, siblingQueries, siblingsIn, type Siblings } from '../../workflow';
import { BackToList } from '../../list-return';
import { commentsOfRecord, kb, ownCv, showsRecordComments } from '../../screening';
import { ScreeningCommentsCard } from '../../screening-ui';
import { ScorecardRoleBadge, ScorecardSummary } from '../../scorecard-ui';
import { ownScorecardRole, scorecardHeading } from '../../scorecards';
import { CvUpdatedBadge, EarlierCvList, StageBadge, VerdictBadge } from '../../ui';
import { decisionLine, rejectReasonsAt } from '../../tree';
import { DecideForm, HoldBadge, RejectButton } from '../../tree-ui';
import { applicantPortfolioHref, portfolioLinksOf } from '../../portfolio';
import { LinkedInMark, PortfolioSent } from '../../portfolio-chips';
import { shownCode } from '@/lib/hidden';
import type { MeetingChoices } from '@trendlix/shared';
import { fixInterviewMeeting } from '../../meeting-actions';
import { loadMeetingChoices } from '../../meeting-data';
import { MeetingFix } from '../../meeting-fix';
import { MeetingJoin } from '../../meeting-ui';
import { NO_MEETING_CHOICES } from '../../meetings';

// An applicant (owner, 22 October 2026: "where will we include the ATS?"): who they are, their match and how each answer
// did (a must-have failed filters them out: kept, restorable), their CV, HR's notes, what can be done now (decide their
// step, reject, restore, Make offer: the job offer form filled in from them and the vacancy),
// the job offers made to them and their history. A warning when they worked here before (offboarding's rehire check).
// Phase 2 (22 October 2026): their interviews (HR schedules, moves, cancels and marks them; the candidate is emailed the
// calendar invitation), the interviewers' scorecards (an interviewer sees the others' once they gave theirs), the hiring
// manager's suggestion, and Reject's "Email the candidate" tick. Their hiring manager and interviewers open it too,
// without the expected salary, HR's notes or the job offers.
// Since 24 October 2026 (owner: "when opening a CV, open it in a popup window", "is there a way to add screening
// comments?"; "HR + hiring manager & interviewers"): the CV opens in the CV window (?cv=; for HR, the CEO and a Super
// Admin with the candidate's other CVs before and after it), and the Screening Comments card replaces HR's notes (moved
// into the comments, "HR (earlier notes)"): this application's comments (and the general CV it came from), with the
// general ones for HR, the CEO and a Super Admin; its hiring manager and interviewers comment here too. The latest
// verdict beside the stage.
// Delete applicant (owner, 25 October 2026, on a closed vacancy's rejected applicant: "i want to delete this"; asked,
// "Vacancy alone - applicant alone - superadmin only"): a Super Admin's, its window saying what goes or why it stays on
// record; a link to one deleted since lands on a plain "deleted, or you can't open it", never an error page.
// Applying again (owner, 25 October 2026: "if an employee updated the cv and reapplied, how will he be treated in the
// system?"; asked, "Update their application"): the current CV with when it came, Earlier CVs (date, name, Open), the
// "CV updated" mark for 7 days, and the step "Updated by the candidate" in the history.
// Scorecards from HR and the hiring manager (owner, 29 October 2026: "then there should be interview comment and status
// for HR and hiring manager"; asked, "Score Card for each of them"): they give theirs on an interview as its interviewers
// do, even when not among them ("Give your scorecard as HR"); each scorecard shows whose it is, and a line above them sums
// them up for choosing the candidate (then Make offer).
// The recruitment tree (owner, 3 November 2026: "Recrutment tree"; 5 November 2026: Review 1 merged into Applicants,
// Review 2 the Final Review, the hiring manager's review gone): Applicants (the recruiter), Final Review (the recruiter's
// manager), HR Screening, Technical Interview, Offer. Whoever takes their step decides it here (its outcomes; a
// rejection's reasons, ticked, at HR Screening and the interview; a review is Pass or Reject with optional feedback); HR
// rejects from any step. Beside the stage, their hold (Unreachable, Pending); the Decisions card lists each step decided
// and says who takes the step now. Interviews are scheduled at the Technical Interview and the Offer.

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
      {c.restore && <ActionButton action={restoreApplicant.bind(null, a.id)} label="Restore" pendingLabel="Restoring…" kind="primary" />}
      {c.reject && <RejectButton action={moveApplicant.bind(null, a.id, 'rejected')} reasons={rejectReasonsAt(a.stage)} emailOption={c.emailOnReject} />}
      {/* a Super Admin's, never a developer's (owner, 25 October 2026: "applicant alone - superadmin only"): then its vacancy */}
      {c.delete && <DeleteApplicantButton id={a.id} number={a.number} back={{ vacancyId: a.vacancy.id }} />}
      {/* their step, decided by whoever takes it (the tree, 3 November 2026) */}
      {c.decide && (
        <DecideForm
          action={decideApplicant.bind(null, a.id)}
          stageLabel={applicationStageLabel(c.decide.stage)}
          outcomes={c.decide.outcomes}
          reasons={c.decide.reasons}
          emailOption={c.emailOnReject}
        />
      )}
    </div>
  );
}

/**
 * Each step decided (the tree, 3 November 2026): "HR Screening: Rejected (Culture Fit)", who and when, the feedback; the
 * screening call of before the tree when they had one; and who takes their step now.
 */
function Decisions({ a }: { a: ApplicationView }) {
  const decisions = a.decisions ?? [];
  if (!decisions.length && !a.screeningCall && !a.nextBy) return null;
  return (
    <section aria-labelledby="applicant-decisions" className="card space-y-3 p-6">
      <h2 id="applicant-decisions" className="text-lg font-semibold">
        Decisions
      </h2>
      {a.nextBy && <p className="text-sm">Now with {a.nextBy}</p>}
      {(decisions.length > 0 || a.screeningCall) && (
        <ul className="divide-y divide-line">
          {decisions.map((d) => (
            <li key={d.id} className="space-y-1 py-2 text-sm">
              <p>
                <span className={`font-semibold ${d.outcome === 'rejected' || d.outcome === 'declined' ? 'text-danger' : ''}`}>{decisionLine(d)}</span>
                <span className="text-muted">
                  {' · '}
                  {d.by ? `${d.by.name ?? d.by.email}, ` : ''}
                  {formatDateTime(d.at)}
                </span>
              </p>
              {d.feedback && <p className="whitespace-pre-line text-muted">{d.feedback}</p>}
            </li>
          ))}
          {a.screeningCall && (
            <li className="space-y-1 py-2 text-sm">
              <p>
                <span className="font-semibold">Screening call (before the tree): {SCREENING_CALL_LABELS[a.screeningCall.result]}</span>
                <span className="text-muted">
                  {' · '}
                  {a.screeningCall.by ? `${a.screeningCall.by.name ?? a.screeningCall.by.email}, ` : ''}
                  {formatDateTime(a.screeningCall.at)}
                </span>
              </p>
              {a.screeningCall.note && <p className="whitespace-pre-line text-muted">{a.screeningCall.note}</p>}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/** Their candidate's other applications and general CVs, the possible matches, and "Move to a new candidate" (22 October 2026). */
function OtherApplications({ a }: { a: ApplicationView }) {
  const c = a.candidateProfile!;
  const others = c.generalCvs.filter((g) => g.movedTo?.applicationId !== a.id);
  return (
    <>
      <MatchesCard matches={c.matches} selfId={c.id} manages={a.viewer === 'manages'} />
      {(c.otherApplications.length > 0 || others.length > 0 || c.canSplit) && (
        <section aria-labelledby="applicant-other" className="card space-y-3 overflow-hidden pt-5">
          <div className="flex flex-wrap items-start justify-between gap-2 px-6">
            <h2 id="applicant-other" className="text-lg font-semibold">
              Other Applications
            </h2>
            {c.canSplit && (
              <ActionButton
                action={splitApplication.bind(null, a.id)}
                label="Move to a new candidate"
                pendingLabel="Moving…"
                confirm={`Move ${shownCode(a.number) ?? 'this application'} to a new candidate?`}
              />
            )}
          </div>
          {c.otherApplications.length > 0 ? (
            <CandidateApplicationsTable rows={c.otherApplications} />
          ) : (
            <p className="px-6 text-sm text-muted">No other application.</p>
          )}
          {others.length > 0 && (
            <p className="px-6 pb-5 text-sm text-muted">
              Also {others.length} general {others.length === 1 ? 'CV' : 'CVs'}: <Link href={candidateHref(c.id)}>see the candidate</Link>.
            </p>
          )}
        </section>
      )}
    </>
  );
}

/**
 * `setUpEmail`: a Super Admin, offered "Set up email" after the candidate's email problem when email isn't set up (owner,
 * 23 October 2026: "why dont we add SMTP setup in the organization setup").
 */
function InterviewItem({
  i,
  people,
  feedbackOf,
  setUpEmail,
  meetings = NO_MEETING_CHOICES,
  selfId = null,
  hiringManagerId = null,
}: {
  i: InterviewView;
  people: PersonOption[];
  feedbackOf: ApplicationView['feedback'];
  setUpEmail: boolean;
  /** "Create the meeting with" (24 October 2026: "automatically generate meeting links"), for Move and Try again. */
  meetings?: MeetingChoices;
  /** The caller's employee profile and the vacancy's hiring manager: whose scorecard theirs is, for its heading (29 October 2026). */
  selfId?: string | null;
  hiringManagerId?: string | null;
}) {
  const mine = feedbackOf.find((f) => f.interviewId === i.id && f.mine) ?? null;
  return (
    <li className="space-y-3 border-b border-line-soft py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">
          {interviewWhen(i.startsAt, i.minutes)} · {INTERVIEW_KIND_LABELS[i.kind]}
        </p>
        <span className={`badge ${i.status === 'scheduled' ? 'bg-accent-soft text-accent' : i.status === 'done' ? 'bg-ok-soft text-ok' : 'bg-canvas text-muted'}`}>{INTERVIEW_STATUS_LABELS[i.status]}</span>
      </div>
      {/* the meeting's service and Join (24 October 2026: "automatically generate meeting links") */}
      {i.kind === 'online' && <MeetingJoin interview={i} />}
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
      {i.meetingProblem && <p className="text-sm text-warn">{i.meetingProblem}</p>}
      {i.can.meeting && <MeetingFix action={fixInterviewMeeting.bind(null, i.id)} choices={meetings} />}
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
      {i.emailProblem ? (
        <p className="text-sm text-warn">
          {i.emailProblem}
          {setUpEmail && isEmailNotSetUp(i.emailProblem) && (
            <>
              {' '}
              <SetUpEmailLink />
            </>
          )}
        </p>
      ) : i.emailedAt ? (
        <p className="text-xs text-muted">The candidate was emailed {formatDateTime(i.emailedAt)}.</p>
      ) : null}
      <div className="flex flex-wrap items-start gap-2">
        {i.can.reschedule && <MoveInterview action={rescheduleInterview.bind(null, i.id)} people={people} interview={i} meetings={meetings} />}
        {i.can.mark && <ActionButton action={markInterview.bind(null, i.id, 'done')} label="Mark done" pendingLabel="Saving…" kind="primary" />}
        {i.can.mark && <ActionButton action={markInterview.bind(null, i.id, 'no_show')} label="No-show" pendingLabel="Saving…" />}
        {i.can.cancel && <ReasonButton action={cancelInterview.bind(null, i.id)} label="Cancel interview" pendingLabel="Cancelling…" reasonLabel="Why" required={false} kind="danger" />}
      </div>
      {i.can.feedback && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">{scorecardHeading(!!mine, mine?.role ?? ownScorecardRole(i, selfId, hiringManagerId))}</p>
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
          {a.feedbackHidden} {a.feedbackHidden === 1 ? 'scorecard is' : 'scorecards are'} hidden until you give yours.
        </p>
      )}
      {/* HR's, the hiring manager's and the interviewers' recommendations in a line (29 October 2026) */}
      <ScorecardSummary feedback={a.feedback} />
      <ul className="space-y-4">
        {a.feedback.map((f) => (
          <li key={f.id} className="space-y-1 border-b border-line-soft pb-3 last:border-b-0">
            <p className="font-semibold">
              {f.interviewer.name}
              {f.mine ? ' (you)' : ''}
              {/* whose it is (29 October 2026): Interviewer, Hiring manager or HR */}
              <ScorecardRoleBadge f={f} /> · {RECOMMENDATION_LABELS[f.recommendation]}
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
  // "Set up email" for a Super Admin, once an interview's candidate wasn't emailed for the lack of it
  const setUpEmail = a.interviews.some((i) => isEmailNotSetUp(i.emailProblem)) && setsUpEmail(await getCurrentUser());
  // what an online interview's meeting can be made with (24 October 2026), for the forms HR sees
  const meetings = manages && (a.can.scheduleInterview || a.interviews.some((i) => i.can.reschedule || i.can.meeting)) ? await loadMeetingChoices() : NO_MEETING_CHOICES;
  // whose scorecard the caller gives (29 October 2026: HR and the hiring manager too), for its heading
  const selfId = a.interviews.some((i) => i.can.feedback) ? ((await getCurrentUser()).employeeId ?? null) : null;
  return (
    <section aria-labelledby="applicant-interviews" className="card space-y-3 p-6">
      <h2 id="applicant-interviews" className="text-lg font-semibold">
        Interviews
      </h2>
      {a.interviews.length > 0 && (
        <ul>
          {a.interviews.map((i) => (
            <InterviewItem key={i.id} i={i} people={people} feedbackOf={a.feedback} setUpEmail={setUpEmail} meetings={meetings} selfId={selfId} hiringManagerId={a.position.hiringManagerId} />
          ))}
        </ul>
      )}
      {a.can.scheduleInterview && (
        <ScheduleInterview action={scheduleInterview.bind(null, a.id)} people={people} defaultInterviewerIds={a.position.hiringManagerId ? [a.position.hiringManagerId] : []} meetings={meetings} />
      )}
    </section>
  );
}

/**
 * Previous and Next through the applicant's step (owner, 9 November 2026: "allow me to switch between the CVs in the
 * same level of the workflow"): the list it was opened from (its filters and order), else its own step on its vacancy
 * (workflow.ts siblingQueries); each opens in this one's place (replace), so Back still returns to the list. Null when
 * the list can't be read (an interviewer's), or the applicant isn't in it.
 */
async function stepOf(from: string | null, a: ApplicationView): Promise<{ q: ApplicantsQuery; siblings: Siblings } | null> {
  for (const q of siblingQueries(from, { vacancyId: a.vacancy.id, stage: a.stage, filteredOut: a.filteredOut })) {
    const loaded = await loadApplicants(q);
    if (loaded.kind !== 'ok') return null;
    const siblings = siblingsIn(sortApplicants(loaded.value, q).map((r) => r.id), a.id);
    if (siblings) return { q, siblings };
  }
  return null;
}

/** Previous, where it is in the step ("3 of 18 · Applicants") and Next; read on its own, the page shown meanwhile. */
async function StepNav({ a, from }: { a: ApplicationView; from: string | null }) {
  const step = await stepOf(from, a);
  if (!step || step.siblings.total < 2) return null;
  const listHref = from ?? backHref(a);
  const { prev, next, index, total } = step.siblings;
  const go = 'inline-flex min-h-9 items-center gap-1 rounded-lg border border-line bg-card px-3 font-semibold no-underline hover:bg-canvas';
  const off = 'inline-flex min-h-9 items-center gap-1 rounded-lg border border-line-soft px-3 font-semibold text-muted';
  return (
    <nav aria-label="Applicants at this step" className="flex items-center gap-2 text-sm">
      {prev ? (
        <Link href={applicantHref(prev, listHref)} replace className={go}>
          ‹ Previous
        </Link>
      ) : (
        <span aria-disabled="true" className={off}>
          ‹ Previous
        </span>
      )}
      <span className="px-1 text-muted tabular-nums">
        {index} of {total} · {levelLabel(step.q)}
      </span>
      {next ? (
        <Link href={applicantHref(next, listHref)} replace className={go}>
          Next ›
        </Link>
      ) : (
        <span aria-disabled="true" className={off}>
          Next ›
        </span>
      )}
    </nav>
  );
}

/** Back, opened without a list (a notification, a link): the applicant's own step on its vacancy, its row named. */
const backHref = (a: ApplicationView) => applicantsHref(vacancyHref(a.vacancy.id), { ...siblingQueries(null, { vacancyId: a.vacancy.id, stage: a.stage, filteredOut: a.filteredOut })[0], vacancyId: '' });

async function Applicant({ params, searchParams }: PageProps<'/recruitment/applicants/[id]'>) {
  const { id } = await params;
  const from = listFromOf((await searchParams).from);
  const [loaded, commentsLoaded] = await Promise.all([loadApplicant(id), loadApplicantComments(id)]);
  // 404: deleted since (25 October 2026), or not theirs to open: said plainly, an old notification's or email's link too
  if (loaded.kind === 'unavailable') {
    return (
      <div className="space-y-4">
        <BackLink href={APPLICANTS_PATH}>Applicants</BackLink>
        <Empty>{APPLICANT_GONE}</Empty>
      </div>
    );
  }
  if (loaded.kind !== 'ok') return <Empty>{recruitmentNotLoaded(loaded, 'applicant')}</Empty>;
  const a = loaded.value;
  const participant = a.viewer === 'hiring_manager' || a.viewer === 'interviewer' || a.viewer === 'reviewer';
  // the screening comments and the CVs the window opens (24 October 2026); the page shows without them if they fail
  const comments = commentsLoaded.kind === 'ok' ? commentsLoaded.value : null;
  const commentsNotLoaded = commentsLoaded.kind === 'ok' ? '' : recruitmentNotLoaded(commentsLoaded, 'screening comments');
  const ownKey = applicationKey(a.id);
  const cvs = comments?.cvs.length ? comments.cvs : ownCv('application', { id: a.id, reference: a.number, title: a.vacancy.title, sentAt: a.cvUpdatedAt ?? a.appliedAt, earlierCvs: a.earlierCvs }, a.cv);
  // an interviewer's or a reviewer's: My Hiring; else the list it was opened from, where it was, or its step on the vacancy
  const myHiring = a.viewer === 'interviewer' || a.viewer === 'reviewer';
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {myHiring ? (
            <BackLink href={MY_HIRING_PATH}>My Hiring</BackLink>
          ) : (
            <BackToList listHref={from ?? backHref(a)} applicantId={a.id}>
              {from?.startsWith(APPLICANTS_PATH) ? 'Applicants' : a.vacancy.title}
            </BackToList>
          )}
          {!myHiring && (
            <Suspense fallback={null}>
              <StepNav a={a} from={from} />
            </Suspense>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">{a.fullName}</h1>
          <StageBadge stage={a.stage} filteredOut={a.filteredOut} />
          {/* kept at their step: Unreachable, Pending (the tree, 3 November 2026) */}
          <HoldBadge hold={a.hold} />
          {/* the latest screening verdict of this application's comments (24 October 2026) */}
          <VerdictBadge verdict={a.verdict} />
          {/* they applied again with a new CV in the last 7 days (25 October 2026) */}
          <CvUpdatedBadge shown={a.cvUpdated} at={a.cvUpdatedAt} />
        </div>
        <p className="text-sm text-muted">
          {shownCode(a.number) && `${a.number} · `}
          applied {formatDateTime(a.appliedAt)} · {applicationSourceText(a)}
          {/* their candidate profile (22 October 2026: "how to make like a profile for each candidate …"); HR, the CEO and a Super Admin only */}
          {a.candidateProfile && (
            <>
              {' · '}
              <Link href={candidateHref(a.candidateProfile.id)}>{shownCode(a.candidateProfile.code) ? `Candidate ${a.candidateProfile.code}` : 'Candidate profile'}</Link>
            </>
          )}
        </p>
      </div>

      {a.stage !== 'hired' && !participant && !a.candidateProfile?.employee && <RehireWarning email={a.email} />}

      {a.candidateProfile?.employee && <EmployeeCard link={a.candidateProfile.employee} />}

      {/* the hiring manager's suggestion at the Technical Interview or the Offer */}
      {a.suggestion && (
        <div role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          <p className="font-semibold">
            {suggestionShown(a.suggestion.kind, a.stage)}
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

      <Actions a={a} />

      {a.candidateProfile && <OtherApplications a={a} />}

      <section aria-labelledby="applicant-details" className="card space-y-4 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="applicant-details" className="text-lg font-semibold">
            Details
          </h2>
          <p className="text-sm">
            {/* not asked the screening questions (added from the suggested CVs or by HR): the CV fit, "72% · CV" (25 October 2026) */}
            Match <span className="font-semibold tabular-nums">{a.matchPercent !== null ? matchText(a.matchPercent) : <MatchValue a={a} />}</span>
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
            {/* "Fill in with LinkedIn" (25 October 2026): the email LinkedIn confirmed */}
            <LinkedInMark by={a.emailConfirmedBy} />
          </Fact>
          <Fact label="Mobile">
            <a href={`tel:${a.mobile.replace(/[^\d+]/g, '')}`}>{a.mobile}</a>
          </Fact>
          <Fact label="Experience">{a.yearsExperience === null ? '—' : `${a.yearsExperience} years`}</Fact>
          <Fact label="LinkedIn">
            {/* the one typed, else the CV's (owner, 29 October 2026: "the OCR is not filling the linkedin link") */}
            <LinkedInProfileLink typed={a.linkedin} fromCv={a.cvLinkedin} />
          </Fact>
          <Fact label="Notice period">{a.noticePeriod ?? '—'}</Fact>
          {!participant && <Fact label="Expected salary, EGP a month">{a.expectedSalary === null ? '—' : a.expectedSalary.toLocaleString('en-US')}</Fact>}
          <Fact label="Consent">{formatDate(a.consentAt)}</Fact>
          <Fact label="CV">
            {a.cv ? (
              <span className="flex flex-wrap items-center gap-3">
                {/* in the CV window (24 October 2026: "when opening a CV, open it in a popup window"), a Word file too */}
                <CvOpenButton recordId={a.id}>Open</CvOpenButton>
                <a href={applicantCvHref(a.id, true)} className="inline-flex min-h-9 items-center">
                  Download
                </a>
                <span className="text-muted">{kb(a.cv.sizeBytes)}</span>
                {/* a new one sent by applying again (25 October 2026: "Update their application") */}
                {a.cvUpdatedAt && <span className="text-muted">sent {formatDate(a.cvUpdatedAt)}</span>}
              </span>
            ) : (
              'None'
            )}
          </Fact>
          {/* the CVs it held before the current one, the newest first (25 October 2026: "Update their application") */}
          {!!a.earlierCvs?.length && (
            <div className="min-w-0 sm:col-span-3">
              <dt className="text-xs font-medium tracking-wide text-muted uppercase">Earlier CVs</dt>
              <dd className="mt-1">
                <EarlierCvList applicationId={a.id} cvs={a.earlierCvs} />
              </dd>
            </div>
          )}
          {/* every link with its platform, and the PDF case study (owner, 25 October 2026: "Portfolio per position"), under
              the section title its form shows (26 October 2026: "Your case studies: link, link, PDF") */}
          <div className="min-w-0 sm:col-span-3">
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Portfolio</dt>
            <dd className="mt-1 text-sm break-words">
              <PortfolioSent title={a.portfolioTitle} links={portfolioLinksOf(a)} file={a.portfolioFile} href={applicantPortfolioHref(a.id)} downloadHref={applicantPortfolioHref(a.id, true)} />
            </dd>
          </div>
        </dl>
      </section>

      {/* What the CV's text says (22 October 2026: "make the OCR egine reads the CV and analyse it"; "Built-in rules only"). */}
      {a.cv && a.cvReading && (
        <Suspense fallback={<Loading />}>
          <FromTheCv reading={a.cvReading} subject={{ applicationId: a.id }} />
        </Suspense>
      )}

      {/* the other open vacancies the CV fits (owner, 25 October 2026: "and if it recomended to another position based on the CV"); HR, the CEO and a Super Admin */}
      {a.openPositions && <OpenPositions positions={a.openPositions} record={{ applicationId: a.id }} id="applicant-open-positions" level="h2" card />}

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

      <Decisions a={a} />

      <Suspense fallback={<Loading />}>
        <Interviews a={a} />
      </Suspense>

      <Scorecards a={a} />

      {a.can.suggest && (
        <section aria-labelledby="applicant-suggest" className="card space-y-2 p-6">
          <h2 id="applicant-suggest" className="text-lg font-semibold">
            Your Suggestion
          </h2>
          <SuggestForm action={suggestNext.bind(null, a.id)} stage={a.stage} />
        </section>
      )}

      {/* HR's notes are screening comments now (24 October 2026), the earlier ones moved in as "HR (earlier notes)" */}
      {/* written at HR Screening only (owner, 5 November 2026: "I need it to appear only during the HR Screening stage"):
          before it nothing; after it, the comments written, to read */}
      {showsRecordComments(comments, ownKey, comments ? commentsOfRecord(comments, ownKey).length : 0) && (
        <ScreeningCommentsCard data={comments} notLoaded={commentsNotLoaded} mode="record" comments={comments ? commentsOfRecord(comments, ownKey) : []} defaultTarget={ownKey} />
      )}

      {a.offers.length > 0 && !participant && (
        <section aria-labelledby="applicant-offers" className="card space-y-2 p-6">
          <h2 id="applicant-offers" className="text-lg font-semibold">
            Job Offers
          </h2>
          <ul className="space-y-1 text-sm">
            {a.offers.map((o) => (
              <li key={o.id}>
                <Link href={`/offers/${o.id}`}>{shownCode(o.number) ?? 'Job offer'}</Link> <span className="text-muted">· {o.status}</span>
                {/* an earlier offer, entered after it was given (25 October 2026) */}
                {o.recordedEarlier && <span className="text-muted"> · {RECORDED_EARLIER_MARK}</span>}
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
      {/* the CV window, opened by ?cv= (24 October 2026) */}
      <Suspense fallback={null}>
        <CvDialogHost cvs={cvs} data={comments} pageKey={ownKey} commentsNotLoaded={commentsNotLoaded} />
      </Suspense>
    </div>
  );
}

export default function ApplicantPage({ params, searchParams }: PageProps<'/recruitment/applicants/[id]'>) {
  return (
    <div>
      <Suspense fallback={<Loading />}>
        <Applicant params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
