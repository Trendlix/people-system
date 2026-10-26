import {
  isEmail,
  isMeetingConnectProblem,
  normalEmail,
  ZOHO_PEOPLE_NIGHTLY_TIME,
  ZOHO_PEOPLE_PAGE,
  ZOHO_RECORDED_LABEL,
  ZOHO_RUN_STATUS_LABELS,
  ZOHO_SKIP_LABELS,
  zohoFetchProblems,
  zohoPeopleConnectProblemText,
  type Role,
  type ZohoPeopleConnectionView,
  type ZohoPeopleConnectResult,
  type ZohoPeopleNote,
  type ZohoPeopleTestView,
  type ZohoPeopleView,
  type ZohoPersonRef,
  type ZohoRunView,
} from '@trendlix/shared';
import { formatDate, parseDate } from './format';

// Zoho People's attendance on the website (owner, 25 October 2026: "can i fetch checkin and out transactions from zoho
// people through api?"; asked, "Yes, daily + backfill"; then "but can it fetch historical data?"): who sees Organization
// → Zoho People, what the return from Zoho's sign-in says, what the page's forms send, and how a connection, a run and
// its progress read. Pure code (no server-only), so client components, the return route and the tests use it. The API
// checks every request again (packages/shared zoho-people.ts).

/** Organization → Zoho People. */
export const ZOHO_PEOPLE_SETTINGS_PATH = ZOHO_PEOPLE_PAGE;

type Viewer = { roles: readonly Role[]; developer?: boolean };

/**
 * Who sees Organization → Zoho People: HR and a Super Admin (HR fetches, a Super Admin connects too), never a developer
 * (the page holds the Zoho account and the people Zoho doesn't know).
 */
export const seesZohoPeople = (user: Viewer): boolean => !user.developer && (user.roles.includes('hr') || user.roles.includes('super_admin'));

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

/** Zoho's error code as the return address may carry it: letters, digits, _ . - only, else nothing. */
const saidOf = (v: string | null | undefined): string | null => (v && /^[a-z0-9_.-]{1,60}$/i.test(v) ? v : null);

/** What the page says on coming back from Zoho's sign-in. */
export type ZohoPeopleBanner = { tone: 'ok' | 'danger'; text: string } | null;

/** The banner of `?connected=1` or `?problem=refused&said=invalid_client`: only known problems, in the system's words. */
export function zohoPeopleBanner(query: Record<string, string | string[] | undefined>): ZohoPeopleBanner {
  if (one(query.connected) === '1') {
    return { tone: 'ok', text: `Zoho People is connected: every night at ${ZOHO_PEOPLE_NIGHTLY_TIME} yesterday’s check-ins are fetched, and earlier days can be fetched below.` };
  }
  const problem = one(query.problem);
  if (isMeetingConnectProblem(problem)) return { tone: 'danger', text: zohoPeopleConnectProblemText(problem, saidOf(one(query.said))) };
  return null;
}

/** Where the return from Zoho's sign-in sends the person: this page, saying connected or why not. `fallback`: no answer. */
export function zohoPeopleCallbackTarget(result: Pick<ZohoPeopleConnectResult, 'ok' | 'problem' | 'said'> | null, fallback: ZohoPeopleConnectResult['problem'] & string = 'unreachable'): string {
  if (result?.ok) return `${ZOHO_PEOPLE_SETTINGS_PATH}?connected=1`;
  const problem = result?.problem && isMeetingConnectProblem(result.problem) ? result.problem : fallback;
  const said = saidOf(result?.said);
  return `${ZOHO_PEOPLE_SETTINGS_PATH}?problem=${problem}${said ? `&said=${encodeURIComponent(said)}` : ''}`;
}

// ---------- the connection ----------

/** "Connected as hr@trendlix.com since 25/10/2026, 10:30 AM.", "Needs connecting again: …", or "Not connected." */
export function zohoConnectionText(c: Pick<ZohoPeopleConnectionView, 'status' | 'accountEmail' | 'connectedAt' | 'problem'> | null, when: (iso: string) => string): string {
  if (!c) return 'Not connected.';
  if (c.status === 'needs_reconnecting') return `Needs connecting again: ${c.problem ?? 'a Super Admin connects it again.'}`;
  return `Connected as ${c.accountEmail} since ${when(c.connectedAt)}.`;
}

/** "Zoho People’s time zone: Africa/Cairo · date format: dd-MMM-yyyy", or what isn't read yet. */
export function zohoZoneText(c: Pick<ZohoPeopleConnectionView, 'timeZone' | 'dateFormat'>, readIn: string): string {
  const zone = c.timeZone ? `Zoho People’s time zone: ${c.timeZone}` : `Zoho People’s time zone isn’t read yet: its times are read as ${readIn}’s`;
  const format = c.dateFormat ? `date format: ${c.dateFormat}` : 'date format not read yet';
  return `${zone} · ${format}.`;
}

