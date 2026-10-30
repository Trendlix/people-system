import { Bell, ClipboardCheck, Signature, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { KPI_LEVEL_LABELS, KPI_PAY_TIMING_NOTE, KPI_PRACTICE_BANNER, kpiMonthName, kpiPayrollMonth, type KpiScorecardSummary, type KpiSettings } from '@trendlix/shared';
import { ArrowLink, IconTile, Panel, PanelHead, Pill, Ring } from '@/components/design';
import { formatDate } from '@/lib/format';
import { KPI_PATHS } from '@/lib/kpi-paths';
import { reviewSteps, ringShare, type Shown } from './mine';
import { actionButton, ownCardText, payrollText, percentText, scorecardsLabel } from './scorecard';
import { LevelBadge, PracticeBadge, ScoreBar, StatusBadge } from './ui';

// My KPIs' parts in the owner's design (Figma "PeopleTrendlix", the desktop version, 30 October 2026): the large card
// at the top (the orbit while there is no score, the ring with the latest score once one is shown), what waits for the
// employee, the history, "How it works" with the four steps, and the payroll card. Only My KPIs uses them; colours from
// globals.css, so they follow the light and the dark look.

/** The hero's title: the design's 42px, regular, tight. */
const HERO_TITLE = 'mt-2.5 max-w-[460px] text-[2rem] leading-[1.05] font-normal tracking-[-0.055em] text-balance sm:text-[2.3rem]';

/** The large card at the top: the picture on the left, the words on the right (one over the other when narrow). */
function Hero({ art, labelledBy, children }: { art: React.ReactNode; labelledBy: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={labelledBy} className="card @container p-6 sm:p-[38px]">
      <div className="grid items-center gap-8 @3xl:grid-cols-2">
        <div className="flex justify-center">{art}</div>
        <div className="min-w-0 max-w-[500px]">{children}</div>
      </div>
    </section>
  );
}

/**
 * The design's orbit: two rings round a disc with a figure, and the steps' numbers on them. Only a picture (hidden from
 * screen readers): the words beside it say everything.
 */
function Orbit({ figure }: { figure: string }) {
  const dots = [
    { n: '01', at: 'left-[43px] top-[15px]' },
    { n: '02', at: 'left-[202px] top-[83px]' },
    { n: '03', at: 'left-[63px] top-[187px]' },
  ];
  return (
    <div aria-hidden="true" className="relative size-[230px] shrink-0">
      <span className="absolute inset-0 rounded-full border border-line" />
      <span className="absolute inset-[29px] rounded-full border border-line" />
      <span className="absolute inset-[63px] flex items-center justify-center rounded-full border border-line bg-raised text-5xl font-normal tracking-[-0.06em] tabular-nums">
        {figure}
      </span>
      {dots.map((d) => (
        <span key={d.n} className={`absolute ${d.at} flex size-8 items-center justify-center rounded-full bg-accent text-[10px] text-on-accent tabular-nums`}>
          {d.n}
        </span>
      ))}
    </div>
  );
}

/**
 * No scorecard yet: when a month's opens (owner, 21 October 2026: "Last month's KPI, this pay"), and that the employee
 * is told then (the API's notice "Your October KPI is open" to their inbox and phone, by itself: nothing to ask for).
 */
export function NoScorecardsHero() {
  return (
    <Hero art={<Orbit figure="0" />} labelledBy="kpi-none">
      <p className="eyebrow">No scorecards yet</p>
      <h2 id="kpi-none" className={HERO_TITLE}>
        Your first scorecard isn’t open yet.
      </h2>
      <p className="mt-3.5 max-w-[440px] text-sm text-muted">
        A month’s scorecard opens on the 1st of the next month once HR has published the KPI template for your job title.
      </p>
      <p className="mt-6 inline-flex items-center gap-2 text-sm">
        <Bell aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.6} />
        You get a notification when it opens.
      </p>
    </Hero>
  );
}

/**
 * The latest score shown to the employee (from the sign-off on), in the design's ring: its final %, its level, where it
 * stands and the payroll it counts in (a practice one counts nowhere, and says so), and the way in.
 */
