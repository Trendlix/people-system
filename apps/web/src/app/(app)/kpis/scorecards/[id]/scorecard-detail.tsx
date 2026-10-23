import Link from 'next/link';
import { notFound } from 'next/navigation';
import { KPI_PRACTICE_BANNER, KPI_PRACTICE_NOTE, KPI_STEP_LABELS, kpiAttendanceSoFar, kpiCalibrationStep, kpiMonthName, kpiStepDeadline, type KpiPracticeStep, type KpiScorecardView } from '@trendlix/shared';
import { CLevelBadge } from '@/components/c-level-badge';
import { DeleteForm } from '@/components/form';
import { formatDate, formatDateTime, titleCase } from '@/lib/format';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { appBack, type Surface } from '@/lib/surface';
import { todayInCairo } from '../../../employees/ui';
import { BackLink, Empty, UUID } from '../../../organization/ui';
import { calibrate, savePicks, sign } from '../../actions';
import { kpiNotLoaded, loadScorecard } from '../../data';
import {
  openPracticeSteps,
  practiceDoneText,
  practiceMode,
  practiceSignAs,
  practiceStep,
  practiceStepHref,
  practiceStepLabel,
  practiceWho,
  standInText,
  startedSentence,
  unplacedText,
} from '../../practice';
import { deletePractice, practiceCalibrate, practicePicks, practiceSign } from '../../practice-actions';
import {
  actionText,
  calibrationMetrics,
  doneText,
  formMetrics,
  isOwn,
  payrollText,
  scorecardBack,
  scorerText,
  sheetMode,
  stepDeadlineText,
  stepsLabel,
  stepTone,
} from '../../scorecard';
import { PracticeBadge, StatusBadge } from '../../ui';
import { ScorecardForm, ScorecardView, SignForm } from './scorecard-forms';
import { shownCode } from '@/lib/hidden';

// A KPI scorecard (owner, 21 October 2026: "Full framework per role"; "Self, manager, HR, sign-off"; "Last month's KPI,
// this pay"), for its employee, its scorer, HR (never a C-level person's), the CEO and a Super Admin (anyone else gets
// the 404 page: the API says it isn't there): who and which month, the template's version, who scores it, the step it
// is at and by when, and the payroll it counts in; the final % with its level and its pillars with their metrics
// (its template version's, the automatic Attendance metric in the pillar they chose); the comments of each step and every step taken. While it
// waits for the caller, their step's form: the self-rating, the scoring, HR's calibration or the sign-off. What was
// just done shows at the top (?done=). Shown on the site and on the phone pages (owner, 20 October 2026: the employee
// app), where the back link goes to the section's list and what is done on it comes back there.
// A practice scorecard (owner, 22 October 2026: "Practice scorecards": "It's marked Practice everywhere"; "Every step can
// be done by me, or through View as"): the banner "Practice: not counted anywhere", who started it and on which version
// (a draft marked), and for its starter or a Super Admin in their own session the steps they stand in for ("Rate as
// Omar (practice)", "Score as the manager", "Calibrate as HR", "Sign as Omar", "Sign as the manager"), the one chosen
// (?as=) with its form, said for whom it is kept; no deadline holds a step back. A Super Admin may delete it. Viewing as
// the employee or the manager, it shows as they would see it, with its banner, and their own forms.

type Query = Record<string, string | string[] | undefined>;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
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

/** The step deadlines of the month, the one it is at in bold; HR's only when HR calibrates (after a manager's scoring). */
function Deadlines({ view: v }: { view: KpiScorecardView }) {
  const now = kpiStepDeadline(v.status, v.deadlines);
  const rows = [
    { label: 'Self-rating', date: v.deadlines.selfRating },
    { label: 'Scoring', date: v.deadlines.manager },
    ...(kpiCalibrationStep(v.scorer.kind) ? [{ label: 'HR calibration', date: v.deadlines.hr }] : []),
    { label: 'Sign-off', date: v.deadlines.signOff },
  ];
  return (
    <ul className="space-y-0.5 tabular-nums">
      {rows.map((r) => (
        <li key={r.label} className={r.date === now ? 'font-semibold' : 'text-muted'}>
          {r.label} by {formatDate(r.date)}
        </li>
      ))}
    </ul>
  );
}

/** The comments on the whole month, by step: those the caller may see, except the one their own form edits. */
function Comments({ view: v, editing }: { view: KpiScorecardView; editing: 'self' | 'score' | 'calibrate' | 'view' }) {
  const rows = [
    { who: 'Self-rating', text: editing === 'self' ? null : v.comments.self },
    { who: 'Manager', text: editing === 'score' ? null : v.comments.manager },
    { who: 'HR', text: editing === 'calibrate' ? null : v.comments.hr },
    { who: 'Employee’s sign-off', text: v.comments.employeeSign },
    { who: 'Manager’s sign-off', text: v.comments.managerSign },
  ].filter((r): r is { who: string; text: string } => !!r.text?.trim());
  if (!rows.length) return <p className="text-sm text-muted">No comments yet.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.who}>
          <p className="text-xs font-semibold text-muted">{r.who}</p>
          <p className="mt-0.5 text-sm whitespace-pre-line">“{r.text}”</p>
        </li>
      ))}
    </ul>
  );
}

