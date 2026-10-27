// Client accounts and the accounts allowance (owner, 25 October 2026: "if an employee has an allowance per account, how
// can we deal with it?"). Asked, the owner chose:
// - the count from a "Client accounts list": the client accounts are kept in the system, each assigned to people from a
//   date to a date (open allowed); payroll counts each person's accounts for the month by itself;
// - the rate "variable": each assignment of a person to an account has its own amount a month, filled in from the
//   account's default (set on the account, or from an optional size tier) and changed by HR when it differs;
// - a part month "By days": an account held for part of the month is paid for its calendar days held ÷ the month's
//   calendar days.
// An allowance kind's basis says how it is paid: a fixed amount a month (as every kind was), or per client account (the
// seeded "Accounts allowance" / "بدل حسابات"). A contract or an offer chooses a per-account kind with no amount: the
// person is eligible for it, "Per client account assigned", and payroll pays the month's sum of their assignments as that
// allowance, with its taxed and insured flags. Pure code: the API keeps the accounts and pays them (apps/api
// client-accounts, payroll roster.ts), the web shows them.
// A contract may set the person's own amount per account (owner, 27 October 2026, of someone "paid per account only" at
// 3,000 EGP an account: "why cant i add rate per account?"; he chose "On the contract"): its per-account row's
// `perAccountAmount`, paid for every account they hold on the days under that contract, whatever each assignment's
// amount (still each assignment's when the contract leaves it empty); a raise or a renewal changes it as any pay term.
// Such a contract may have a salary of 0 ("why isn't accepting a zero salary? this case for example is paid per account
// only": contracts.ts zeroSalaryProblem).

/** An account's status: one ended takes no new assignments; its assignments ended with it. */
export const CLIENT_ACCOUNT_STATUSES = ['active', 'ended'] as const;
export type ClientAccountStatus = (typeof CLIENT_ACCOUNT_STATUSES)[number];
export const CLIENT_ACCOUNT_STATUS_LABELS: Record<ClientAccountStatus, string> = { active: 'Active', ended: 'Ended' };

/** How a kind of allowance is paid: a fixed amount a month (every kind until 25 October 2026), or per client account. */
export const ALLOWANCE_BASES = ['fixed', 'per_account'] as const;
export type AllowanceBasis = (typeof ALLOWANCE_BASES)[number];
export const ALLOWANCE_BASIS_LABELS: Record<AllowanceBasis, string> = {
  fixed: 'A fixed amount a month',
  per_account: 'Per client account assigned',
};

/** What a contract or an offer shows for a per-account allowance in place of an amount. */
export const PER_ACCOUNT_TEXT = 'Per client account assigned';
export const PER_ACCOUNT_TEXT_AR = 'عن كل حساب عميل يُسند إليه';

/**
 * A per-account allowance's amount as a contract or an offer shows it: "3,000.00 per client account assigned" with the
 * contract's amount per account (27 October 2026), else "Per client account assigned". `money` writes an amount.
 */
export function perAccountText(perAccountAmount: number | null | undefined, money: (n: number) => string, lang: 'en' | 'ar' = 'en'): string {
  if (!(typeof perAccountAmount === 'number' && perAccountAmount > 0)) return lang === 'ar' ? PER_ACCOUNT_TEXT_AR : PER_ACCOUNT_TEXT;
  return lang === 'ar' ? `${money(perAccountAmount)} عن كل حساب عميل يُسند إليه` : `${money(perAccountAmount)} per client account assigned`;
}

/** Whether an allowance (a kind, or a contract's or an offer's row) is paid per client account; missing: fixed. */
export const isPerAccount = (a: { basis?: string | null }): boolean => a.basis === 'per_account';

/** The seeded per-account kind (the client accounts migration and prisma/seed.ts add it): taxed, not insured. */
export const ACCOUNTS_ALLOWANCE = { nameEn: 'Accounts allowance', nameAr: 'بدل حسابات' } as const;

