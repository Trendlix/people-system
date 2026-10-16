import {
  CONTRACT_KIND_LABELS,
  firstJanuaryFrom,
  form2Problem,
  nextFirstOfMonth,
  PAY_CHANGE_LABELS,
  payChangeOf,
  payDifference,
  payStage,
  RAISE_WAYS,
  samePay,
  type PayChange,
  type PayStage,
  type PayTerms as VersionPay,
  type RaiseWay,
} from '@trendlix/shared';
import { departmentName } from '../../../../../lib/departments';
import { dateFrom } from '../../../../../lib/form-data';
import { formatDate } from '../../../../../lib/format';
import type { ContractRaise } from '../../../../../lib/raise-types';
import type { Contract, JobTitleSummary } from '../../../../../lib/types';
import { monthsFrom, payBody, raiseReasonFrom } from '../../contract-body';
import { monthName } from '../../../payroll/list';
import { formatEgp } from './salary';

// Pay raises during a contract on the profile's Employment tab (owner's decisions, 16 October 2026; packages/shared
// raises.ts): HR enters a raise on the signed contract in force, as an amendment (the new pay on the same contract from
// an effective date, its term and end staying, a salary amendment letter to sign) or as a new contract (its own term from
// the effective date, signed in full), on the 1st of a month; HR sends it to the CEO, who approves it, returns it with a
// reason or declines it; only an approved one is signed. A renewal whose pay changes counts as a raise and goes the same
// way. After a raise the insured wage stays as it was until the next 1 January, unless HR records the Form 2 filed. Pure
// code for the raise form, the raise card and the Pay History table, tested; relative imports, as vitest doesn't know
// the @/ paths.

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

// ---------- dates ----------

/**
 * The date a new raise starts with: the next 1st of a month after today, and after the contract in force started (a
 * raise takes effect on a later 1st of a month), e.g. today 16/10/2026 → 01/11/2026; a contract starting 01/11/2026 →
 * 01/12/2026.
 */
export function defaultEffectiveDate(today: string, current: { startDate: string }): string {
  const fromToday = nextFirstOfMonth(today);
  const afterStart = nextFirstOfMonth(current.startDate);
  return fromToday > afterStart ? fromToday : afterStart;
}

/** "2027-01-01" → "January 2027". */
export const monthOf = (ymd: string) => monthName(ymd.slice(0, 7));

/**
 * What a raise does to the insured wage (owner's decision, 16 October 2026: "From the next January unless amended in
 * Form 2"): it stays as before until the next January, unless Form 2 was filed, when it follows the new pay from its
 * date; a raise from 1 January is followed at once, as the insured wage is set each January.
 */
export function insuredWageText(effective: string, form2From: string | null): string {
  if (form2From) return `Insured wage follows the new pay from ${monthOf(form2From)}, with Form 2 filed.`;
  const january = firstJanuaryFrom(effective);
  if (january === effective) return 'Insured wage follows the new pay at once: it is set each January.';
  return `Insured wage stays as before until ${monthOf(january)} unless Form 2 is filed.`;
}

/** From when a version's insured wage follows its pay, for the Pay History: "01/01/2027", or "01/12/2026 (Form 2)". */
export function insuredFromText(raise: Pick<ContractRaise, 'insuredWageFrom' | 'form2From'>): string {
  return `${formatDate(raise.insuredWageFrom)}${raise.form2From ? ' (Form 2)' : ''}`;
}

/** The Form 2 date as the API takes it: the 1st of a month from the raise's effective date; empty: none filed (null). */
export function form2Body(fd: FormData, effective: string, errors: string[]): { form2From: string | null } {
  const date = dateFrom(fd, 'form2From', 'date Form 2 changes the insured wage from', errors);
  if (errors.length || date === '') return { form2From: null };
  const problem = form2Problem(date, effective);
  if (problem) errors.push(problem);
  return { form2From: date };
}

// ---------- versions ----------

/** The version before this one (by number), or null for the first. */
export function versionBefore<V extends { version: number }>(v: V, versions: readonly V[]): V | null {
  return versions.find((x) => x.version === v.version - 1) ?? null;
}

