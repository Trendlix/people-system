import {
  isSignedStage,
  nextFirstOfMonth,
  PAY_CHANGE_LABELS,
  PAY_STAGE_LABELS,
  RAISE_REASON_LABELS,
  type PayEvent,
  type PayStage,
  type SalarySummary,
} from '@trendlix/shared';
import { formatDate, formatDateTime } from '../../../../../lib/format';
import type { PaidMonth } from '../../../../../lib/raise-types';
import { monthName } from '../../../payroll/list';
import { LANGUAGE_LABELS, NOT_DRAWN_YET, PAYSLIP_LANGUAGES, type PayslipLanguage } from '../../../payroll/payslips';
import { formatEgp } from '../contracts/salary';

// The Salary History on the Employment tab, in words and as a chart (owner, 16 October 2026: "think about tracking the
// salary raises through the employment period too"). For each employment: the summary it opens with (the gross it
// started with, the gross now, the change since joining, the raises and the last one, and a signed raise still to come),
// a step chart of the gross over the employment, every pay event in order (the hire, each amendment, each new contract,
// each renewal, with the same pay or the change), and the pay actually received, month by month, with the payslips.
// HR, Finance and the CEO only, as salaries. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

// ---------- words ----------

/** What an event is: "Hired", "Amendment", "New contract", "Renewal · same pay" or "Renewal · new pay". */
export function eventTitle(e: Pick<PayEvent, 'change' | 'samePay'>): string {
  if (e.change === 'renewal') return `${PAY_CHANGE_LABELS.renewal} · ${e.samePay ? 'same pay' : 'new pay'}`;
  return PAY_CHANGE_LABELS[e.change] ?? e.change;
}

/** A percent with its sign: 25 → "+25%", 12.5 → "+12.5%", -10 → "−10%". */
export function signedPercent(percent: number): string {
  const shown = Math.round(Math.abs(percent) * 10) / 10;
  return `${percent < 0 ? '−' : '+'}${shown}%`;
}

/** An amount with its sign: 2500 → "+EGP 2,500.00", -1000 → "−EGP 1,000.00". */
export function signedEgp(amount: number): string {
  return `${amount < 0 ? '−' : '+'}${formatEgp(Math.abs(amount))}`;
}

/**
 * A change of the gross: "+EGP 2,500.00 (+25%)", "−EGP 1,000.00 (−10%)", without the percent from nothing; "No change"
 * when it is the same. Null for none (the hire).
 */
export function changeText(d: { amount: number; percent: number | null } | null): string | null {
  if (!d) return null;
  if (Math.round(d.amount * 100) === 0) return 'No change';
  return d.percent === null ? signedEgp(d.amount) : `${signedEgp(d.amount)} (${signedPercent(d.percent)})`;
}

/** How long ago, in whole months: "this month", "1 month ago", "3 months ago", "1 year ago", "2 years and 3 months ago". */
export function monthsAgoText(months: number): string {
  if (months <= 0) return 'this month';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const of = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (years === 0) return `${of(rest, 'month')} ago`;
  return rest === 0 ? `${of(years, 'year')} ago` : `${of(years, 'year')} and ${of(rest, 'month')} ago`;
}

/**
 * An amount from what it was to what it is: "EGP 10,000.00 → EGP 12,500.00"; "EGP 500.00, as before" when it is the
 * same; just the amount without one before (the hire). Allowances of 0 throughout are "None".
 */
export function fromToText(from: number | null, to: number): string {
  if (from === null) return to === 0 ? 'None' : formatEgp(to);
  if (Math.round(from * 100) === Math.round(to * 100)) return to === 0 ? 'None' : `${formatEgp(to)}, as before`;
  return `${formatEgp(from)} → ${formatEgp(to)}`;
}

// ---------- the summary ----------

export interface Figure {
  key: string;
  label: string;
  value: string;
  note: string | null;
}

/**
 * The figures the history opens with: the starting gross (the first signed version's, from `startedOn`), the current
 * gross, the change since joining, the number of raises with the last one's date and how long ago, and the next signed
 * raise not yet in force, if any.
 */
