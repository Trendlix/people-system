import {
  isTimesheetFilter,
  isYmd,
  TIMESHEET_HOURS_STEP,
  timesheetEntryProblems,
  timesheetWeekOf,
  type TimesheetClientOption,
  type TimesheetEntryInput,
  type TimesheetEntryView,
  type TimesheetFilter,
  type TimesheetStatus,
} from '@trendlix/shared';

// Timesheets on the site (owner, 4 November 2026: "Timesheet in app/website", "Direct manager, weekly", "Only those HR
// switches on"; packages/shared timesheets.ts): the addresses, the week asked for, the lists' filters, and the lines
// as the My Timesheet form keeps them (text as typed) and sends them (hours read, blank lines dropped, the shared rules
// checked). Pure code (relative imports), tested in timesheets.test.ts; the API checks everything again.

export const MY_TIMESHEET_PATH = '/my-timesheet';
export const TIMESHEETS_PATH = '/timesheets';

/** My Timesheet at a week (any day of it; none: this week). */
export const myTimesheetHref = (week?: string | null) => (week ? `${MY_TIMESHEET_PATH}?week=${week}` : MY_TIMESHEET_PATH);

/** A week's page, for the one who approves it and HR. */
export const timesheetHref = (id: string) => `${TIMESHEETS_PATH}/${encodeURIComponent(id)}`;

/** The API's address of the caller's week (GET, PUT) and of sending it (POST). */
export const myTimesheetApi = (week: string) => `/me/timesheet?week=${week}`;
export const submitTimesheetApi = (week: string) => `/me/timesheet/submit?week=${week}`;

/** The week asked for in the address (its Sunday); null: none or not a day. */
export function weekFrom(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return isYmd(s) ? timesheetWeekOf(s) : null;
}

// ---------- the lists ----------

export const TIMESHEET_FILTER_LABELS: Record<TimesheetFilter, string> = {
  waiting: 'Waiting for You',
  submitted: 'Waiting for Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  all: 'All',
};

export interface TimesheetsQuery {
  status: TimesheetFilter;
  /** A week's Sunday; null: every week. */
  week: string | null;
}

/** The list's filters as the address carries them: waiting unless another is asked for. */
export function readTimesheetsQuery(q: Record<string, string | string[] | undefined>): TimesheetsQuery {
  const status = Array.isArray(q.status) ? q.status[0] : q.status;
  return { status: isTimesheetFilter(status) ? status : 'waiting', week: weekFrom(q.week) };
}

/** GET /timesheets with the filters. */
export function timesheetsApi(q: TimesheetsQuery): string {
  const params = new URLSearchParams({ status: q.status });
  if (q.week) params.set('week', q.week);
  return `/timesheets?${params}`;
}

/** The list page with the filters (waiting left out, as it is the default). */
export function timesheetsHref(q: Partial<TimesheetsQuery>): string {
  const params = new URLSearchParams();
  if (q.status && q.status !== 'waiting') params.set('status', q.status);
  if (q.week) params.set('week', q.week);
  const qs = params.toString();
  return qs ? `${TIMESHEETS_PATH}?${qs}` : TIMESHEETS_PATH;
}

/** A status's badge colours: approved green, waiting amber, rejected red, not sent quiet. */
export function timesheetTone(status: TimesheetStatus | null): string {
  if (status === 'approved') return 'bg-ok-soft text-ok';
  if (status === 'submitted') return 'bg-warn-soft text-warn';
  if (status === 'rejected') return 'bg-danger-soft text-danger';
  return 'bg-canvas text-muted';
}

// ---------- the form's lines ----------

/** A line as the form keeps it: text as typed. */
export interface TimesheetLine {
  key: string;
  date: string;
  clientAccountId: string;
  task: string;
  hours: string;
  note: string;
}

/** Hours as the form shows them: "1.5", "8". */
export const hoursInput = (hours: number): string => String(Number(hours.toFixed(2)));

/** The week's saved lines as the form starts them. */
export const linesOf = (entries: readonly TimesheetEntryView[]): TimesheetLine[] =>
  entries.map((e) => ({ key: e.id, date: e.date, clientAccountId: e.client?.id ?? '', task: e.task ?? '', hours: hoursInput(e.hours), note: e.note ?? '' }));

/** A new blank line on a day. */
export const blankLine = (date: string, key: string): TimesheetLine => ({ key, date, clientAccountId: '', task: '', hours: '', note: '' });

/**
 * Hours as typed: "1.5", "1,5", "7:45" (7.75), "8"; null when not a number of hours in quarter hours from 0.25 to 24.
 */
export function parseHours(text: string): number | null {
  const t = text.trim().replace(',', '.');
  let hours: number;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (clock) hours = Number(clock[1]) + Number(clock[2]) / 60;
  else if (/^\d{1,2}(\.\d{1,2})?$/.test(t)) hours = Number(t);
  else return null;
  if (!(hours > 0) || hours > 24) return null;
  return Math.abs(hours / TIMESHEET_HOURS_STEP - Math.round(hours / TIMESHEET_HOURS_STEP)) < 1e-9 ? hours : null;
}

const isBlank = (l: TimesheetLine) => !l.clientAccountId && !l.task.trim() && !l.hours.trim() && !l.note.trim();

/**
 * The form's lines as sent: a blank line left out, the hours read, every problem in words (hours not readable, then the
 * shared rules: the week, the days to come, a client or a task, a day past 24 hours).
 */
export function entriesOf(
  lines: readonly TimesheetLine[],
  ctx: { weekStart: string; today: string; employedFrom?: string | null; employedTo?: string | null },
): { entries: TimesheetEntryInput[]; errors: string[] } {
  const errors: string[] = [];
  const entries: TimesheetEntryInput[] = [];
  for (const l of lines) {
    if (isBlank(l)) continue;
    const hours = parseHours(l.hours);
    if (hours === null) {
      errors.push('Enter the hours from 0.25 to 24, in quarter hours, e.g. 1.5, 7.75 or 7:45.');
      continue;
    }
    entries.push({ date: l.date, clientAccountId: l.clientAccountId || null, task: l.task.trim() || null, hours, note: l.note.trim() || null });
  }
  const problems = timesheetEntryProblems(entries, { weekStart: ctx.weekStart, today: ctx.today, employedFrom: ctx.employedFrom ?? null, employedTo: ctx.employedTo ?? null });
  return { entries, errors: [...new Set([...errors, ...problems])] };
}

/** Each day's hours as typed so far (unreadable hours count as none), to the quarter hour. */
export function lineTotals(lines: readonly TimesheetLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    const h = parseHours(l.hours);
    if (h !== null) out.set(l.date, Math.round(((out.get(l.date) ?? 0) + h) * 100) / 100);
  }
  return out;
}

/** The clients as the picker groups them: those they work on, then the others. */
export function clientGroups(clients: readonly TimesheetClientOption[]): { assigned: TimesheetClientOption[]; others: TimesheetClientOption[] } {
  return { assigned: clients.filter((c) => c.assigned), others: clients.filter((c) => !c.assigned) };
}

/** What a line is for: "Client A · Design", "Design", "Client A". */
export const lineWhat = (e: Pick<TimesheetEntryView, 'client' | 'task'>): string => [e.client?.name, e.task].filter(Boolean).join(' · ') || '—';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Sun 01/11": a day as the week's rows head it. */
export const dayHead = (date: string): string => `${DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? ''} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