export function LatestScoreHero({ scorecard: s }: { scorecard: Shown<KpiScorecardSummary> }) {
  const month = kpiMonthName(s.month);
  const level = KPI_LEVEL_LABELS[s.level];
  return (
    <Hero
      labelledBy="kpi-latest"
      art={
        <Ring share={ringShare(s.finalPercent)} size={230} stroke={12} label={`Your final score for ${month}: ${percentText(s.finalPercent)}, ${level}`}>
          <span className="text-5xl font-normal tracking-[-0.06em] tabular-nums">{percentText(s.finalPercent)}</span>
          <span className="mt-1.5 text-xs text-muted">Final %</span>
        </Ring>
      }
    >
      <p className="eyebrow">Latest score · {month}</p>
      <h2 id="kpi-latest" className={HERO_TITLE}>
        {level}.
      </h2>
      <p className="mt-3.5 text-sm text-muted">{s.practice ? `${KPI_PRACTICE_BANNER}.` : `${payrollText(kpiPayrollMonth(s.month))}.`}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={s.status} scorer={s.scorer.kind} />
        {s.practice && <PracticeBadge />}
      </div>
      <ArrowLink href={KPI_PATHS.scorecard(s.id)} className="mt-6">
        Open the scorecard<span className="sr-only"> of {month}</span>
      </ArrowLink>
    </Hero>
  );
}

/**
 * Scorecards, none with its score shown yet: the newest, where it stands and by when, and that the score shows at the
 * sign-off (until then the employee sees only their own self-rating); a final one without a score says so.
 */