/** The contract and offer templates' line for a per-account allowance (the accounts_allowance tags). */
export const ACCOUNTS_ALLOWANCE_LINE_EN = 'An accounts allowance for each client account assigned, at the amount set for that account';
export const ACCOUNTS_ALLOWANCE_LINE_AR = 'بدل حسابات عن كل حساب عميل يُسند إليه، بالقيمة المحددة لهذا الحساب';

/** The same line with the contract's amount per account (27 October 2026); the line above without one. */
export function accountsAllowanceLine(perAccountAmount: number | null | undefined, money: (n: number) => string, lang: 'en' | 'ar' = 'en'): string {
  if (!(typeof perAccountAmount === 'number' && perAccountAmount > 0)) return lang === 'ar' ? ACCOUNTS_ALLOWANCE_LINE_AR : ACCOUNTS_ALLOWANCE_LINE_EN;
  return lang === 'ar'
    ? `بدل حسابات قدره ${money(perAccountAmount)} عن كل حساب عميل يُسند إليه`
    : `An accounts allowance of ${money(perAccountAmount)} for each client account assigned`;
}

/** The most a contract or an offer has of per-account kinds: one, so the month's accounts are paid once. */
export const ONE_PER_ACCOUNT_ALLOWANCE = 'Add one per-account allowance at most: the client accounts are paid once, as that allowance.';

/** The payroll runs that never change (with the CEO, approved, paid): no assignment may change what they paid. */
export const LOCKED_PAYROLL_STATUSES = ['pending_ceo', 'approved', 'paid'] as const;
export type LockedPayrollStatus = (typeof LOCKED_PAYROLL_STATUSES)[number];

// ---------- the days held ----------

