// Timesheets (owner, 4 November 2026: "i have a group of employees working on timesheets being paid per hour or monthly,
// how will we deal with them?"; asked and answered: "Timesheet in app/website", "Direct manager, weekly", "Full salary,
// hours tracked"; "Only those HR switches on"): someone whose employment HR switched to "Works on timesheets" logs each
// day's hours against a client account or a task, in the app or on the website, instead of checking in; sends the week
// (Sunday to Saturday) to be approved; the one who approves their leave (the direct manager, else the team's lead, else
// the department's head; nobody: HR) approves the week or rejects it with why, and a rejected week is corrected and sent
// again. Approved hours are what someone paid by the hour is paid for; a monthly salary is paid in full, the hours only
// tracked. Pure code: the API enforces these rules, the web and the app show them.

export const TIMESHEET_STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];
export const isTimesheetStatus = (value: unknown): value is TimesheetStatus => (TIMESHEET_STATUSES as readonly unknown[]).includes(value);

export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatus, string> = {
  draft: 'Not sent yet',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected: correct it and send it again',
};

/** The lists' filters: waiting for the caller, or each status, or all. */
export const TIMESHEET_FILTERS = ['waiting', 'submitted', 'approved', 'rejected', 'all'] as const;
export type TimesheetFilter = (typeof TIMESHEET_FILTERS)[number];
export const isTimesheetFilter = (value: unknown): value is TimesheetFilter => (TIMESHEET_FILTERS as readonly unknown[]).includes(value);

export const TIMESHEET_LIMITS = {
  /** The most hours a day, all its lines together. */
  hoursPerDay: 24,
  /** The most lines a week. */
  entriesPerWeek: 120,
  task: 200,
  note: 500,
  reason: 1000,
} as const;

/** Hours are logged in quarter hours: 0.25, 1.5, 7.75. */
export const TIMESHEET_HOURS_STEP = 0.25;

// ---------- the week ----------

const DAY_MS = 86_400_000;
const parse = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const ymdOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const isYmd = (value: unknown): value is string => typeof value === 'string' && DATE.test(value) && Number.isFinite(parse(value)) && ymdOf(parse(value)) === value;

/** The Sunday a day's week starts on (the week runs Sunday to Saturday, as the working week here starts on Sunday). */
export const timesheetWeekOf = (ymd: string): string => {
  const ms = parse(ymd);
  return ymdOf(ms - new Date(ms).getUTCDay() * DAY_MS);
};

/** A week's seven days, Sunday first. */
export const timesheetWeekDays = (weekStart: string): string[] => Array.from({ length: 7 }, (_, i) => ymdOf(parse(weekStart) + i * DAY_MS));

/** The week before or after. */
export const timesheetWeekShift = (weekStart: string, weeks: number): string => ymdOf(parse(weekStart) + weeks * 7 * DAY_MS);

const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

/** "01/11/2026 to 07/11/2026". */
export const timesheetWeekText = (weekStart: string): string => `${shown(weekStart)} to ${shown(timesheetWeekDays(weekStart)[6])}`;

// ---------- a line ----------

/** A line as sent: its day, a client account or a task (or both), its hours, a note. */
export interface TimesheetEntryInput {
  date: string;
  clientAccountId?: string | null;
  task?: string | null;
  hours: number;
  note?: string | null;
}

/** "1.5" for 1.5 hours; "7:45" reads as 7.75 too. */
export const hoursOk = (hours: unknown): hours is number =>
  typeof hours === 'number' && Number.isFinite(hours) && hours > 0 && hours <= TIMESHEET_LIMITS.hoursPerDay && Math.abs(hours / TIMESHEET_HOURS_STEP - Math.round(hours / TIMESHEET_HOURS_STEP)) < 1e-9;

/** What the week's days may hold: within the week, not to come, within their employment (and since they log hours). */
export interface TimesheetDaysContext {
  weekStart: string;
  today: string;
  employedFrom: string | null;
  employedTo: string | null;
}

/**
 * What is wrong with a week's lines, in words: a day outside the week, a day to come, a day outside their employment,
 * neither a client nor a task, hours not in quarter hours from 0.25 to 24, a day past 24 hours, too many lines, a task or
 * note too long. The client accounts themselves are the API's to check.
 */