export function summaryFigures(s: SalarySummary, startedOn: string | null): Figure[] {
  const figures: Figure[] = [
    { key: 'starting', label: 'Starting gross', value: formatEgp(s.startingGross), note: startedOn && `From ${formatDate(startedOn)}` },
    { key: 'current', label: 'Current gross', value: formatEgp(s.currentGross), note: null },
    {
      key: 'change',
      label: 'Change since joining',
      value: changeText(s.change) ?? 'No change',
      note: null,
    },
    {
      key: 'raises',
      label: 'Raises',
      value: String(s.raises),
      note: s.lastRaise ? `Last on ${formatDate(s.lastRaise.date)}, ${monthsAgoText(s.lastRaise.monthsAgo)}` : 'None yet',
    },
  ];
  if (s.next) figures.push({ key: 'next', label: 'Next raise', value: formatEgp(s.next.gross), note: `From ${formatDate(s.next.date)}, signed` });
  return figures;
}

// ---------- the timeline ----------

/** The stage pill's colours, as the payroll and the change requests word theirs: waiting (warn), approved, signed (ok), past. */
export const STAGE_BADGE: Record<PayStage, string> = {
  draft: 'bg-line-soft text-muted',
  returned: 'bg-danger-soft text-danger',
  pending_ceo: 'bg-warn-soft text-warn',
  approved: '', // the badge's own accent colours
  signed: 'bg-ok-soft text-ok',
  replaced: 'bg-line-soft text-muted',
  ended: 'bg-line-soft text-muted',
};

export interface EventView {
  key: string;
  title: string;
  /** "CON-2026-0001 · version 2". */
  reference: string;
  stage: PayStage;
  stageLabel: string;
  /** Paid (signed, since replaced or ended) or not yet. */
  signed: boolean;
  /** "From 01/11/2026", with the end when it has one. */
  effective: string;
  gross: string;
  /** The gross's change ("+EGP 2,500.00 (+25%)", "Same pay"); null for the hire. */
  change: string | null;
  allowances: string;
  total: string;
  /** Pay by the hour: the rate (the gross is then the monthly estimate). */
  hourly: string | null;
  reason: string | null;
  promotion: string | null;
  approved: string | null;
  signedOn: string | null;
  insuredWage: string | null;
}

/** An event as the timeline shows it. */
export function eventView(e: PayEvent): EventView {
  const promotion = e.promotion && [e.promotion.jobTitle, e.promotion.grade && `grade ${e.promotion.grade}`].filter(Boolean).join(', ');
  return {
    key: e.contractId,
    title: eventTitle(e),
    reference: `${e.number} · version ${e.version}`,
    stage: e.stage,
    stageLabel: PAY_STAGE_LABELS[e.stage] ?? e.stage,
    signed: isSignedStage(e.stage),
    effective:
      e.endDate && e.change !== 'amendment' ? `${formatDate(e.effectiveDate)} – ${formatDate(e.endDate)}` : `From ${formatDate(e.effectiveDate)}`,
    gross: fromToText(e.from?.gross ?? null, e.to.gross),
    change: e.from === null ? null : e.samePay ? 'Same pay' : changeText(e.difference),
    allowances: fromToText(e.from?.allowances ?? null, e.to.allowances),
    total: fromToText(e.from?.total ?? null, e.to.total),
    hourly: e.payBasis === 'hourly' && e.hourlyRate !== null ? `${formatEgp(e.hourlyRate)} an hour; the gross is the monthly estimate` : null,
    reason: e.reason ? (RAISE_REASON_LABELS[e.reason] ?? e.reason) : null,
    promotion: promotion || null,
    approved: e.approvedAt ? `${e.approvedBy ? `${e.approvedBy}, ` : ''}${formatDateTime(e.approvedAt)}` : null,
    signedOn: e.signedOn ? formatDate(e.signedOn) : null,
    insuredWage: e.insuredWageFrom ? `Follows the new pay from ${formatDate(e.insuredWageFrom)}` : null,
  };
}

/** The first signed event's date: when the starting gross applied from. */
export function firstSignedDate(events: readonly PayEvent[]): string | null {
  const signed = events.filter((e) => isSignedStage(e.stage)).sort((a, b) => a.version - b.version);
  return signed[0]?.effectiveDate ?? null;
}

/** "3 pay events", "1 pay event". */
export const eventsLabel = (n: number) => `${n} ${n === 1 ? 'pay event' : 'pay events'}`;

// ---------- the pay received ----------