/** What a version is to the one before it: Hired, Amendment, New contract or Renewal. */
export function changeOf(v: Pick<Contract, 'version' | 'kind' | 'startDate'>, versions: readonly Pick<Contract, 'version' | 'endDate'>[]): PayChange {
  const before = versions.find((x) => x.version === v.version - 1) ?? null;
  return payChangeOf({ kind: v.kind ?? 'contract', startDate: v.startDate }, before && { endDate: before.endDate });
}

export const changeLabel = (change: PayChange) => PAY_CHANGE_LABELS[change];

/** A change of pay waiting to be signed, as its card calls it: Salary amendment, New contract or Renewal. */
export function pendingKindLabel(change: PayChange): string {
  if (change === 'amendment') return CONTRACT_KIND_LABELS.amendment;
  return change === 'hired' ? CONTRACT_KIND_LABELS.contract : PAY_CHANGE_LABELS[change];
}

/**
 * Where a version is changed: a renewal (also one with new pay) on the contract draft's page, a raise (an amendment or
 * a new contract within the term) on the raise's.
 */
export const editHref = (employeeId: string, contractId: string, change: PayChange) =>
  `/employees/${employeeId}/contracts/${contractId}/${change === 'amendment' || change === 'new_contract' ? 'raise' : 'edit'}`;

/** Where a version stands: as the API says, else worked out as it does (an API from before raises). */
export function stageOf(c: Pick<Contract, 'status' | 'stage' | 'raise'>): PayStage {
  return c.stage ?? payStage({ status: c.status, approval: c.raise?.approval ?? null, returnedReason: c.raise?.returnedReason ?? null });
}

/** A stage's badge colours, as a payroll run's: with the CEO in amber, approved in the badge's own accent, signed in green. */
const STAGE_TONES: Record<PayStage, string> = {
  draft: 'bg-line-soft text-muted',
  returned: 'bg-danger-soft text-danger',
  pending_ceo: 'bg-warn-soft text-warn',
  approved: '',
  signed: 'bg-ok-soft text-ok',
  replaced: 'bg-line-soft text-muted',
  ended: 'bg-line-soft text-muted',
};

export const stageTone = (stage: PayStage) => STAGE_TONES[stage];

/** The CEO's step on a change of pay, in a few words; null for a version that needs none. */
export function decisionText(raise: ContractRaise | null | undefined): string | null {
  if (!raise) return null;
  if (raise.approval === 'approved') {
    return `Approved${raise.approvedBy ? ` by ${raise.approvedBy.email}` : ''}${raise.approvedAt ? ` on ${formatDate(raise.approvedAt)}` : ''}`;
  }
  if (raise.approval === 'pending_ceo') return raise.sentAt ? `With the CEO since ${formatDate(raise.sentAt)}` : 'With the CEO';
  return raise.returnedReason ? 'Returned to HR' : 'Not sent to the CEO yet';
}

