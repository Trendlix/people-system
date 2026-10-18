// Installments and recurring deductions (owner, 18 October 2026: "in the deductions i might have a loan of a medical
// subscription or something that needs to be deducted as installments on the employee. how will it be managed?").
// Decided with the owner the same day:
// - An advance or a loan is recovered by installments the system makes at once: HR gives the total, how many months
//   and the first month; each month's installment is a deduction linked to it (payroll-adjustments.ts), equal amounts,
//   the last taking the rounding. HR may move one to a later month (it and every later one move a month on) or change
//   one's amount (the later ones share what is left).
// - A medical subscription is an ongoing monthly share: a recurring deduction of a fixed amount from a start month, to
//   an end month or until HR stops it, added to each month's payroll.
// - Leaving before it is paid back: what is left is taken from the final settlement, unless HR waives it.
// - A warning (never a block) when a month's installments pass a share of the pay set in Payroll Setup, e.g. 10%: a
//   block since the owner read the Labour Law with us (owner, 18 October 2026, after reading the law: "Block above
//   10%"), see the law's limits below.
// Months are YYYY-MM. Amounts in EGP, two decimals, worked out in piastres.

// ---------- months ----------

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Whether `month` is a month as YYYY-MM. */
export const isMonth = (month: string) => MONTH.test(month);