/** A day's number, for counting the days between two dates (YYYY-MM-DD). */
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** A month's ('YYYY-MM') calendar days: 28 to 31. Throws for a month not written as one. */
export function calendarDaysInMonth(month: string): number {
  const m = MONTH.exec(month);
  if (!m) throw new RangeError(`calendarDaysInMonth: "${month}" is not a month (YYYY-MM)`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

/** A month's first and last day, YYYY-MM-DD. */
export function monthSpan(month: string): { first: string; last: string } {
  const days = calendarDaysInMonth(month);
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, '0')}` };
}

/** A period from a day to a day (YYYY-MM-DD); `to` null: open, still held. */
export interface DatePeriod {
  from: string;
  to: string | null;
}

/**
 * The calendar days of a period held in a month ('YYYY-MM'), and its first and last of them; only the days within
 * `within` (the parts of the month under a contract with the per-account allowance) when given. 0 days: none held.
 */
export function daysHeldIn(month: string, period: DatePeriod, within?: readonly { from: string; to: string }[]): { days: number; from: string | null; to: string | null } {
  for (const d of [period.from, period.to]) if (d !== null && !DATE.test(d)) throw new RangeError(`daysHeldIn: "${d}" is not a date (YYYY-MM-DD)`);
  const { first, last } = monthSpan(month);
  const from = period.from > first ? period.from : first;
  const to = period.to !== null && period.to < last ? period.to : last;
  if (from > to) return { days: 0, from: null, to: null };
  const spans = within ?? [{ from, to }];
  let days = 0;
  let firstHeld: string | null = null;
  let lastHeld: string | null = null;
  for (const s of spans) {
    const a = s.from > from ? s.from : from;
    const b = s.to < to ? s.to : to;
    if (a > b) continue;
    days += dayNumber(b) - dayNumber(a) + 1;
    if (firstHeld === null || a < firstHeld) firstHeld = a;
    if (lastHeld === null || b > lastHeld) lastHeld = b;
  }
  return { days, from: firstHeld, to: lastHeld };
}

/** An assignment as the month's allowance reads it: its account, its dates and its amount a month. */
export interface HeldAccount extends DatePeriod {
  accountId: string;
  /** The account's English name, as payroll lines and payslips show it (never its code). */
  name: string;
  /** Its amount a month, EGP. */
  amount: number;
}

/**
 * One account's share of a month's accounts allowance, as a payroll line keeps it (PayrollAllowance.accounts): the
 * account, its first and last day held in the month, the days held of the month's calendar days, its amount a month and
 * what it came to.
 */
export interface PayrollAccountShare {
  accountId: string;
  name: string;
  from: string;
  to: string;
  days: number;
  monthDays: number;
  monthly: number;
  amount: number;
}

/** An amount to the piaster. */
const piasters = (n: number) => Math.round(n * 100) / 100;

/** A part of the month under a contract with the per-account allowance, and its amount per account (null: none set). */
export interface PerAccountSpan {
  from: string;
  to: string;
  /** The contract's amount per account (27 October 2026), paid in place of each assignment's on these days. */
  rate?: number | null;
}

/**
 * A month's ('YYYY-MM') accounts allowance (owner, 25 October 2026: "By days"): for each assignment held in it, its
 * amount a month × its calendar days held ÷ the month's calendar days, to the piaster; and their sum. Only the days within
 * `within` count when given (the parts of the month under a contract with the per-account allowance); on a part whose
 * contract sets an amount per account (27 October 2026), that amount stands for the assignment's. Assignments not held in
 * the month are left out; the others in the order of their accounts' names, then their first day. A share's `monthly` is
 * the amount of its last days held.
 */
export function accountsAllowance(month: string, held: readonly HeldAccount[], within?: readonly PerAccountSpan[]): { amount: number; accounts: PayrollAccountShare[] } {
  const monthDays = calendarDaysInMonth(month);
  const accounts: PayrollAccountShare[] = [];
  const rateOf = (span: PerAccountSpan | undefined, h: HeldAccount) => (span && typeof span.rate === 'number' && span.rate > 0 ? span.rate : h.amount);
  for (const h of held) {
    const d = daysHeldIn(month, h, within);
    if (d.days <= 0) continue;
    // each part of the month at its own amount: the contract's per account, else the assignment's
    let raw = 0;
    let monthly = 0;
    for (const span of within ?? [undefined]) {
      const days = span ? daysHeldIn(month, h, [span]).days : d.days;
      if (days <= 0) continue;
      const rate = rateOf(span, h);
      raw += (rate * days) / monthDays;
      monthly = rate;
    }
    if (!(monthly > 0)) continue;
    accounts.push({ accountId: h.accountId, name: h.name, from: d.from!, to: d.to!, days: d.days, monthDays, monthly, amount: piasters(raw) });
  }
  accounts.sort((a, b) => a.name.localeCompare(b.name) || a.from.localeCompare(b.from));
  return { amount: piasters(accounts.reduce((sum, a) => sum + Math.round(a.amount * 100), 0) / 100), accounts };
}

// ---------- the rules of an assignment ----------

/** Whether two periods share a day (an open end runs on for good). */
export function periodsOverlap(a: DatePeriod, b: DatePeriod): boolean {
  const aTo = a.to ?? '9999-12-31';
  const bTo = b.to ?? '9999-12-31';
  return a.from <= bTo && b.from <= aTo;
}

/** The refusal of an assignment that overlaps another of the same person to the same account. */
export const OVERLAP_REFUSAL = (name: string, account: string, other: DatePeriod) =>
  `${name} is already on ${account} ${other.to ? `from ${shownDay(other.from)} to ${shownDay(other.to)}` : `from ${shownDay(other.from)}`}: change that assignment, or date this one outside it.`;

/** A date as the messages write it: 01/10/2026. */
export const shownDay = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

const DAY_AFTER = (date: string) => new Date((dayNumber(date) + 1) * 86_400_000).toISOString().slice(0, 10);
const DAY_BEFORE = (date: string) => new Date((dayNumber(date) - 1) * 86_400_000).toISOString().slice(0, 10);
const FOREVER = '9999-12-31';

/**
 * The days whose pay a change of an assignment changes (owner's rule, 25 October 2026: approved payroll never changes):
 * a new one, all its days; a changed amount, all its days before and after; a start or an end moved, the days between
 * where it was and where it is. Each as { from, to } (to FOREVER for an open end). None: nothing that is paid changes.
 */
export function changedDays(before: (DatePeriod & { amount: number }) | null, after: (DatePeriod & { amount: number }) | null): { from: string; to: string }[] {
  const span = (p: DatePeriod) => ({ from: p.from, to: p.to ?? FOREVER });
  if (!before && !after) return [];
  if (!before) return [span(after!)];
  if (!after) return [span(before)];
  if (Math.round(before.amount * 100) !== Math.round(after.amount * 100)) return [span(before), span(after)];
  const out: { from: string; to: string }[] = [];
  // the start moved: the days from the earlier start to the day before the later one
  if (before.from !== after.from) {
    const [a, b] = before.from < after.from ? [before.from, after.from] : [after.from, before.from];
    out.push({ from: a, to: DAY_BEFORE(b) });
  }
  // the end moved: the days after the earlier end to the later one
  const bTo = before.to ?? FOREVER;
  const aTo = after.to ?? FOREVER;
  if (bTo !== aTo) {
    const [a, b] = bTo < aTo ? [bTo, aTo] : [aTo, bTo];
    out.push({ from: DAY_AFTER(a), to: b });
  }
  return out;
}

/** "September 2026" from '2026-09'. */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthWords = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const nextMonth = (month: string) => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

const STATUS_WORDS: Record<LockedPayrollStatus, string> = { pending_ceo: 'is with the CEO', approved: 'is approved', paid: 'is paid' };

/**
 * Why a change is refused, a run with the CEO, approved or paid among the months it changes (owner's rule: they never
 * change): the latest such month, and what to do instead. `what`: 'start' (a new assignment or its start), 'end' (its end
 * brought in), 'amount' (its amount). E.g. "September 2026's payroll is approved: date it from October, or add the
 * difference in Additions."
 */
export function lockedMonthRefusal(month: string, status: LockedPayrollStatus, what: 'start' | 'end' | 'amount'): string {
  const head = `${monthWords(month)}'s payroll ${STATUS_WORDS[status]}`;
  const next = MONTH_NAMES[Number(nextMonth(month).slice(5, 7)) - 1];
  if (what === 'end') return `${head}: end it on ${shownDay(monthSpan(month).last)} or later, or deduct the difference in Additions / Deductions.`;
  if (what === 'amount') return `${head}: end this assignment on ${shownDay(monthSpan(month).last)} and add one from ${next} at the new amount, or add the difference in Additions.`;
  return `${head}: date it from ${next}, or add the difference in Additions.`;
}