/** The promotion with a raise: "Senior Designer · grade G5"; null without one. */
export function promotionText(raise: Pick<ContractRaise, 'newJobTitle' | 'newGrade'> | null | undefined): string | null {
  if (!raise) return null;
  const parts = [raise.newJobTitle?.titleEn, raise.newGrade && `grade ${raise.newGrade.code}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// ---------- the pay ----------

const signed = (n: number, text: string) => `${n > 0 ? '+' : '−'}${text}`;

/**
 * An amount before and after, with the change: "EGP 15,000.00 → EGP 17,000.00 (+EGP 2,000.00, +13.3%)"; "EGP
 * 15,000.00 (no change)"; just the amount without one before; null without one after.
 */
export function fromToText(from: number | null, to: number | null): string | null {
  if (to === null) return null;
  if (from === null) return formatEgp(to);
  const { amount, percent } = payDifference(from, to);
  if (amount === 0) return `${formatEgp(to)} (no change)`;
  const change = [signed(amount, formatEgp(Math.abs(amount))), percent !== null && signed(percent, `${Math.abs(percent)}%`)].filter(Boolean).join(', ');
  return `${formatEgp(from)} → ${formatEgp(to)} (${change})`;
}

/** A version's pay, to compare it with another's (samePay). */
export function versionPay(c: Pick<Contract, 'payBasis' | 'grossSalary' | 'hourlyRate' | 'hoursPerWeek' | 'basicPercent' | 'allowances'>): VersionPay {
  return {
    payBasis: c.payBasis ?? 'monthly',
    grossSalary: c.grossSalary ?? 0,
    hourlyRate: c.hourlyRate ?? null,
    hoursPerWeek: c.hoursPerWeek ?? null,
    basicPercent: c.basicPercent ?? 80,
    allowances: (c.allowances ?? []).map((a) => ({ allowanceTypeId: a.allowanceTypeId, amount: a.amount })),
  };
}

/**
 * Whether two versions pay the same, by the hour leaving the monthly estimate out (the API works it out from the rate
 * and the hours, which are compared).
 */
function sameTerms(a: VersionPay, b: VersionPay): boolean {
  const ofRate = (p: VersionPay) => (p.payBasis === 'hourly' ? { ...p, grossSalary: 0 } : p);
  return samePay(ofRate(a), ofRate(b));
}

/**
 * A renewal's answer to "Does the pay change?" against the pay typed (null while it isn't a valid pay yet): a warning
 * when they disagree, as the API then goes by the pay itself (a renewal with new pay needs a reason; one with the
 * version before's pay needs no approval).
 */
export function payChangeWarning(answer: 'same' | 'changes', typed: VersionPay | null, before: VersionPay, version: number): string | null {
  if (!typed) return null;
  const same = sameTerms(typed, before);
  if (answer === 'same' && !same) return `The pay typed isn't version ${version}'s: choose “The pay changes” and why, or put the pay back as it was.`;
  if (answer === 'changes' && same) return `The pay typed is still version ${version}'s: change it, or choose “Same pay”.`;
  return null;
}

// ---------- the promotion ----------

/** The job titles to choose from, by department or team ("Marketing › Content Team"), in the API's order. */
export function jobTitleGroups(jobTitles: readonly JobTitleSummary[]): { label: string; options: { id: string; label: string }[] }[] {
  const groups = new Map<string, { label: string; options: { id: string; label: string }[] }>();
  for (const j of jobTitles) {
    const label = departmentName(j.department);
    const group = groups.get(label) ?? { label, options: [] };
    group.options.push({ id: j.id, label: j.titleEn });
    groups.set(label, group);
  }
  return [...groups.values()];
}

// ---------- the raise form ----------

/** A required DD/MM/YYYY date as YYYY-MM-DD. */
function requiredDate(fd: FormData, key: string, label: string, example: string, errors: string[]): string {
  if (text(fd, key) === '') {
    errors.push(`Enter the ${label}, e.g. ${example}.`);
    return '';
  }
  return dateFrom(fd, key, label, errors);
}

/**
 * The raise form's fields (contracts/raise-form.tsx) as the API takes them: the way, the effective date, a new
 * contract's length, why, the pay (payBody), the note, the promotion, and the raise request it is prepared from. The API
 * checks the date against the contract in force. `draft`: changing a raise, where a promotion emptied ("No change") and
 * an emptied net or number of working days are cleared (null); a new raise leaves them out.
 */
export function raiseBody(fd: FormData, errors: string[], draft: boolean) {
  const typedWay = text(fd, 'way');
  const way = (RAISE_WAYS as readonly string[]).includes(typedWay) ? (typedWay as RaiseWay) : null;
  if (!way) errors.push('Choose how the raise is made: an amendment to the contract in force, or a new contract.');
  const effectiveDate = requiredDate(fd, 'effectiveDate', 'date the raise takes effect', '01/12/2026', errors);
  const durationMonths = way === 'contract' ? monthsFrom(fd, 'durationMonths', 'length', 60, errors) : undefined;
  if (durationMonths === 0) errors.push('A fixed term runs for 1 to 60 months.');
  const reason = raiseReasonFrom(fd, 'reason', errors);
  const pay = payBody(fd, errors, draft);
  const newJobTitleId = text(fd, 'newJobTitleId');
  const newGradeId = text(fd, 'newGradeId');
  const requestId = text(fd, 'requestId');
  return {
    ...(way && { way }),
    effectiveDate,
    ...(durationMonths !== undefined && { durationMonths }),
    ...(reason && { reason }),
    ...pay,
    ...(newJobTitleId ? { newJobTitleId } : draft ? { newJobTitleId: null } : {}),
    ...(newGradeId ? { newGradeId } : draft ? { newGradeId: null } : {}),
    note: text(fd, 'note'),
    ...(!draft && requestId && { requestId }),
  };
}