export function timesheetEntryProblems(entries: readonly TimesheetEntryInput[], ctx: TimesheetDaysContext): string[] {
  const problems = new Set<string>();
  const days = new Set(timesheetWeekDays(ctx.weekStart));
  const perDay = new Map<string, number>();
  if (entries.length > TIMESHEET_LIMITS.entriesPerWeek) problems.add(`Keep a week to ${TIMESHEET_LIMITS.entriesPerWeek} lines or fewer.`);
  for (const e of entries) {
    if (!isYmd(e.date) || !days.has(e.date)) {
      problems.add(`Each line’s day must be within the week of ${timesheetWeekText(ctx.weekStart)}.`);
      continue;
    }
    if (e.date > ctx.today) problems.add(`${shown(e.date)} hasn’t come yet: log hours once they are worked.`);
    if ((ctx.employedFrom && e.date < ctx.employedFrom) || (ctx.employedTo && e.date > ctx.employedTo)) problems.add(`${shown(e.date)} is outside your employment.`);
    const task = typeof e.task === 'string' ? e.task.trim() : '';
    if (!e.clientAccountId && !task) problems.add('Choose the client, or write the task, on each line.');
    if (task.length > TIMESHEET_LIMITS.task) problems.add(`Keep the task to ${TIMESHEET_LIMITS.task} characters or fewer.`);
    if (typeof e.note === 'string' && e.note.trim().length > TIMESHEET_LIMITS.note) problems.add(`Keep the note to ${TIMESHEET_LIMITS.note} characters or fewer.`);
    if (!hoursOk(e.hours)) {
      problems.add('Enter the hours from 0.25 to 24, in quarter hours, e.g. 1.5 or 7.75.');
      continue;
    }
    perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.hours);
  }
  for (const [date, hours] of perDay) if (hours > TIMESHEET_LIMITS.hoursPerDay) problems.add(`${shown(date)} has ${timesheetHoursText(hours)}: a day has 24 hours at most.`);
  return [...problems];
}

/** "1 hour", "7.5 hours", "0.25 hours". */
export const timesheetHoursText = (hours: number): string => `${Number(hours.toFixed(2))} ${hours === 1 ? 'hour' : 'hours'}`;

/** Lines' hours added up, to the quarter hour. */
export const totalHours = (entries: readonly { hours: number }[]): number => Math.round(entries.reduce((n, e) => n + e.hours, 0) * 100) / 100;

// ---------- who acts ----------

/** Why someone can't log hours (null: they can): no profile, no current employment, or not switched to timesheets. */
export function timesheetRefusal(profile: boolean, employment: { worksOnTimesheets: boolean } | null): string | null {
  if (!profile) return 'Your sign-in has no employee profile, so there are no hours to log.';
  if (!employment) return 'You have no current employment, so there are no hours to log.';
  if (!employment.worksOnTimesheets) return 'You check in and out instead of logging hours on a timesheet.';
  return null;
}

/** What the person who logs hours may do with a week: change its lines and send it while not sent or rejected. */
export const timesheetEditable = (status: TimesheetStatus | null): boolean => status === null || status === 'draft' || status === 'rejected';

/** Why a week can't be sent (null: it can), in words. */
export function timesheetSubmitProblem(status: TimesheetStatus | null, entries: number): string | null {
  if (status === 'submitted') return 'This week is waiting for approval already.';
  if (status === 'approved') return 'This week is approved already.';
  if (!entries) return 'Log the hours of at least one day before sending the week.';
  return null;
}

// ---------- the views ----------

/** A client account to log hours against: those they work on first (assigned now), then the other active ones. */
export interface TimesheetClientOption {
  id: string;
  name: string;
  /** They work on it now (an assignment covering today). */
  assigned: boolean;
}

export interface TimesheetEntryView {
  id: string;
  date: string;
  client: { id: string; name: string } | null;
  task: string | null;
  hours: number;
  note: string | null;
}

/** A week of someone's hours. */
export interface TimesheetWeekView {
  /** None while nothing is saved for the week yet. */
  id: string | null;
  employee: { id: string; fullNameEn: string; employeeCode: string | null };
  weekStart: string;
  weekEnd: string;
  status: TimesheetStatus | null;
  entries: TimesheetEntryView[];
  totalHours: number;
  /** Each day of the week and its hours (0 for none), Sunday first. */
  days: { date: string; hours: number }[];
  submittedAt: string | null;
  decidedAt: string | null;
  /** Who decided it (a name), for the person and those who see it. */
  decidedBy: string | null;
  rejectReason: string | null;
  /** Who approves it: the one who approves their leave; null: HR (the CEO for a C-level person). */
  approver: { id: string; fullNameEn: string } | null;
  /** The caller approves or rejects it now. */
  waitingForYou: boolean;
  can: { edit: boolean; submit: boolean; decide: boolean };
}

/** GET /me/timesheet: the week, whether they log hours at all (why not), and the clients to pick from. */
export interface MyTimesheetView extends TimesheetWeekView {
  refusal: string | null;
  clients: TimesheetClientOption[];
  /** The weeks before still not sent or rejected, for a reminder: their Sundays, newest first (at most 8 weeks back). */
  unsent: string[];
}

/** A week in the lists (approvers and HR): who, which week, its hours and where it stands. */
export interface TimesheetListItem {
  id: string;
  employee: { id: string; fullNameEn: string; employeeCode: string | null };
  weekStart: string;
  weekEnd: string;
  status: TimesheetStatus;
  totalHours: number;
  submittedAt: string | null;
  waitingForYou: boolean;
}

/** The decisions on a week. */
export const TIMESHEET_DECISIONS = ['approve', 'reject'] as const;
export type TimesheetDecision = (typeof TIMESHEET_DECISIONS)[number];