export interface PaidRow {
  lineId: string;
  runId: string;
  /** "October 2026". */
  title: string;
  paidOn: string | null;
  net: number;
  transfer: number;
  onHold: boolean;
  /** The payslips to open, with a note on each not drawn yet; none for a month on hold. */
  links: { language: PayslipLanguage; label: string; note: string | null }[];
}

/** The paid payroll months, oldest first, as the timeline runs; each with its payslips (none for a month on hold). */
export function paidRows(paid: readonly PaidMonth[]): PaidRow[] {
  return [...paid]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((p) => ({
      lineId: p.lineId,
      runId: p.runId,
      title: monthName(p.month),
      paidOn: p.paidOn,
      net: p.net,
      transfer: p.transfer,
      onHold: p.onHold,
      links: p.onHold
        ? []
        : PAYSLIP_LANGUAGES.map((language) => ({ language, label: LANGUAGE_LABELS[language], note: p.payslips?.[language] ? null : NOT_DRAWN_YET })),
    }));
}

/** What was received in all: the months paid (those on hold left out, as nothing was paid) and their net and transfer. */
export function paidTotals(paid: readonly PaidMonth[]): { months: number; net: number; transfer: number } {
  const received = paid.filter((p) => !p.onHold);
  const sum = (pick: (p: PaidMonth) => number) => Math.round(received.reduce((s, p) => s + pick(p) * 100, 0)) / 100;
  return { months: received.length, net: sum((p) => p.net), transfer: sum((p) => p.transfer) };
}

/** "1 month", "14 months". */
export const monthsLabel = (n: number) => `${n} ${n === 1 ? 'month' : 'months'}`;

// ---------- the chart ----------