const DOT: Record<'ok' | 'warn' | 'none', string> = { ok: 'bg-ok', warn: 'bg-warn', none: 'bg-line' };

/** Every step taken, in order: what, by whom and when, with its comment. */
function Steps({ view: v }: { view: KpiScorecardView }) {
  if (!v.steps.length) return <p className="text-sm text-muted">No steps logged yet.</p>;
  return (
    <ol className="space-y-3 border-l-2 border-line-soft pl-4" aria-label={`Every step of the scorecard, ${stepsLabel(v.steps.length)}`}>
      {v.steps.map((s, i) => (
        <li key={`${s.kind}:${s.at}:${i}`} className="relative">
          <span aria-hidden="true" className={`absolute top-1.5 -left-[23px] size-3 rounded-full border-2 border-card ${DOT[stepTone(s.kind)]}`} />
          <p className="text-sm font-medium">{s.label || KPI_STEP_LABELS[s.kind] || s.kind}</p>
          {s.comment && <p className="mt-0.5 text-sm whitespace-pre-line">“{s.comment}”</p>}
          <p className="text-xs text-muted">
            {s.by && <span className="break-words">{s.by} · </span>}
            {formatDateTime(s.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Over a practice scorecard: that it counts nowhere, who started it on which version, and the draft's left-out metrics. */
function PracticeBanner({ view: v }: { view: KpiScorecardView }) {
  if (!v.practice) return null;
  const unplaced = unplacedText(v.unplaced);
  return (
    <div role="note" className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
      <p className="font-semibold">{KPI_PRACTICE_BANNER}</p>
      <p className="mt-0.5">{KPI_PRACTICE_NOTE}</p>
      <p className="mt-1 text-xs">{startedSentence(v.practice, v.templateVersion)}</p>
      {unplaced && <p className="mt-1 text-xs">{unplaced}</p>}
    </div>
  );
}

/** The steps the starter (or a Super Admin) stands in for now, the one shown marked, and for whom it is kept. */
function StandInSteps({ view: v, step }: { view: KpiScorecardView; step: KpiPracticeStep }) {
  return (
    <Section title="Take a Step">
      <p className="text-sm text-muted">Take each step yourself, for whoever it belongs to. No deadline holds a step back.</p>
      <nav aria-label="Practice steps" className="mt-3 flex flex-wrap gap-2">
        {openPracticeSteps(v.standIn).map((s) => (
          <Link key={s} href={practiceStepHref(v.id, s)} aria-current={s === step ? 'true' : undefined} className={`btn no-underline ${s === step ? 'btn-primary' : 'btn-secondary'}`}>
            {practiceStepLabel(s, v)}
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-sm font-semibold text-accent">{standInText(step, v)}</p>
    </Section>
  );
}

/** Who has signed, once it is at the sign-off. */
function Signatures({ view: v }: { view: KpiScorecardView }) {
  const row = (done: boolean, who: string) => (
    <span className={`block ${done ? 'text-ok' : 'text-muted'}`}>
      {done ? '✓' : '○'} {who} {done ? 'signed' : 'not signed yet'}
    </span>
  );
  return (
    <>
      {row(v.signed.employee, 'The employee')}
      {row(v.signed.manager, v.scorer.kind === 'manager' ? 'The manager' : 'The scorer')}
      {v.unsigned && <span className="block text-warn">Final without every signature, by the sign-off day</span>}
    </>
  );
}

export async function ScorecardDetail({
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
  const [user, loaded] = await Promise.all([getCurrentUser(), loadScorecard(id)]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind === 'forbidden') return <Empty>This scorecard isn&apos;t yours to see.</Empty>;
  if (loaded.kind === 'failed') return <Empty>{kpiNotLoaded(loaded, 'scorecard')}</Empty>;
  const v = loaded.value;
  const own = isOwn(v, user.employeeId);
  const back = surface === 'site' ? scorecardBack(user, v) : appBack(surface);
  const done = v.practice ? practiceDoneText(query, v) : doneText(query, v);
  // a practice scorecard's step its starter (or a Super Admin) stands in for, on the site (?as=: the first open one)
  const standStep = surface === 'site' ? practiceStep(query, v.standIn) : null;
  const signAs = standStep ? practiceSignAs(standStep) : null;
  const mode = standStep ? (practiceMode(standStep) ?? 'view') : sheetMode(v.can);
  const today = todayInCairo();
  const soFar = !!v.practice && kpiAttendanceSoFar(v.month, today);
  const todo = actionText(v);
  const step = stepDeadlineText(v);
  const where = [v.jobTitle, v.department].filter(Boolean).join(' · ');

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink href={back.href}>{back.label}</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{titleCase(`${kpiMonthName(v.month)} KPI scorecard`)}</h1>
          <StatusBadge status={v.status} scorer={v.scorer.kind} />
          {v.practice && <PracticeBadge />}
          {v.practice?.draft && <span className="badge">Draft version {v.templateVersion}</span>}
          {v.confidential && <CLevelBadge title="A C-level person: the CEO scores their KPI, and HR doesn’t see it." />}
        </div>
        <p className="text-muted">
          {own ? 'Yours' : v.employee.fullNameEn}
          {where && ` · ${where}`}
        </p>
        {todo && <p className="text-sm font-semibold text-accent">Your step: {todo}</p>}
      </div>
      <PracticeBanner view={v} />
      {done && (
        <p role="status" className={`rounded-lg px-4 py-3 text-sm ${done.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
          {done.text}
        </p>
      )}

      <Section title="About This Scorecard">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Employee">
            {v.employee.fullNameEn} {shownCode(v.employee.employeeCode) && <span className="text-muted">· {v.employee.employeeCode}</span>}
          </Fact>
          <Fact label="Month">{kpiMonthName(v.month)}</Fact>
          <Fact label="Template">
            Version {v.templateVersion}
            {v.practice?.draft && <span className="text-muted"> (draft)</span>}
            {v.jobTitle && <span className="block text-xs text-muted">{v.jobTitle}</span>}
          </Fact>
          <Fact label="Scored by">{scorerText(v.scorer)}</Fact>
          <Fact label="Where it stands">
            {step ?? 'Final and locked'}
            {v.selfMissed && (
              <span className="block text-xs text-warn">
                {v.practice ? 'The self-rating was left out: the scoring was sent without it.' : 'The self-rating was missed: not sent by its day.'}
              </span>
            )}
          </Fact>
          <Fact label="Deadlines">
            <Deadlines view={v} />
          </Fact>
          <Fact label="Pay">
            {v.practice ? (
              <>
                Not counted
                <span className="block text-xs text-muted">A practice scorecard never reaches payroll or the payslips.</span>
              </>
            ) : (
              <>
                {payrollText(v.payrollMonth)}
                <span className="block text-xs text-muted">Its final % is the KPI that payroll&apos;s variable part follows.</span>
              </>
            )}
          </Fact>
          {(v.status === 'sign_off' || v.status === 'final') && (
            <Fact label="Signatures">
              <Signatures view={v} />
            </Fact>
          )}
        </dl>
      </Section>

      {standStep && <StandInSteps view={v} step={standStep} />}

      {mode === 'view' ? (
        <ScorecardView view={v} own={own} soFar={soFar} />
      ) : standStep ? (
        <ScorecardForm
          // a new form for each step stood in for, starting from that step's picks
          key={standStep}
          view={v}
          mode={mode}
          today={today}
          standIn={practiceWho(standStep, v)}
          soFar={soFar}
          action={mode === 'calibrate' ? practiceCalibrate.bind(null, v.id, calibrationMetrics(v)) : practicePicks.bind(null, v.id, mode, formMetrics(v))}
        />
      ) : (
        <ScorecardForm
          view={v}
          mode={mode}
          today={today}
          soFar={soFar}
          action={mode === 'calibrate' ? calibrate.bind(null, v.id, calibrationMetrics(v)) : savePicks.bind(null, v.id, mode, formMetrics(v))}
        />
      )}

      {standStep && signAs ? (
        <Section title={titleCase(practiceStepLabel(standStep, v))}>
          <SignForm key={standStep} action={practiceSign.bind(null, v.id, signAs)} as={signAs} deadline={v.deadlines.signOff} practice />
        </Section>
      ) : (
        !standStep &&
        (v.can.signAsEmployee || v.can.signAsManager) && (
          <Section title={v.can.signAsEmployee ? 'Sign Your Scorecard' : 'Sign as the Manager'}>
            <SignForm action={sign.bind(null, v.id)} as={v.can.signAsEmployee ? 'employee' : 'manager'} deadline={v.deadlines.signOff} practice={!!v.practice} />
          </Section>
        )
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="Comments">
          <Comments view={v} editing={mode} />
        </Section>
        <Section title="Every Step">
          <Steps view={v} />
        </Section>
      </div>

      {/* only a Super Admin deletes (owner's decision, 15 October 2026); a practice scorecard in one click (22 October 2026) */}
      {v.practice && surface === 'site' && canDelete(user) && (
        <div className="border-t border-line pt-5">
          <DeleteForm
            action={deletePractice.bind(null, v.id)}
            confirmText={`Delete this practice scorecard of ${v.employee.fullNameEn}? Its picks, comments and steps go with it; nothing real changes.`}
            label="Delete practice scorecard"
          />
        </div>
      )}
    </div>
  );
}
