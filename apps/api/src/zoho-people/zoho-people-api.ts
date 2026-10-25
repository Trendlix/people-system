import { pairPresses, placeOf, pressPairsOf, ZOHO_PEOPLE_DEFAULT_DATE_FORMAT, ZOHO_PEOPLE_DEFAULT_TIME_ZONE, ZOHO_PEOPLE_SCOPES, zonedMoment, type ImportedDay, type PressMoment } from '@trendlix/shared';
import { zohoHosts } from '../calendars/calendar-providers.js';
import type { HttpAnswer, HttpRequest } from '../meetings/meeting-providers.js';

// Zoho People as the system talks to it (owner, 25 October 2026: "can i fetch checkin and out transactions from zoho
// people through api?"; asked, "Yes, daily + backfill"). Pure code: the requests are built here and the answers read
// here; ZohoPeopleHttp sends them (and the tests fake it: never a real call). Tested in zoho-people-api.spec.ts. Zoho's
// docs, read 25 October 2026 (www.zoho.com/people/api):
// - The sign-in is Zoho Accounts' (the calendars' code: calendar-providers.ts), with Zoho People's scopes
//   (ZOHO_PEOPLE_SCOPES), offline access and consent, PKCE; the return names the account's data centre
//   (`accounts-server`), where its tokens are made, and People's address is that data centre's (people.zoho.com,
//   people.zoho.eu, people.zoho.in, people.zoho.com.au …).
// - Attendance Entries: GET {people}/people/api/attendance/getAttendanceEntries?date=&dateFormat=&emailId= (or empId),
//   "Authorization: Zoho-oauthtoken …": one employee's day, `date` "in organisation date format" (so the system sends
//   it in Zoho's date format and names that format as `dateFormat` too), answered as { firstIn, lastOut, totalHrs,
//   status, entries: [{ checkIn, checkOut, checkIn_Location, checkOut_Location, sourceOfPunchIn, sourceOfPunchOut }] },
//   its times on the organization's clock with no zone said ("03-Mar-2023 - 09:00 AM", "2023-03-03 09:00:00"). 100 calls
//   a minute at most, "Lock period: 10 minutes" past it.
// - Get Organization Info: GET {people}/api/v3/organization (ZOHOPEOPLE.organization.READ, an admin's): its TimeZone and
//   DateFormat, so the times are read on Zoho's own clock.
// - Its errors: { response: { errors: { code, message }, status: 1 } } and the like; 7202 a refused token, 7209 "API
//   access blocked since threshold limit exceeded", 7048 "No such user found", 7037/7040 permission denied, 7054/7055 a
//   date or its format refused, 7207/7216 the wrong method, 7024 no records; 429 for a day's calls used up.
// The addresses Zoho gives a punch are read once, for office or remote (placeOf), and never kept nor sent anywhere.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_OF: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t !== '-' && t !== '--' ? t : null;
};

// ---------- the addresses ----------

/** Zoho People's address for a sign-in's data centre: the calendar's with "people" (https://people.zoho.eu). */
export function zohoPeopleHost(accountsServer: string | null | undefined): string {
  return zohoHosts(accountsServer).calendar.replace('://calendar.', '://people.');
}

