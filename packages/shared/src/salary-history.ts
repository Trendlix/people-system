// An employment's salary history (owner, 16 October 2026: "think about tracking the salary raises through the
// employment period too"): its pay events from its contract versions, in order (the hire, each amendment, each new
// contract, each renewal, with the same pay or the change), and the summary the Employment tab opens with: the gross it
// started with, the gross now, the change since joining, the raises and the last one. A raise is a version the CEO
// approved because it changes the pay (raises.ts); a renewal with the same pay is not one. Pure code: the API sends
// these (GET /employees/:id/salary-history) and a company-wide report can use them too.

import { payChangeOf, payDifference, payStage, type PayChange, type PayStage, type RaiseReason } from './raises.js';

/** A contract version as the history reads it. Dates YYYY-MM-DD. */
export interface PayVersion {
  id: string;
  number: string;
  version: number;
  kind: string;
  status: string;
  approval: string | null;
  returnedReason: string | null;
  startDate: string;
  endDate: string | null;
  payBasis: string;
  grossSalary: number;
  hourlyRate: number | null;
  /** One paid per client account (25 October 2026) has basis per_account and no amount (0). */
  allowances: readonly { nameEn: string; amount: number; basis?: string }[];
  raiseReason: string | null;
  /** The promotion that comes with it, if any. */
  newJobTitle: string | null;
  newGrade: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  signedOn: string | null;
  /** From when the insured wage follows its pay (a raise), else null. */
  insuredWageFrom: string | null;
}

/** The pay of a version: its gross, its allowances in total, and the two together. */
export interface PayAmounts {
  gross: number;
  allowances: number;
  total: number;
}

/** One pay event: a version, what it changed from the one before it, and where it stands. */
export interface PayEvent {
  contractId: string;
  number: string;
  version: number;
  change: PayChange;
  stage: PayStage;
  /** Its start: the hire, or the date the change takes effect. */
  effectiveDate: string;
  endDate: string | null;
  payBasis: string;
  hourlyRate: number | null;
  /** The version before it's pay; null for the hire. */
  from: PayAmounts | null;
  to: PayAmounts;
  allowances: { nameEn: string; amount: number; basis?: string }[];
  /** The gross's change from the version before (null for the hire). */
  difference: { amount: number; percent: number | null } | null;
  /** The same pay as the version before (a renewal as it was); false for the hire. */
  samePay: boolean;
  /** A change of pay the CEO approves (a raise, or a renewal with new pay). */
  raise: boolean;
  reason: RaiseReason | null;
  promotion: { jobTitle: string | null; grade: string | null } | null;
  approvedBy: string | null;
  approvedAt: string | null;
  signedOn: string | null;
  insuredWageFrom: string | null;
}

const money = (n: number) => Math.round(n * 100) / 100;

function amountsOf(v: PayVersion): PayAmounts {
  const allowances = money(v.allowances.reduce((sum, a) => sum + a.amount, 0));
  return { gross: money(v.grossSalary), allowances, total: money(v.grossSalary + allowances) };
}

const sameAllowances = (a: PayVersion, b: PayVersion) =>
  JSON.stringify(a.allowances.map((x) => [x.nameEn, money(x.amount)]).sort()) === JSON.stringify(b.allowances.map((x) => [x.nameEn, money(x.amount)]).sort());

/** Signed, or signed and since replaced or ended: what was paid. */
export const isSignedStage = (stage: PayStage) => stage === 'signed' || stage === 'replaced' || stage === 'ended';

/** The employment's pay events, oldest first: every version, each against the version before it. */
export function payEvents(versions: readonly PayVersion[]): PayEvent[] {
  const ordered = [...versions].sort((a, b) => a.version - b.version);
  return ordered.map((v) => {
    const previous = ordered.find((p) => p.version === v.version - 1) ?? null;
    const to = amountsOf(v);
    const from = previous ? amountsOf(previous) : null;
    const same = previous !== null && from!.gross === to.gross && v.payBasis === previous.payBasis && v.hourlyRate === previous.hourlyRate && sameAllowances(v, previous);
    return {
      contractId: v.id,
      number: v.number,
      version: v.version,
      change: payChangeOf(v, previous),
      stage: payStage(v),
      effectiveDate: v.startDate,
      endDate: v.endDate,
      payBasis: v.payBasis,
      hourlyRate: v.hourlyRate,
      from,
      to,
      allowances: v.allowances.map((a) => ({ nameEn: a.nameEn, amount: money(a.amount), ...(a.basis === 'per_account' && { basis: a.basis }) })),
      difference: from ? payDifference(from.gross, to.gross) : null,
      samePay: same,
      raise: v.approval !== null,
      reason: (v.raiseReason as RaiseReason | null) ?? null,
      promotion: v.newJobTitle || v.newGrade ? { jobTitle: v.newJobTitle, grade: v.newGrade } : null,
      approvedBy: v.approvedBy,
      approvedAt: v.approvedAt,
      signedOn: v.signedOn,
      insuredWageFrom: v.insuredWageFrom,
    };
  });
}

/** Whole months from one date to another: 2026-03-01 → 2026-10-16 is 7. Negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return ty * 12 + tm - (fy * 12 + fm) - (td < fd ? 1 : 0);
}

/** The summary the salary history opens with, from the signed events as of `today`. */
export interface SalarySummary {
  /** The first signed version's gross. */
  startingGross: number;
  /** The gross of the signed version in force today (the latest start by today; the first before any starts). */
  currentGross: number;
  /** The change since joining. */
  change: { amount: number; percent: number | null };
  /** The signed raises in force by today. */
  raises: number;
  /** The last of them: its effective date, and how many whole months ago. */
  lastRaise: { date: string; monthsAgo: number } | null;
  /** A signed raise that takes effect after today, if any. */
  next: { date: string; gross: number } | null;
}

/** Null until a version is signed. */
export function salarySummary(events: readonly PayEvent[], today: string): SalarySummary | null {
  const signed = events.filter((e) => isSignedStage(e.stage)).sort((a, b) => a.version - b.version);
  if (!signed.length) return null;
  const started = signed.filter((e) => e.effectiveDate <= today).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.version - b.version);
  const current = started.at(-1) ?? signed[0];
  const startingGross = signed[0].to.gross;
  const raises = started.filter((e) => e.raise);
  const last = raises.at(-1) ?? null;
  const upcoming = signed.filter((e) => e.raise && e.effectiveDate > today).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))[0] ?? null;
  return {
    startingGross,
    currentGross: current.to.gross,
    change: payDifference(startingGross, current.to.gross),
    raises: raises.length,
    lastRaise: last && { date: last.effectiveDate, monthsAgo: monthsBetween(last.effectiveDate, today) },
    next: upcoming && { date: upcoming.effectiveDate, gross: upcoming.to.gross },
  };
}