export function PendingScoreHero({ scorecard: s }: { scorecard: KpiScorecardSummary }) {
  const month = kpiMonthName(s.month);
  const final = s.status === 'final';
  return (
    <Hero art={<Orbit figure="—" />} labelledBy="kpi-pending">
      <p className="eyebrow">{month} scorecard</p>
      <h2 id="kpi-pending" className={HERO_TITLE}>
        {final ? 'This month has no score.' : 'Your score shows at the sign-off.'}
      </h2>
      {!final && <p className="mt-3.5 text-sm text-muted">Until then you see only your own self-rating.</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={s.status} scorer={s.scorer.kind} />
        {s.deadline && <span className="text-xs text-muted tabular-nums">Due {formatDate(s.deadline)}</span>}
        {s.practice && <PracticeBadge />}
      </div>
      <ArrowLink href={KPI_PATHS.scorecard(s.id)} className="mt-6">
        Open the scorecard<span className="sr-only"> of {month}</span>
      </ArrowLink>
    </Hero>
  );
}

/** What waits for the employee on their own scorecards: one row each, with its deadline and the way in. */
export function WaitingForYou({ scorecards }: { scorecards: KpiScorecardSummary[] }) {
  return (
    <section aria-label="Waiting for You" className="card p-[22px]">
      <PanelHead eyebrow="Your turn" title="Waiting for You" />
      <ul className="mt-5 space-y-2.5">
        {scorecards.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raised p-[13px]">
            <IconTile icon={s.action === 'sign' ? Signature : ClipboardCheck} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{ownCardText(s)}</span>
              <span className="mt-0.5 block text-xs text-muted">
                {s.action === 'self_rate'
                  ? 'Pick how you did on each metric, with a comment if you like. Your manager sees it when scoring.'
                  : 'Read the score, the picks and the comments, then sign that you have read it.'}
              </span>
            </span>
            <Link href={KPI_PATHS.scorecard(s.id)} className="btn btn-primary">
              {actionButton(s)}
              <span className="sr-only"> on your {kpiMonthName(s.month)} KPI scorecard</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every month's scorecard, newest first: the final % with a bar and the level, the step, and the way in. */
export function History({ scorecards }: { scorecards: KpiScorecardSummary[] }) {
  return (
    <section aria-label="History" className="card overflow-hidden">
      <div className="p-[22px] pb-5">
        <PanelHead eyebrow="Your scorecards" title="History" />
      </div>
      <div className="overflow-x-auto border-t border-line">
        {/* the first and last columns in line with the panel's head (22px) */}
        <table className="table [&_:is(th,td):first-child]:pl-[22px] [&_:is(th,td):last-child]:pr-[22px]">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col" className="min-w-48">
                Final %
              </th>
              <th scope="col">Level</th>
              <th scope="col">Step</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {scorecards.map((s) => (
              <tr key={s.id} className="align-top">
                <td className="whitespace-nowrap">
                  <Link href={KPI_PATHS.scorecard(s.id)} className="font-medium">
                    {kpiMonthName(s.month)}
                  </Link>
                  {s.practice && <PracticeBadge className="ml-1.5" />}
                  <span className="block text-xs text-muted">Template version {s.templateVersion}</span>
                </td>
                <td>
                  {s.finalPercent !== null && s.level ? (
                    <span className="flex items-center gap-3">
                      <span className="w-14 font-medium tabular-nums">{percentText(s.finalPercent)}</span>
                      <span className="w-full max-w-40">
                        <ScoreBar percent={s.finalPercent} level={s.level} />
                      </span>
                    </span>
                  ) : (
                    <>
                      <span className="text-muted">—</span>
                      <span className="block text-xs text-muted">{s.status === 'final' ? 'No score' : 'Shown at the sign-off'}</span>
                    </>
                  )}
                </td>
                <td>
                  <LevelBadge level={s.level} />
                </td>
                <td className="min-w-40">
                  <StatusBadge status={s.status} scorer={s.scorer.kind} />
                  {s.selfMissed && <span className="mt-1 block text-xs text-warn">Self-rating missed</span>}
                  {s.unsigned && <span className="mt-1 block text-xs text-warn">Final without every signature</span>}
                </td>
                <td className="text-right">
                  <Link href={KPI_PATHS.scorecard(s.id)} className={s.action ? 'btn btn-primary min-h-9 px-3 whitespace-nowrap' : 'text-sm font-medium'}>
                    {actionButton(s)}
                    <span className="sr-only"> your {kpiMonthName(s.month)} KPI scorecard</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-[22px] py-3 text-sm text-muted">{scorecardsLabel(scorecards.length)}, newest first.</p>
    </section>
  );
}

/**
 * How a month's review goes (owner, 21 October 2026: "Self, manager, HR, sign-off"): the four steps, numbered, each with
 * the day of the next month it is due by (the KPI settings; left out when they couldn't be read).
 */
export function HowItWorks({ settings, className = '' }: { settings: KpiSettings | null; className?: string }) {
  return (
    <Panel eyebrow="How it works" title="Monthly review process" className={className}>
      <div className="@container">
        <ol className="grid gap-2.5 @md:grid-cols-2 @2xl:grid-cols-4">
          {reviewSteps(settings).map((step, i) => (
            <li key={step.title} className="flex min-h-[135px] flex-col rounded-xl border border-line bg-raised p-[13px]">
              <span aria-hidden="true" className="flex size-[25px] items-center justify-center rounded-full bg-accent text-[10px] text-on-accent tabular-nums">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-[18px] text-sm">{step.title}</h3>
              <p className="mt-1.5 text-xs leading-snug text-muted">{step.text}</p>
              {step.due && (
                <div className="mt-auto pt-3">
                  <Pill>{step.due}</Pill>
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}

/**
 * What the score does (owner, 21 October 2026: "Last month's KPI, this pay"), on the design's solid card (black on the
 * light look, off-white on the dark), with its bars as a picture.
 */
export function PayrollImpact() {
  const bars = [34, 49, 63, 77];
  return (
    <section aria-labelledby="kpi-payroll" className="card overflow-hidden bg-accent p-[22px] pb-[104px] text-on-accent">
      <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl border border-on-accent/35">
        <TrendingUp className="size-[18px]" strokeWidth={1.6} />
      </span>
      <p className="mt-6 text-[11px] tracking-[0.12em] text-on-accent/60 uppercase">Payroll impact</p>
      <h2 id="kpi-payroll" className="mt-1.5 text-2xl font-normal tracking-[-0.045em]">
        One clear final score.
      </h2>
      <p className="mt-2.5 max-w-[320px] text-xs leading-relaxed text-on-accent/65">
        {`Each month's scorecard ends in one final %, with its level. ${KPI_PAY_TIMING_NOTE} Open any scorecard to see its metrics, the comments and every step.`}
      </p>
      <div aria-hidden="true" className="absolute right-[22px] bottom-0 flex items-end gap-[5px]">
        {bars.map((h) => (
          <span key={h} className="w-6 rounded-t-[5px] bg-on-accent/75" style={{ height: h }} />
        ))}
      </div>
    </section>
  );
}