/**
 * The latest month with a run with the CEO, approved or paid among the days changed (changedDays), with its status;
 * null when none is. `locked`: those runs' months ('YYYY-MM') and statuses.
 */
export function lockedAmong(days: readonly { from: string; to: string }[], locked: readonly { month: string; status: LockedPayrollStatus }[]): { month: string; status: LockedPayrollStatus } | null {
  let found: { month: string; status: LockedPayrollStatus } | null = null;
  for (const run of locked) {
    const { first, last } = monthSpan(run.month);
    if (days.some((d) => d.from <= last && d.to >= first) && (!found || run.month > found.month)) found = run;
  }
  return found;
}

// ---------- in words ----------

/** "Accounts allowance (2 accounts)": a payroll line's or a payslip's accounts allowance with its count. */
export function accountsAllowanceLabel(name: string, count: number): string {
  return `${name} (${count} ${count === 1 ? 'account' : 'accounts'})`;
}

/** The same in Arabic: "بدل حسابات (حسابان)". `digits` writes a number (the payslip's Arabic digits). */
export function accountsAllowanceLabelAr(name: string, count: number, digits: (n: number) => string = String): string {
  const words = count === 1 ? 'حساب واحد' : count === 2 ? 'حسابان' : count <= 10 ? `${digits(count)} حسابات` : `${digits(count)} حسابًا`;
  return `${name} (${words})`;
}

/** An account's share in a few words, for a line's breakdown and the payslip: "Acme 1,500.00" or "Acme 375.00 (8 of 31 days)". */
export function accountShareText(s: Pick<PayrollAccountShare, 'name' | 'days' | 'monthDays'>, amount: string): string {
  return s.days >= s.monthDays ? `${s.name} ${amount}` : `${s.name} ${amount} (${s.days} of ${s.monthDays} days)`;
}