/** Whether Zoho's time zone is another than the one its times are read in: said as a warning. */
export const zohoZoneDiffers = (c: Pick<ZohoPeopleConnectionView, 'timeZone'>, readIn: string): boolean => !!c.timeZone && c.timeZone !== readIn;

/** "Last test 25/10/2026, 10:30 AM: …". */
export const zohoTestText = (t: ZohoPeopleTestView, when: (iso: string) => string): string => `Last test ${when(t.at)}: ${t.message}`;

/** POST /zoho-people/test's body: a colleague's work email to read too, or none (the connected account's own). */
export function zohoTestBody(fd: FormData): { body: { email: string | null } | null; errors: string[] } {
  const raw = fd.get('email');
  const email = normalEmail(typeof raw === 'string' ? raw.trim() : '');
  if (!email) return { body: { email: null }, errors: [] };
  if (!isEmail(email)) return { body: null, errors: ['Write the colleague’s work email in full, e.g. name@trendlix.com.'] };
  return { body: { email }, errors: [] };
}

// ---------- Fetch from Zoho ----------

const pad = (n: number) => String(n).padStart(2, '0');

/** The day before `today` (YYYY-MM-DD). */
export function yesterdayOf(today: string): string {
  const d = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The form's days as typed (DD/MM/YYYY), as YYYY-MM-DD; null for one that isn't a day (or empty). */
export function typedDay(value: FormDataEntryValue | string | null | undefined): string | null {
  const parsed = parseDate(typeof value === 'string' ? value : '');
  return parsed ? parsed : null;
}

/** POST /zoho-people/runs' body from the form: the two days, and everyone or the people chosen. */
export function zohoFetchBody(fd: FormData, today: string): { body: { from: string; to: string; employeeIds: string[] } | null; errors: string[] } {
  const from = typedDay(fd.get('from'));
  const to = typedDay(fd.get('to'));
  if (!from || !to) return { body: null, errors: ['Enter the first and the last day as DD/MM/YYYY, e.g. 01/09/2026.'] };
  const who = fd.get('who') === 'chosen' ? 'chosen' : 'everyone';
  const employeeIds = who === 'chosen' ? [...new Set(fd.getAll('employeeId').filter((v): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)))] : [];
  const errors = zohoFetchProblems({ from, to }, today).map((p) => p.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (d) => formatDate(d)));
  if (who === 'chosen' && !employeeIds.length) errors.push('Choose the people to fetch, or fetch everyone.');
  return errors.length ? { body: null, errors } : { body: { from, to, employeeIds }, errors: [] };
}

// ---------- the runs ----------

/** How far a run is, 0 to 100: its calls made of those it makes (a finished run with none: 100). */
export function runPercent(run: Pick<ZohoRunView, 'status' | 'counts'>): number {
  const { calls, callsDone } = run.counts;
  if (calls <= 0) return run.status === 'running' ? 0 : 100;
  return Math.max(0, Math.min(100, Math.floor((callsDone / calls) * 100)));
}

/** The days a run covers: "24/10/2026", or "01/09/2026 – 30/09/2026". */
export const runDaysText = (run: Pick<ZohoRunView, 'from' | 'to'>): string => (run.from === run.to ? formatDate(run.from) : `${formatDate(run.from)} – ${formatDate(run.to)}`);

/** Who a run fetches: "Everyone", "3 people chosen". */
export const runWhoText = (run: Pick<ZohoRunView, 'everyone' | 'chosen'>): string => (run.everyone ? 'Everyone' : `${run.chosen} ${run.chosen === 1 ? 'person' : 'people'} chosen`);