/** A day number from YYYY-MM-DD, to place dates to scale. */
const dayOf = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000;

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** An axis amount, compact: 0 → "0", 2500 → "2.5K", 15000 → "15K", 1250000 → "1.25M". */
export function compactAmount(n: number): string {
  const trim = (v: number) => String(Math.round(v * 100) / 100);
  if (Math.abs(n) >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (Math.abs(n) >= 1_000) return `${trim(n / 1_000)}K`;
  return trim(n);
}

/** Round ticks from 0 up past `max` (with a little room above it): about four steps of 1, 2, 2.5 or 5 × a power of ten. */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const top = Math.ceil((max * 1.05) / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/** The 1st of each month from `from` to `to` (YYYY-MM-DD), every `step` months counted from January. */
function monthTicks(from: string, to: string, step: number): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  if (from.slice(8) !== '01') [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  while (`${y}-${String(m).padStart(2, '0')}-01` <= to) {
    if ((y * 12 + m - 1) % step === 0) out.push(`${y}-${String(m).padStart(2, '0')}-01`);
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return out;
}

export interface ChartPoint {
  key: string;
  x: number;
  y: number;
  date: string;
  gross: number;
  /** In force before today, in force today, or signed to take effect later. */
  state: 'past' | 'current' | 'upcoming';
  /** For its tooltip: "Amendment · From 01/11/2026 · EGP 12,500.00". */
  label: string;
}

export interface StepChart {
  width: number;
  height: number;
  plot: { left: number; top: number; right: number; bottom: number };
  /** The gross up to today (the whole employment once it ended); null when it all starts after today. */
  solid: string | null;
  /** After today: a signed raise to come. */
  future: string | null;
  points: ChartPoint[];
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
  /** Today's line, while the employment is current. */
  today: number | null;
  /** The chart in words, for screen readers. */
  description: string;
}

const SIZE = { width: 640, height: 220 };
const MARGIN = { left: 44, right: 16, top: 16, bottom: 28 };

/**
 * A step chart of the gross over an employment, to scale: x by date from the join date to its end (today while it is
 * current, or a month past a signed raise to come), y from 0 with round ticks; a step at each signed event's effective
 * date (only signed versions were paid), the one in force today marked current, one still to come drawn on after today.
 * Null until a version is signed.
 */
export function stepChart(
  input: { events: readonly PayEvent[]; joinDate: string; endDate: string | null; today: string },
  size: { width: number; height: number } = SIZE,
): StepChart | null {
  const { joinDate, endDate, today } = input;
  // signed versions by effective date; of two from the same day, the later version
  const sorted = input.events
    .filter((e) => isSignedStage(e.stage))
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.version - b.version);
  const steps = sorted.filter((e, i) => sorted[i + 1]?.effectiveDate !== e.effectiveDate);
  if (!steps.length) return null;

  const start = steps[0].effectiveDate < joinDate ? steps[0].effectiveDate : joinDate;
  const last = steps.at(-1)!.effectiveDate;
  const until = endDate ?? today;
  let end = last >= until ? nextFirstOfMonth(last) : until;
  if (dayOf(end) <= dayOf(start)) end = nextFirstOfMonth(start);
  const current = endDate === null || endDate >= today;
  const cut = current && today > start && today < end ? today : null;
  // signed, but nothing in force yet (someone who starts later): all of it is to come
  const ahead = current && today < start;

  const plot = { left: MARGIN.left, top: MARGIN.top, right: size.width - MARGIN.right, bottom: size.height - MARGIN.bottom };
  const ticks = niceTicks(Math.max(...steps.map((s) => s.to.gross)));
  const top = ticks.at(-1)!;
  const round = (v: number) => Math.round(v * 10) / 10;
  const x = (ymd: string) => round(plot.left + ((dayOf(ymd) - dayOf(start)) / (dayOf(end) - dayOf(start))) * (plot.right - plot.left));
  const y = (gross: number) => round(plot.bottom - (gross / top) * (plot.bottom - plot.top));

  // the gross in force on a date: the last step on or before it (the first before any)
  const grossOn = (ymd: string) => [...steps].reverse().find((s) => s.effectiveDate <= ymd)?.to.gross ?? steps[0].to.gross;
  const path = (from: string, to: string) => {
    let d = `M${x(from)} ${y(grossOn(from))}`;
    for (const s of steps) if (s.effectiveDate > from && s.effectiveDate <= to) d += ` H${x(s.effectiveDate)} V${y(s.to.gross)}`;
    return `${d} H${x(to)}`;
  };

  const inForce = [...steps].reverse().find((s) => s.effectiveDate <= today) ?? null;
  const points: ChartPoint[] = steps.map((s) => ({
    key: s.contractId,
    x: x(s.effectiveDate),
    y: y(s.to.gross),
    date: s.effectiveDate,
    gross: s.to.gross,
    state: s.effectiveDate > today ? 'upcoming' : current && s === inForce ? 'current' : 'past',
    label: `${eventTitle(s)} · From ${formatDate(s.effectiveDate)} · ${formatEgp(s.to.gross)}`,
  }));

  const months = (dayOf(end) - dayOf(start)) / 30.44;
  const stepMonths = [1, 2, 3, 6, 12, 24, 60].find((m) => months / m <= 6) ?? 120;
  const xTicks = monthTicks(start, end, stepMonths).map((d) => ({
    x: x(d),
    label: stepMonths >= 12 ? d.slice(0, 4) : `${MONTH_SHORT[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`,
  }));

  const first = steps[0];
  const now = inForce ?? first;
  const upcoming = points.filter((p) => p.state === 'upcoming');
  // a renewal with the same pay is a step of the timeline, not a change of the gross
  const changes = steps.filter((s, i) => i > 0 && s.effectiveDate <= today && s.to.gross !== steps[i - 1].to.gross).length;
  const description = [
    ...(ahead
      ? ['Gross salary: nothing in force yet.']
      : [
          `Gross salary ${current ? `from ${formatDate(first.effectiveDate)} to today` : `from ${formatDate(first.effectiveDate)} to ${formatDate(endDate!)}`}:`,
          `${formatEgp(first.to.gross)} at the start, ${formatEgp(now.to.gross)} ${current ? 'now' : 'at the end'},`,
          `${changes} ${changes === 1 ? 'change' : 'changes'} of the gross in between.`,
        ]),
    ...upcoming.map((p) => `To come: ${formatEgp(p.gross)} from ${formatDate(p.date)}.`),
    'Every change is listed in the timeline below.',
  ].join(' ');

  return {
    width: size.width,
    height: size.height,
    plot,
    solid: ahead ? null : path(start, cut ?? end),
    future: ahead ? path(start, end) : cut ? path(cut, end) : null,
    points,
    yTicks: ticks.map((v) => ({ y: y(v), label: compactAmount(v) })),
    xTicks,
    today: cut ? x(cut) : null,
    description,
  };
}