/** The month `n` months after `month` (before it when `n` is negative). */
export function monthPlus(month: string, n: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

// ---------- installments ----------

/** One month's installment. */
export interface Installment {
  month: string;
  amount: number;
}

/** The most months a plan may have: five years. */
export const INSTALLMENTS_MAX = 60;

/** Why a plan can't be made as typed (none: it can): the total, how many months, the first month. */
export function installmentPlanProblems(total: number, count: number, first: string): string[] {
  const problems: string[] = [];
  if (!isMoney(total) || total <= 0) problems.push('Enter the total to recover, more than 0, e.g. 6000 or 6000.50.');
  if (!Number.isInteger(count) || count < 1 || count > INSTALLMENTS_MAX) problems.push(`Enter how many monthly installments, 1 to ${INSTALLMENTS_MAX}.`);
  if (!isMonth(first)) problems.push('Choose the month of the first installment.');
  if (problems.length === 0 && cents(total) < count) problems.push('The total is too small to split into that many installments.');
  return problems;
}

/**
 * `total` in `count` monthly installments from `first`: equal amounts in whole piastres, the last taking what the
 * rounding leaves (10,000 in 3: 3,333.33, 3,333.33, 3,333.34). The plan's problems must be none.
 */
export function installmentPlan(total: number, count: number, first: string): Installment[] {
  return spread(cents(total), count).map((c, i) => ({ month: monthPlus(first, i), amount: money(c) }));
}

/** The amount of each installment, in words: "6 installments of EGP 1,000.00", or "3 installments: EGP 3,333.33 … 3,333.34". */
export function installmentPlanText(plan: readonly Installment[]): string {
  if (plan.length === 0) return 'No installments';
  const egp = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const first = plan[0].amount;
  const last = plan[plan.length - 1].amount;
  const word = plan.length === 1 ? 'installment' : 'installments';
  if (plan.every((p) => cents(p.amount) === cents(first))) return `${plan.length} ${word} of EGP ${egp(first)}`;
  return `${plan.length} ${word}: EGP ${egp(first)} … ${egp(last)}`;
}

/**
 * The installments still to come after HR moves the one of `month` to a later month: it and every later one move a
 * month on, amounts as they were (e.g. none taken in December). `pending` in month order.
 */
export function postponeInstallment(pending: readonly Installment[], month: string): Installment[] {
  return pending.map((p) => (p.month >= month ? { ...p, month: monthPlus(p.month, 1) } : { ...p }));
}

/**
 * The installments still to come after HR changes the one of `month` to `amount`: the earlier ones stay, the later ones
 * share equally what is left of their total (the last taking the rounding); when the changed one takes it all, the later
 * ones go; when a last one is lowered, the difference becomes one more installment the month after. The total of
 * `pending` (in month order) never changes. A problem when `amount` isn't more than 0 or is more than what is left from
 * that month on.
 */
export function changeInstallment(pending: readonly Installment[], month: string, amount: number): { plan: Installment[] } | { problem: string } {
  const at = pending.findIndex((p) => p.month === month);
  if (at < 0) return { problem: 'That installment is no longer waiting to be deducted.' };
  if (!isMoney(amount) || amount <= 0) return { problem: 'Enter the installment, more than 0, e.g. 1000 or 1000.50.' };
  const fromHere = pending.slice(at).reduce((s, p) => s + cents(p.amount), 0);
  if (cents(amount) > fromHere) return { problem: `The installment can be at most EGP ${money(fromHere).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, what is left from that month on.` };

  const before = pending.slice(0, at).map((p) => ({ ...p }));
  const changed = { month, amount: money(cents(amount)) };
  const left = fromHere - cents(amount);
  const later = pending.slice(at + 1);
  if (left === 0) return { plan: [...before, changed] };
  if (later.length === 0) return { plan: [...before, changed, { month: monthPlus(month, 1), amount: money(left) }] };
  const shares = spread(left, Math.min(later.length, left));
  return { plan: [...before, changed, ...shares.map((c, i) => ({ month: later[i].month, amount: money(c) }))] };
}

// ---------- recurring deductions ----------

/** A recurring deduction, e.g. the employee's share of a medical subscription: a fixed amount a month. */
export interface RecurringDeduction {
  amount: number;
  /** The first month it is deducted. */
  startMonth: string;
  /** The last month it is deducted; null: until stopped. */
  endMonth: string | null;
  /** The first month it is no longer deducted, once HR stopped it; null while it runs. */
  stoppedFrom: string | null;
}

/** Why a recurring deduction can't be saved as typed (none: it can). */
export function recurringDeductionProblems(amount: number, startMonth: string, endMonth: string | null): string[] {
  const problems: string[] = [];
  if (!isMoney(amount) || amount <= 0) problems.push('Enter the amount a month, more than 0, e.g. 350 or 350.50.');
  if (!isMonth(startMonth)) problems.push('Choose the first month it is deducted.');
  if (endMonth !== null && !isMonth(endMonth)) problems.push('Choose the last month it is deducted, or leave it empty to deduct it until stopped.');
  else if (endMonth !== null && isMonth(startMonth) && endMonth < startMonth) problems.push("The last month can't be before the first.");
  return problems;
}

/** Whether a recurring deduction is taken in `month`: from its start, to its end, and not after it was stopped. */
export function recurringDue(r: Pick<RecurringDeduction, 'startMonth' | 'endMonth' | 'stoppedFrom'>, month: string): boolean {
  if (month < r.startMonth) return false;
  if (r.endMonth !== null && month > r.endMonth) return false;
  return r.stoppedFrom === null || month < r.stoppedFrom;
}

// ---------- the law's limits (Labour Law No. 14 of 2025) ----------

// Read with the owner on 18 October 2026, who decided (owner, 18 October 2026, after reading the law: "Block above
// 10%", "Warn above 25%, record the consent"):
// - Art. 113 ("لا يجوز لصاحب العمل أن يقتطع من أجر العامل أكثر من عشرة بالمائة، وفاء لما يكون قد أقرضه من مال أثناء
//   سريان العقد ... ويسرى هذا الحكم على الأجور المدفوعة مقدما"): a month's installments of advances and loans, all the
//   employee's together, may not take more than 10% of the wage. Recording a plan, changing or moving an installment
//   and entering a recovery by hand that would take a month over it are refused. The wage is the employee's current
//   signed contract's monthly gross. Payroll Setup may set a lower limit, never a higher one. The run's line still
//   warns past it, as the month's pay can be less than the wage it was planned on.
// - Art. 114: other deductions for a debt at most 25% of the wage, worked out after the income tax, the social
//   insurance and the loans' installments within the 10%, and only with the employee's written consent ("ويشترط لصحة
//   النزول عن الأجر فى حدود النسبة المقررة بهذه المادة أن تصدر به موافقة مكتوبة من العامل"): a warning, never a block,
//   when a month's recurring deductions pass it; HR records the consent.
// - Art. 151: a deduction for damage or loss at most 5 days' wage a month (the gross ÷ the payroll's days in a month ×
//   5): a warning, never a block.

/** Art. 113: the most a month's installments of advances and loans may take, in percent of the wage. */
export const LAW_INSTALLMENT_PERCENT = 10;
/** The lowest limit Payroll Setup may set on them: 1% (and at most the law's 10%). */
export const INSTALLMENT_LIMIT_MIN = 1;
/** Art. 114: the most a month's other deductions for a debt (recurring deductions) may take, in percent. */
export const LAW_DEDUCTION_PERCENT = 25;
/** Art. 151: the most a month's damage or loss deductions may take, in days' wage. */
export const LAW_DAMAGE_DAYS = 5;

/** Whether `percent` is a limit Payroll Setup may set: 1 to 10, two decimals at most. */
export const isInstallmentLimitPercent = (percent: unknown): percent is number =>
  typeof percent === 'number' && isMoney(percent) && percent >= INSTALLMENT_LIMIT_MIN && percent <= LAW_INSTALLMENT_PERCENT;

/** The most a month's installments may take: `percent` of `pay`, down to the piaster; null without a percent. */
export function installmentLimit(pay: number, percent: number | null): number | null {
  if (percent === null || !(percent > 0)) return null;
  return money(Math.floor((cents(pay) * percent) / 100));
}

/** "10%, the most the law allows (Labour Law Art. 113)", or a lower limit as Payroll Setup's. */
function limitWords(percent: number, limit: number, of: string): string {
  return percent >= LAW_INSTALLMENT_PERCENT
    ? `more than ${percent}% of ${of} (${egp(limit)}), the most the law allows (Labour Law Art. 113)`
    : `more than ${percent}% of ${of} (${egp(limit)}), the limit set in Payroll Setup (the law allows at most ${LAW_INSTALLMENT_PERCENT}%, Labour Law Art. 113)`;
}

/**
 * The run line's warning when the month's installments (advances' recoveries and loans' installments) take more than
 * `percent` of `pay` (the month's pay, as the run worked it out): planned within the limit, the month's pay can still
 * be less than the wage they were planned on. Never a block. Null when they don't, or no percent is given.
 */
export function installmentLimitWarning(installments: number, pay: number, percent: number | null): string | null {
  const limit = installmentLimit(pay, percent);
  if (limit === null || percent === null || cents(installments) <= cents(limit)) return null;
  return `This month's installments of advances and loans, ${egp(installments)}, are ${limitWords(percent, limit, 'the pay')}.`;
}

/**
 * Why installments can't be planned so (owner, 18 October 2026: "Block above 10%"): in `month` the employee's
 * installments of advances and loans, all of them together, would be `installments`, more than `percent` of `pay` (the
 * wage: the current contract's monthly gross). `instead` says what to do. Null when within the limit, or no percent.
 */
export function installmentLimitProblem(month: string, installments: number, pay: number, percent: number | null, instead = 'Spread it over more months.'): string | null {
  const limit = installmentLimit(pay, percent);
  if (limit === null || percent === null || cents(installments) <= cents(limit)) return null;
  return `In ${monthWords(month)} the installments of advances and loans would be ${egp(installments)}, ${limitWords(percent, limit, `the gross pay of ${egp(pay)}`)}. ${instead}`;
}

/** Two sets of installments by month (YYYY-MM) added, to the piaster. */
export function addByMonth(a: Readonly<Record<string, number>>, b: readonly Installment[] | Readonly<Record<string, number>>): Record<string, number> {
  const out = new Map<string, number>(Object.entries(a).map(([m, v]) => [m, cents(v)]));
  const more = Array.isArray(b) ? b.map((i) => [i.month, i.amount] as const) : Object.entries(b);
  for (const [m, v] of more) out.set(m, (out.get(m) ?? 0) + cents(v));
  return Object.fromEntries([...out.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([m, c]) => [m, money(c)]));
}

/**
 * The first month a change of the employee's installments takes over the limit: `before` and `after` are all their
 * installments by month, as they are and as they would be. A month whose total doesn't rise is never it, so a plan over
 * the limit from before (or after the pay changed) can still be lowered or moved. Null when none is, or no percent.
 */
export function monthOverInstallmentLimit(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
  pay: number,
  percent: number | null,
): { month: string; installments: number } | null {
  const limit = installmentLimit(pay, percent);
  if (limit === null) return null;
  const month = Object.keys(after)
    .sort()
    .find((m) => cents(after[m]) > cents(limit) && cents(after[m]) > cents(before[m] ?? 0));
  return month === undefined ? null : { month, installments: after[month] };
}

/**
 * The fewest monthly installments, more than `moreThan` (the months tried already), that recover `total` from `first`
 * with no month over the limit, the employee's other installments by month being `others`: what to suggest when a
 * plan is refused. Null when none up to INSTALLMENTS_MAX does.
 */
export function fewestInstallments(total: number, first: string, pay: number, percent: number | null, others: Readonly<Record<string, number>>, moreThan = 0): number | null {
  const limit = installmentLimit(pay, percent);
  if (limit === null) return null;
  for (let count = Math.max(1, moreThan + 1); count <= INSTALLMENTS_MAX; count++) {
    if (installmentPlanProblems(total, count, first).length) return null;
    const plan = installmentPlan(total, count, first);
    if (plan.every((p) => cents(others[p.month] ?? 0) + cents(p.amount) <= cents(limit))) return count;
  }
  return null;
}

/**
 * Why a new plan can't be recorded (null: it can): the first month it takes over the limit with the employee's other
 * installments (`others`, by month), and how many months would do, or to start it later.
 */
export function planLimitProblem(plan: readonly Installment[], others: Readonly<Record<string, number>>, pay: number, percent: number | null): string | null {
  if (!plan.length) return null;
  const over = monthOverInstallmentLimit(others, addByMonth(others, plan), pay, percent);
  if (!over) return null;
  const total = money(plan.reduce((s, p) => s + cents(p.amount), 0));
  const enough = fewestInstallments(total, plan[0].month, pay, percent, others, plan.length);
  const instead = enough
    ? `Spread it over more months: ${enough} monthly installments would keep every month within the limit.`
    : 'Start it later, once the other installments leave room, or record a smaller amount.';
  return installmentLimitProblem(over.month, over.installments, pay, percent, instead);
}

/** What the law's 25% is worked out from (Art. 114): the wage, less the income tax, the social insurance and the installments. */
export interface DeductionBase {
  /** The wage: the gross pay of the month (on the forms, the current contract's). */
  pay: number;
  /** The employee's income tax that month (on the forms, about what the gross comes to). */
  tax: number;
  /** The employee's social insurance share that month: 0 for someone not registered with it. */
  insurance: number;
  /** The month's installments of advances and loans. */
  installments: number;
}

/** The pay the 25% is of: the wage less the tax, the insurance and the installments, never below 0. */
export const deductionBaseOf = (b: DeductionBase) => money(Math.max(0, cents(b.pay) - cents(b.tax) - cents(b.insurance) - cents(b.installments)));

/** The most a month's recurring deductions may take before the warning: 25% of the base, down to the piaster. */
export const deductionLimit = (b: DeductionBase) => money(Math.floor((cents(deductionBaseOf(b)) * LAW_DEDUCTION_PERCENT) / 100));

/**
 * The warning (owner, 18 October 2026: "Warn above 25%", never a block) when a month's recurring deductions take more
 * than 25% of the pay after the income tax, the social insurance and the installments of advances and loans (Art. 114).
 * `month`: the form's month, else the run's line ("This month's"). Null when within it.
 */
export function deductionLimitWarning(recurring: number, b: DeductionBase, month?: string): string | null {
  const limit = deductionLimit(b);
  if (!(recurring > 0) || cents(recurring) <= cents(limit)) return null;
  const what = month ? `In ${monthWords(month)} the recurring deductions would be ${egp(recurring)}, more` : `This month's recurring deductions, ${egp(recurring)}, are more`;
  return `${what} than ${LAW_DEDUCTION_PERCENT}% (${egp(limit)}) of the pay after income tax, social insurance and installments (${egp(deductionBaseOf(b))}): the law allows at most ${LAW_DEDUCTION_PERCENT}% (Labour Law Art. 114).`;
}

/** The most a month's damage or loss deductions may take: 5 days of the monthly gross (÷ the payroll's days in a month), down to the piaster. */
export function damageLimit(gross: number, dayDivisor: number): number | null {
  if (!(gross > 0) || !(dayDivisor > 0)) return null;
  return money(Math.floor((cents(gross) * LAW_DAMAGE_DAYS) / dayDivisor));
}

/** The warning (never a block) when a month's damage or loss deductions take more than 5 days' wage (Art. 151). Null when within it. */
export function damageLimitWarning(damage: number, gross: number, dayDivisor: number): string | null {
  const limit = damageLimit(gross, dayDivisor);
  if (limit === null || cents(damage) <= cents(limit)) return null;
  return `This month's damage or loss deductions, ${egp(damage)}, are more than ${LAW_DAMAGE_DAYS} days' wage (${egp(limit)}: the gross of ${egp(gross)} ÷ ${dayDivisor} days × ${LAW_DAMAGE_DAYS}): the law allows at most ${LAW_DAMAGE_DAYS} days' wage a month (Labour Law Art. 151).`;
}

// ---------- helpers ----------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "November 2026". */
const monthWords = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** "EGP 1,500.00": always two decimals. */
const egp = (n: number) => `EGP ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** `total` piastres in `count` equal parts, whole piastres, the last taking the rest. */
function spread(total: number, count: number): number[] {
  const each = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? total - each * (count - 1) : each));
}

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100 + 0;
const isMoney = (n: number) => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