const days = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'day' : 'days'}`;

/**
 * What a run did, its counts that aren't none, in words: "12 days added (34 check-ins and check-outs), 2 replaced as Zoho
 * changed them, 40 unchanged, 3 added for the record, payroll unchanged, 5 payroll lines refilled". Null: nothing yet.
 */
export function runSummaryText(run: Pick<ZohoRunView, 'counts'>): string | null {
  const c = run.counts;
  const parts = [
    c.daysAdded ? `${days(c.daysAdded)} added${c.punchesAdded ? ` (${c.punchesAdded.toLocaleString('en-US')} ${c.punchesAdded === 1 ? 'check-in or check-out' : 'check-ins and check-outs'})` : ''}` : null,
    c.daysReplaced ? `${days(c.daysReplaced)} replaced as Zoho changed them` : null,
    c.daysUnchanged ? `${days(c.daysUnchanged)} unchanged` : null,
    c.daysRecorded ? `${days(c.daysRecorded)} ${ZOHO_RECORDED_LABEL.toLowerCase()}` : null,
    c.linesRefilled ? `${c.linesRefilled.toLocaleString('en-US')} draft payroll ${c.linesRefilled === 1 ? 'line' : 'lines'} refilled` : null,
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join(', ') : null;
}

/** The days left as they were or not fetched, by why: "Payroll approved: the day kept as it was: 4 days". */
export const runSkippedLines = (run: Pick<ZohoRunView, 'skipped'>): string[] => run.skipped.filter((s) => s.days > 0).map((s) => `${ZOHO_SKIP_LABELS[s.reason] ?? s.reason}: ${days(s.days)}`);

/**
 * A run's badge: its status, but a finished run with days whose answer couldn't be read, or that Zoho refused to share,
 * "Finished with problems" in the warning colour (owner, 26 October 2026: the first fetch said "Finished" in green with
 * 1,087 days unread, and nothing could be found on the system).
 */
export function runBadge(run: Pick<ZohoRunView, 'status' | 'skipped'>): { label: string; className: string } {
  const troubled = run.skipped.some((s) => (s.reason === 'unreadable' || s.reason === 'not_permitted') && s.days > 0);
  if (run.status === 'finished' && troubled) return { label: 'Finished with problems', className: 'bg-warn-soft text-warn' };
  const className = run.status === 'failed' ? 'bg-danger-soft text-danger' : run.status === 'running' ? 'bg-accent-soft text-accent' : run.status === 'cancelled' ? 'bg-line-soft text-muted' : 'bg-ok-soft text-ok';
  return { label: ZOHO_RUN_STATUS_LABELS[run.status], className };
}

/** "Fetching: 1,200 of 14,600 calls (8%), 3 of 40 people". */
export function runProgressText(run: Pick<ZohoRunView, 'status' | 'counts'>): string {
  const c = run.counts;
  const n = (x: number) => x.toLocaleString('en-US');
  return `${ZOHO_RUN_STATUS_LABELS[run.status]}: ${n(c.callsDone)} of ${n(c.calls)} ${c.calls === 1 ? 'call' : 'calls'} (${runPercent(run)}%), ${n(c.peopleDone)} of ${n(c.people)} ${c.people === 1 ? 'person' : 'people'}`;
}

/** "Zoho asked to wait: going on at 2:20 PM." (its lock past its limit), or null. `clock`: how the page writes a time. */
export const runWaitingText = (run: Pick<ZohoRunView, 'waitingUntil'>, clock: (iso: string) => string): string | null =>
  run.waitingUntil ? `Zoho asked to wait: going on at ${clock(run.waitingUntil)}.` : null;

/** A person of a run as listed: "Sara Planner (EMP-7) · sara@trendlix.com · former employee". */
export function personText(p: ZohoPersonRef): string {
  return [`${p.name} (${p.employeeCode})`, p.email, p.former ? 'former employee' : null].filter(Boolean).join(' · ');
}

/** "and 2 C-level people the CEO sees", for the people hidden from HR; null for none. */
export const hiddenText = (n: number): string | null => (n > 0 ? `and ${n} C-level ${n === 1 ? 'person' : 'people'} only the CEO and a Super Admin see` : null);

/** The nightly run in words: when it runs, and how the last one went. */
export function nightlyText(nightly: ZohoPeopleView['nightly']): string {
  const base = `Every night at ${nightly.time} (Cairo), yesterday’s check-ins and check-outs are fetched for everyone.`;
  const last = nightly.last;
  if (!last) return `${base} It hasn’t run yet.`;
  const how = last.status === 'failed' ? `failed${last.problem ? `: ${last.problem}` : ''}` : ZOHO_RUN_STATUS_LABELS[last.status].toLowerCase();
  return `${base} The last one, for ${formatDate(last.day)}, ${how.endsWith('.') ? how.slice(0, -1) : how}.`;
}

// ---------- choosing people ----------

/** Someone to choose for a fetch (GET /zoho-people/people): everyone with an employment, the former ones marked. */
export interface ZohoChoosable {
  id: string;
  name: string;
  employeeCode: string;
  former: boolean;
}

/** The people still to choose, by name: "Sara Planner · EMP-7 · former". */
export function zohoPersonOptions(people: readonly ZohoChoosable[], taken: readonly string[]): { value: string; label: string }[] {
  const out = new Set(taken);
  return people
    .filter((p) => !out.has(p.id))
    .map((p) => ({ value: p.id, label: [p.name, p.employeeCode, p.former ? 'former' : null].filter(Boolean).join(' · ') }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

/** The people chosen, in the order chosen, each once. */
export const zohoWithChosen = (chosen: readonly string[], id: string): string[] => (id && !chosen.includes(id) ? [...chosen, id] : [...chosen]);

/** The days a range typed covers (both counted), or null while it isn't one, the wrong way round, or over a year and a day. */
export function typedRangeDays(from: string | null, to: string | null): number | null {
  if (!from || !to || from > to) return null;
  const n = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return n > 0 && n <= 366 ? n : null;
}

// ---------- the dashboard's note ----------

/** The home page's note from GET /zoho-people/note's answer: null for none, or anything that isn't one. */
export function noteOf(body: unknown): ZohoPeopleNote {
  if (!body || typeof body !== 'object') return null;
  const n = body as { tone?: unknown; text?: unknown };
  return (n.tone === 'warn' || n.tone === 'danger') && typeof n.text === 'string' && n.text.trim() ? { tone: n.tone, text: n.text } : null;
}
