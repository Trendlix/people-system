import type { Metadata } from 'next';
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
import { cancelInterview, giveFeedback, markInterview, moveApplicant, rescheduleInterview, restoreApplicant, scheduleInterview, suggestNext } from '../../actions';
import { loadApplicant, loadApplicantComments, recruitmentNotLoaded } from '../../data';
import { ActionButton, ReasonButton } from '../../forms';
import { interviewWhen, MY_HIRING_PATH } from '../../hiring';
import { FeedbackForm, MoveInterview, ScheduleInterview, SuggestForm, type PersonOption } from '../../hiring-forms';
import { vacancyOptions } from '../../pickers';
import { APPLICANTS_PATH, applicantCvHref, makeOfferHref, matchText, vacancyHref } from '../../recruitment';
import { commentsOfRecord, kb, ownCv } from '../../screening';
import { ScreeningCommentsCard } from '../../screening-ui';
import { ScorecardRoleBadge, ScorecardSummary } from '../../scorecard-ui';
import { ownScorecardRole, scorecardHeading } from '../../scorecards';
import { CvUpdatedBadge, EarlierCvList, HiringStepBadge, StageBadge, VerdictBadge } from '../../ui';
import { screeningCallCard } from '../../screening-call';
import { saveScreeningCall } from '../../screening-call-actions';
import { ScreeningCallCard } from '../../screening-call-ui';
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
// did (a must-have failed filters them out: kept, restorable), their CV, HR's notes, what can be done now (shortlist,
// move to interview, reject with a reason, restore, Make offer: the job offer form filled in from them and the vacancy),
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
// The hiring steps (owner, 29 October 2026: "Manager view the shortlisted and accept or reject them - HR Screening and
// scheduling"; asked, "Screening call + result"): where a shortlisted applicant stands beside the stage, HR's Screening
// Call card (Passed or Failed with a comment, once the hiring manager accepted them), and the interview scheduled (or
// Move to interview) only for one who passed it: why not yet is said in its place.

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
      {c.interview && !a.interviewBlocked && <ActionButton action={moveApplicant.bind(null, a.id, 'interview')} label="Move to interview" pendingLabel="Saving…" />}
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
      {/* a Super Admin's, never a developer's (owner, 25 October 2026: "applicant alone - superadmin only"): then its vacancy */}
      {c.delete && <DeleteApplicantButton id={a.id} number={a.number} back={{ vacancyId: a.vacancy.id }} />}
    </div>
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
                confirm={`Move ${shownCode(a.number) ?? 'this application'} to a new candidate? It leaves ${shownCode(c.code) ?? 'its candidate'}, with the email and mobile used only on it; the two won’t be suggested as one person.`}
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
        {i.can.cancel && <ReasonButton action={cancelInterview.bind(null, i.id)} label="Cancel interview" pendingLabel="Cancelling…" reasonLabel="Why (for the record)" required={false} kind="danger" />}
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
          {a.feedbackHidden} {a.feedbackHidden === 1 ? 'scorecard is' : 'scorecards are'} hidden until you give yours, so you score them on your own.
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
      {a.can.scheduleInterview &&
        // the hiring manager's acceptance, then a passed screening call (29 October 2026): why not yet, in its place
        (a.interviewBlocked ? (
          <p role="note" className="rounded-lg bg-canvas px-4 py-3 text-sm text-muted">
            {a.interviewBlocked}
          </p>
        ) : (
          <ScheduleInterview action={scheduleInterview.bind(null, a.id)} people={people} defaultInterviewerIds={a.position.hiringManagerId ? [a.position.hiringManagerId] : []} meetings={meetings} />
        ))}
    </section>
  );
}

async function Applicant({ params }: { params: PageProps<'/recruitment/applicants/[id]'>['params'] }) {
  const { id } = await params;
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
  const participant = a.viewer === 'hiring_manager' || a.viewer === 'interviewer';
  // HR's screening call (29 October 2026: "Screening call + result"): the call made, and HR's form at Shortlisted
  const screening = screeningCallCard(a);
  // the screening comments and the CVs the window opens (24 October 2026); the page shows without them if they fail
  const comments = commentsLoaded.kind === 'ok' ? commentsLoaded.value : null;
  const commentsNotLoaded = commentsLoaded.kind === 'ok' ? '' : recruitmentNotLoaded(commentsLoaded, 'screening comments');
  const ownKey = applicationKey(a.id);
  const cvs = comments?.cvs.length ? comments.cvs : ownCv('application', { id: a.id, reference: a.number, title: a.vacancy.title, sentAt: a.cvUpdatedAt ?? a.appliedAt, earlierCvs: a.earlierCvs }, a.cv);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {a.viewer === 'interviewer' ? <BackLink href={MY_HIRING_PATH}>My Hiring</BackLink> : <BackLink href={vacancyHref(a.vacancy.id)}>{a.vacancy.title}</BackLink>}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{a.fullName}</h1>
          <StageBadge stage={a.stage} filteredOut={a.filteredOut} />
          {/* where a shortlisted applicant stands in the hiring steps (29 October 2026) */}
          <HiringStepBadge step={a.hiringStep} />
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

      {/* at Shortlisted, their review (owner, 29 October 2026: "Manager view the shortlisted and accept or reject them"): "Accepted by the hiring manager" */}
      {a.suggestion && (
        <div role="note" className={`rounded-lg px-4 py-3 text-sm ${a.stage === 'shortlisted' && a.suggestion.kind === 'next' ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}>
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
      {a.filteredOut && (
        <div role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          They didn&apos;t meet a must-have question, so they were filtered out. Restore them to consider them anyway.
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
            {a.linkedin ? (
              <a href={a.linkedin} target="_blank" rel="noopener noreferrer nofollow">
                Open profile
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

      {/* HR's screening call before the interview (owner, 29 October 2026: "HR Screening and scheduling"; "Screening call + result") */}
      {screening && <ScreeningCallCard card={screening} action={saveScreeningCall.bind(null, a.id)} />}

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
          <SuggestForm action={suggestNext.bind(null, a.id)} stage={a.stage} />
        </section>
      )}

      {/* HR's notes are screening comments now (24 October 2026), the earlier ones moved in as "HR (earlier notes)" */}
      <ScreeningCommentsCard data={comments} notLoaded={commentsNotLoaded} mode="record" comments={comments ? commentsOfRecord(comments, ownKey) : []} defaultTarget={ownKey} />

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

export default function ApplicantPage({ params }: PageProps<'/recruitment/applicants/[id]'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <Applicant params={params} />
      </Suspense>
    </div>
  );
}