/** Zoho's sign-in page for Zoho People: its scopes, a refresh token (offline, consent every time), PKCE S256. */
export function zohoPeopleAuthorizeUrl(app: { clientId: string }, p: { redirectUri: string; state: string; challenge: string; accounts: string | null }): string {
  const q = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    scope: ZOHO_PEOPLE_SCOPES.join(','),
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${zohoHosts(p.accounts).accounts}/oauth/v2/auth?${q.toString()}`;
}

// ---------- Zoho's date formats ----------

/** The patterns tried in turn when Zoho refuses a date's format, after the organization's own. */
export const ZOHO_DATE_PATTERNS = ['dd-MMM-yyyy', 'yyyy-MM-dd', 'dd/MM/yyyy', 'MM/dd/yyyy', 'dd.MM.yyyy', 'dd-MM-yyyy', 'MM-dd-yyyy', 'yyyy/MM/dd'] as const;

const TOKEN = /yyyy|yy|MMM|MM|M|dd|d/g;

/** Whether a Zoho date format is one the system writes and reads: day, month and year, with - / . , or spaces. */
export function isZohoDatePattern(pattern: unknown): pattern is string {
  if (typeof pattern !== 'string' || pattern.length > 20 || !/^[dMy\-/., ]+$/.test(pattern)) return false;
  const tokens = pattern.match(TOKEN) ?? [];
  return tokens.some((t) => t.startsWith('d')) && tokens.some((t) => t.startsWith('M')) && tokens.some((t) => t.startsWith('y')) && tokens.length === 3;
}

/** A day (YYYY-MM-DD) in a Zoho date format: 2026-10-25 in dd-MMM-yyyy is 25-Oct-2026. */
export function formatZohoDate(ymd: string, pattern: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return pattern.replace(TOKEN, (t) => {
    switch (t) {
      case 'yyyy':
        return String(y);
      case 'yy':
        return String(y).slice(2);
      case 'MMM':
        return MONTHS[m - 1];
      case 'MM':
        return pad(m);
      case 'M':
        return String(m);
      case 'dd':
        return pad(d);
      default:
        return String(d);
    }
  });
}

/** A real day as YYYY-MM-DD, or null. */
function dayOf(y: number, m: number, d: number): string | null {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Text in a Zoho date format as YYYY-MM-DD; null when it isn't one. */
export function parseZohoDate(value: string, pattern: string): string | null {
  const order: string[] = [];
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(TOKEN, (t) => {
    order.push(t);
    return t === 'MMM' ? '([A-Za-z]{3,9})' : t === 'yyyy' ? '(\\d{4})' : t === 'yy' ? '(\\d{2})' : '(\\d{1,2})';
  });
  const m = new RegExp(`^${source.replace(/ /g, '\\s*')}$`).exec(value.trim());
  if (!m) return null;
  let y = 0;
  let mo = 0;
  let d = 0;
  order.forEach((t, i) => {
    const v = m[i + 1];
    if (t === 'yyyy') y = Number(v);
    else if (t === 'yy') y = 2000 + Number(v);
    else if (t === 'MMM') mo = MONTH_OF[v.slice(0, 4).toLowerCase()] ?? MONTH_OF[v.slice(0, 3).toLowerCase()] ?? 0;
    else if (t.startsWith('M')) mo = Number(v);
    else d = Number(v);
  });
  return dayOf(y, mo, d);
}

const nearDays = (ymd: string) => [0, -1, 1].map((n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10));

/** The time at the end of Zoho's text: "09:00 AM", "09:00:00", "21:05". */
const TIME_AT_END = /(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*([AaPp])\.?\s*[Mm]\.?)?$/;

/**
 * One of Zoho's times as a moment (ISO, UTC): its text as Zoho gives it ("03-Mar-2023 - 09:00 AM", "2023-03-03
 * 09:00:00", a time alone on the day asked), on the clock of `timeZone` (Zoho's organization's; Cairo's when it doesn't
 * say), to the minute. The day in it is read in the organization's format, else the usual ones, and taken only when it
 * is the day asked or the one before or after it (a night shift's check-out): a day/month order that could be either is
 * read as the one that is. Null for none ("-", empty) or what isn't a time.
 */
export function zohoTimeOf(value: unknown, askedDay: string, opts: { pattern?: string | null; timeZone?: string | null } = {}): string | null {
  const raw = text(value);
  if (!raw) return null;
  const t = TIME_AT_END.exec(raw);
  if (!t) return null;
  let hour = Number(t[1]);
  const minute = Number(t[2]);
  if (t[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (t[3].toLowerCase() === 'p' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  const datePart = raw
    .slice(0, t.index)
    .replace(/[\sT,-]+$/, '')
    .trim();
  let day: string | null = null;
  const near = nearDays(askedDay);
  if (!datePart) day = askedDay;
  else {
    const patterns = [...new Set([...(opts.pattern && isZohoDatePattern(opts.pattern) ? [opts.pattern] : []), ...ZOHO_DATE_PATTERNS, 'MMM dd, yyyy', 'dd MMM yyyy'])];
    const candidates = patterns.map((p) => parseZohoDate(datePart, p)).filter((d): d is string => !!d);
    day = near.find((n) => candidates[0] === n) ?? near.find((n) => candidates.includes(n)) ?? null;
  }
  if (!day) return null;
  const moment = zonedMoment(day, `${pad(hour)}:${pad(minute)}`, opts.timeZone ?? ZOHO_PEOPLE_DEFAULT_TIME_ZONE);
  return Number.isFinite(moment) ? new Date(moment).toISOString() : null;
}

/** Whether a time zone is one the server knows (Zoho's organization's, e.g. Africa/Cairo). */
export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// ---------- the requests ----------

const zohoAuth = (token: string) => ({ authorization: `Zoho-oauthtoken ${token}`, accept: 'application/json' });

/** Who a day is asked for: their work email, else their Zoho employee ID. */
export type ZohoWho = { emailId: string } | { empId: string };

/** One employee's day of attendance entries, `date` in Zoho's date format, that format named as `dateFormat` too. */
export function zohoAttendanceRequest(people: string, token: string, who: ZohoWho, date: string, pattern: string, method: 'GET' | 'POST' = 'GET'): HttpRequest {
  const params = new URLSearchParams({ date: formatZohoDate(date, pattern), dateFormat: pattern, ...who });
  const url = `${people}/people/api/attendance/getAttendanceEntries`;
  if (method === 'POST') return { method: 'POST', url, headers: { ...zohoAuth(token), 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() };
  return { method: 'GET', url: `${url}?${params.toString()}`, headers: zohoAuth(token) };
}

/** Zoho People's organization: its time zone and date format (an admin's). */
export const zohoOrganizationRequest = (people: string, token: string): HttpRequest => ({ method: 'GET', url: `${people}/api/v3/organization`, headers: zohoAuth(token) });

// ---------- what went wrong ----------

/**
 * Why Zoho People refused, as a kind:
 * - lock: past its limit (its lock), or its day's calls used up: wait, then try again;
 * - token: the access token refused: refreshed and tried once more, then the connection needs connecting again;
 * - scope: the sign-in doesn't allow attendance: connect again and allow it;
 * - not_found: Zoho People doesn't know the person; not_permitted: the account may not read theirs;
 * - date_format: the date's format refused (the next one is tried); method: GET refused for POST, or the other way;
 * - busy, unreachable: try again in a moment; refused: anything else, with Zoho's own words.
 */
export type ZohoProblemKind = 'lock' | 'token' | 'scope' | 'not_found' | 'not_permitted' | 'date_format' | 'method' | 'busy' | 'unreachable' | 'refused';

export class ZohoPeopleError extends Error {
  constructor(
    readonly kind: ZohoProblemKind,
    message: string,
    /** Zoho's own error code (digits or letters), for the run's errors and the log. */
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

/** Zoho's error in an answer: its code and words, wherever its shapes keep them; null when the answer isn't one. */
function errorOf(body: unknown): { code: string | null; message: string | null } | null {
  if (!isObject(body)) return null;
  const response = isObject(body.response) ? body.response : null;
  const holders = [response?.errors, body.errors, response && (response.status === 1 || response.status === '1') ? response : null, body.error];
  for (const h of holders) {
    const e = Array.isArray(h) ? h[0] : h;
    if (isObject(e) && (e.code !== undefined || e.message !== undefined || e.error_code !== undefined)) {
      return { code: text(e.code) ?? text(e.error_code), message: text(e.message) ?? text(e.description) };
    }
    if (typeof e === 'string' && e) return { code: e, message: null };
  }
  // { code: 7209, message } at the top, or v3's { code: "NO_PERMISSION", message }
  if ((body.code !== undefined && body.code !== 0 && body.code !== '0') || body.status === 'failure' || body.status === 'error') {
    return { code: text(body.code), message: text(body.message) };
  }
  return null;
}

/** Zoho's words on one line, short, never longer than 160 characters. */
const short = (v: string | null) => (v ? (v.length > 160 ? `${v.slice(0, 159)}…` : v.replace(/\s+/g, ' ')) : null);

/**
 * An answer's refusal as a ZohoPeopleError, or null when it is an answer (with its day in it, or no records). Built from
 * Zoho's codes and words, never from the request (so never a token).
 */
export function zohoProblemOf(answer: HttpAnswer | null): ZohoPeopleError | null {
  if (!answer) return new ZohoPeopleError('unreachable', 'Zoho People couldn’t be reached in time.');
  const e = errorOf(answer.body);
  const status = answer.status;
  if (!e && status >= 200 && status < 300) return null;
  const code = e?.code && /^[A-Za-z0-9_.:-]{1,40}$/.test(e.code) ? e.code : null;
  const words = `${e?.code ?? ''} ${e?.message ?? ''}`;
  const said = short(e?.message ?? null);
  const err = (kind: ZohoProblemKind, message: string) => new ZohoPeopleError(kind, message, code ?? (status >= 400 ? String(status) : null));
  if (status === 429 || /\b7209\b|threshold|access blocked|too many requests|rate limit/i.test(words)) return err('lock', 'Zoho People asked to wait: its limit of calls was reached.');
  if (/\b7024\b|no records? found|no data found/i.test(words)) return null;
  if (status === 401 || /\b7202\b|INVALID_OAUTHTOKEN|invalid oauth ?token|authentication token is invalid|invalid authtoken/i.test(words)) return err('token', 'Zoho People refused the connection’s sign-in.');
  if (/\b7218\b|scope/i.test(words)) return err('scope', 'Zoho People refused: the connection doesn’t allow reading attendance. Connect it again and allow it.');
  if (/\b7048\b|\b7053\b|no such (user|employee)|invalid (user|employee|email)|(user|employee) (does not|doesn't) exist|not an? (active|valid) (user|employee)|employee not found|user not found/i.test(words)) {
    return err('not_found', 'Zoho People doesn’t know this person.');
  }
  if (status === 403 || /\b70(37|40|41)\b|permission denied|no permission|not authori[sz]ed|don.t have permission|NO_PERMISSION/i.test(words)) {
    return err('not_permitted', `Zoho People refused to share it${said ? ` (${said})` : ''}.`);
  }
  if (/\b705[45]\b|date format|invalid date/i.test(words)) return err('date_format', 'Zoho People refused the date’s format.');
  if (/\b72(07|16)\b|wrong method|invoked via (GET|POST)/i.test(words)) return err('method', 'Zoho People refused the request’s method.');
  if (status >= 500 || /\b7200\b|invocation failure|internal (server )?error/i.test(words)) return err('busy', `Zoho People is busy right now${said ? ` (${said})` : ''}.`);
  return err('refused', `Zoho People refused${said ? `: ${said}` : ` the request (${status})`}.`);
}

// ---------- a day read ----------

/** A day as Zoho People gave it, ready for the Zoho import's way: the day, its open last check-in, how many punches. */
export interface ZohoDay {
  day: ImportedDay;
  /** A last check-in without a check-out after it: its moment. */
  openAt: string | null;
  /** The check-ins and check-outs Zoho gave. */
  punches: number;
}

/** What a day's answer was: a day, nothing that day, or an answer the system can't read. */
export type ZohoDayRead = { kind: 'day'; day: ZohoDay } | { kind: 'empty' } | { kind: 'unreadable'; message: string };

/** The day's record in an answer: as the docs show it, or inside { response: { result } } as Zoho's other APIs keep it. */
function recordOf(body: unknown): Record<string, unknown> | null {
  if (!isObject(body)) return null;
  const response = isObject(body.response) ? body.response : null;
  for (const r of [response?.result, body.result, body.data]) {
    const v = Array.isArray(r) ? r[0] : r;
    if (isObject(v)) return v;
  }
  return body;
}

/**
 * A day's answer read (the brief: "Unit tests for mapping Zoho entries to punches (time zones!)"): each entry's
 * check-in and check-out as moments on Zoho's clock (zohoTimeOf), paired as the system pairs presses (pairPresses: the
 * earliest check-in kept while in, the last check-out after it ends its pair), the day's check-in its first check-in and
 * its check-out its last check-out after it, office or remote by the office addresses (placeOf: the first check-in's
 * location, else the last check-out's; never kept), Zoho's status as it says it. No entries but a first check-in and
 * last check-out: one pair. Nothing at all (no punch, no status): empty. A time that can't be read: unreadable, so the day
 * is never kept short of it.
 */
export function zohoDayOf(body: unknown, date: string, opts: { pattern?: string | null; timeZone?: string | null; officeAddresses: readonly string[] }): ZohoDayRead {
  const rec = recordOf(body);
  if (!rec) return { kind: 'empty' };
  const entries = Array.isArray(rec.entries) ? rec.entries.filter(isObject) : [];
  const presses: (PressMoment & { at: string; location: string | null })[] = [];
  let unreadable = 0;
  const add = (kind: 'in' | 'out', value: unknown, location: unknown) => {
    if (!text(value)) return;
    const at = zohoTimeOf(value, date, opts);
    if (!at) unreadable++;
    else presses.push({ kind, at, location: text(location) });
  };
  for (const e of entries) {
    add('in', e.checkIn ?? e.checkin ?? e.check_in, e.checkIn_Location ?? e.checkin_location);
    add('out', e.checkOut ?? e.checkout ?? e.check_out, e.checkOut_Location ?? e.checkout_location);
  }
  if (!entries.length) {
    add('in', rec.firstIn, rec.firstIn_Location);
    add('out', rec.lastOut, rec.lastOut_Location);
  }
  if (unreadable) return { kind: 'unreadable', message: `${unreadable} of Zoho People’s times on ${date} couldn’t be read.` };
  const status = text(rec.status);
  if (!presses.length && !status) return { kind: 'empty' };
  presses.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const ins = presses.filter((p) => p.kind === 'in');
  const firstIn = ins[0] ?? null;
  const outs = presses.filter((p) => p.kind === 'out' && (!firstIn || Date.parse(p.at) > Date.parse(firstIn.at)));
  const lastOut = (firstIn ? outs : presses.filter((p) => p.kind === 'out')).at(-1) ?? null;
  const { pairs, open } = pairPresses(presses);
  const place = placeOf(firstIn?.location ?? text(rec.firstIn_Location), lastOut?.location ?? text(rec.lastOut_Location), opts.officeAddresses);
  return {
    kind: 'day',
    day: {
      day: {
        date,
        checkIn: firstIn?.at ?? null,
        checkOut: lastOut?.at ?? null,
        place: firstIn || lastOut ? place : null,
        zohoStatus: status,
        permissionHours: 0,
        pairs: presses.length ? pressPairsOf(pairs) : null,
      },
      openAt: open === null ? null : new Date(open).toISOString(),
      punches: presses.length,
    },
  };
}

/** Zoho People's organization's time zone and date format (each null when it doesn't say, or says one the system can't use). */
export function zohoOrganizationOf(answer: HttpAnswer | null): { timeZone: string | null; dateFormat: string | null } {
  if (!answer || answer.status !== 200 || !isObject(answer.body)) return { timeZone: null, dateFormat: null };
  const rec = recordOf(answer.body) ?? {};
  const zone = text(rec.TimeZone) ?? text(rec.timeZone) ?? text(rec.time_zone);
  const format = text(rec.DateFormat) ?? text(rec.dateFormat) ?? text(rec.date_format);
  return { timeZone: isTimeZone(zone) ? zone : null, dateFormat: isZohoDatePattern(format) ? format : null };
}

/** The date formats to try, the organization's first, then Zoho's own, then the others. */
export const datePatternsFrom = (known: string | null | undefined): string[] => [...new Set([...(isZohoDatePattern(known) ? [known] : []), ZOHO_PEOPLE_DEFAULT_DATE_FORMAT, ...ZOHO_DATE_PATTERNS])];
