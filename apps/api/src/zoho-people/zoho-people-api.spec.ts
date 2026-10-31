import { attendanceMonth, OFFICE_ADDRESS_DEFAULTS, ZOHO_PEOPLE_SCOPES, zohoEstimateText, zohoFetchProblems, zohoRangeEnd, type ImportedDay } from '@trendlix/shared';
import {
  datePatternsFrom,
  formatZohoDate,
  isZohoDateOnly,
  isZohoDatePattern,
  parseZohoDate,
  zohoAttendanceRequest,
  zohoDayOf,
  zohoOrganizationOf,
  zohoPeopleAuthorizeUrl,
  zohoPeopleHost,
  zohoProblemOf,
  zohoSentText,
  zohoTimeOf,
} from './zoho-people-api.js';
import { openZohoPeopleSecret, sameZohoPeopleKey, sealZohoPeopleSecret, zohoPeopleKeyIdOf, zohoPeopleKeyOf } from './zoho-people-secret.js';

// Zoho People's answers as the system reads them (owner, 25 October 2026: "can i fetch checkin and out transactions from
// zoho people through api?"; the brief: "Unit tests for mapping Zoho entries to punches (time zones! Zoho gives
// org-local times; confirm they're Cairo and convert correctly)"). Cairo is UTC+2, and UTC+3 in summer time (2026: 24
// April to 29 October). The answers are Zoho's documented sample's shape (www.zoho.com/people/api/attendance-entries.html).

const OFFICES = OFFICE_ADDRESS_DEFAULTS;
const read = (body: unknown, date: string, opts: { pattern?: string | null; timeZone?: string | null } = {}) => zohoDayOf(body, date, { ...opts, officeAddresses: OFFICES });

describe('Zoho People: its times on Cairo’s clock', () => {
  it('reads the entries’ "03-Mar-2023 - 09:00 AM" in winter as UTC+2', () => {
    expect(zohoTimeOf('15-Jan-2026 - 09:00 AM', '2026-01-15')).toBe('2026-01-15T07:00:00.000Z');
    expect(zohoTimeOf('15-Jan-2026 - 06:30 PM', '2026-01-15')).toBe('2026-01-15T16:30:00.000Z');
  });

  it('reads summer time as UTC+3, its first and last days too', () => {
    expect(zohoTimeOf('15-Jul-2026 - 09:00 AM', '2026-07-15')).toBe('2026-07-15T06:00:00.000Z');
    expect(zohoTimeOf('23-Apr-2026 - 09:00 AM', '2026-04-23')).toBe('2026-04-23T07:00:00.000Z');
    expect(zohoTimeOf('24-Apr-2026 - 09:00 AM', '2026-04-24')).toBe('2026-04-24T06:00:00.000Z');
    expect(zohoTimeOf('29-Oct-2026 - 09:00 AM', '2026-10-29')).toBe('2026-10-29T06:00:00.000Z');
    expect(zohoTimeOf('30-Oct-2026 - 09:00 AM', '2026-10-30')).toBe('2026-10-30T07:00:00.000Z');
  });

  it('reads firstIn’s "2023-03-03 09:00:00", a 24-hour clock, and a time alone on the day asked', () => {
    expect(zohoTimeOf('2026-03-03 09:00:00', '2026-03-03')).toBe('2026-03-03T07:00:00.000Z');
    expect(zohoTimeOf('03-Mar-2026 21:05', '2026-03-03')).toBe('2026-03-03T19:05:00.000Z');
    expect(zohoTimeOf('09:15 AM', '2026-03-03')).toBe('2026-03-03T07:15:00.000Z');
    expect(zohoTimeOf('12:00 AM', '2026-03-03')).toBe('2026-03-02T22:00:00.000Z');
    expect(zohoTimeOf('12:30 PM', '2026-03-03')).toBe('2026-03-03T10:30:00.000Z');
  });

  it('reads another zone when Zoho’s organization says one', () => {
    expect(zohoTimeOf('03-Mar-2026 - 09:00 AM', '2026-03-03', { timeZone: 'Asia/Kolkata' })).toBe('2026-03-03T03:30:00.000Z');
    expect(zohoTimeOf('03-Mar-2026 - 09:00 AM', '2026-03-03', { timeZone: 'UTC' })).toBe('2026-03-03T09:00:00.000Z');
  });

  it('reads 04/03/2026 as the day asked, whichever order it is in, and takes a night shift’s check-out on the next day', () => {
    expect(zohoTimeOf('04/03/2026 09:00', '2026-03-04')).toBe('2026-03-04T07:00:00.000Z');
    expect(zohoTimeOf('04/03/2026 09:00', '2026-04-03')).toBe('2026-04-03T07:00:00.000Z');
    expect(zohoTimeOf('04/03/2026 09:00', '2026-04-03', { pattern: 'dd/MM/yyyy' })).toBe('2026-04-03T07:00:00.000Z');
    expect(zohoTimeOf('05-Mar-2026 - 02:00 AM', '2026-03-04')).toBe('2026-03-05T00:00:00.000Z');
  });

  it('reads the organization’s own format, e.g. dd.MM.yyyy', () => {
    expect(zohoTimeOf('03.03.2026 09:00', '2026-03-03', { pattern: 'dd.MM.yyyy' })).toBe('2026-03-03T07:00:00.000Z');
  });

  it('refuses none, "-", a day far from the one asked, and what isn’t a time', () => {
    expect(zohoTimeOf('-', '2026-03-03')).toBeNull();
    expect(zohoTimeOf('', '2026-03-03')).toBeNull();
    expect(zohoTimeOf(null, '2026-03-03')).toBeNull();
    expect(zohoTimeOf('10-Mar-2026 - 09:00 AM', '2026-03-03')).toBeNull();
    expect(zohoTimeOf('13:00 PM', '2026-03-03')).toBeNull();
    expect(zohoTimeOf('soon', '2026-03-03')).toBeNull();
  });
});

describe('Zoho People: its date formats', () => {
  it('writes a day in the organization’s format, sent as the date and named as its format', () => {
    expect(formatZohoDate('2026-10-05', 'dd-MMM-yyyy')).toBe('05-Oct-2026');
    expect(formatZohoDate('2026-10-05', 'yyyy-MM-dd')).toBe('2026-10-05');
    expect(formatZohoDate('2026-10-05', 'dd.MM.yyyy')).toBe('05.10.2026');
    expect(formatZohoDate('2026-10-05', 'MM/dd/yyyy')).toBe('10/05/2026');
    expect(parseZohoDate('05-Oct-2026', 'dd-MMM-yyyy')).toBe('2026-10-05');
    expect(parseZohoDate('31-Feb-2026', 'dd-MMM-yyyy')).toBeNull();
  });

  it('takes only day, month and year patterns, the organization’s first among those tried', () => {
    expect(isZohoDatePattern('dd-MMM-yyyy')).toBe(true);
    expect(isZohoDatePattern('dd.MM.yyyy')).toBe(true);
    expect(isZohoDatePattern('HH:mm')).toBe(false);
    expect(isZohoDatePattern("dd'x'MM")).toBe(false);
    expect(datePatternsFrom('dd.MM.yyyy')[0]).toBe('dd.MM.yyyy');
    expect(datePatternsFrom(null)[0]).toBe('dd-MMM-yyyy');
    expect(new Set(datePatternsFrom('dd-MMM-yyyy')).size).toBe(datePatternsFrom('dd-MMM-yyyy').length);
  });
});

describe('Zoho People: a day’s entries as the import’s day', () => {
  // the docs' sample, moved to a Cairo winter day, one entry at the office
  const sample = {
    firstIn: '2026-03-03 09:00:00',
    totalHrs: '10:00',
    entries: [
      { checkIn_Building: '-', checkIn: '03-Mar-2026 - 09:00 AM', checkOut_Location: '15, Al Doctor Al Mahrouqi Street, Cairo', checkOut_Building: '-', sourceOfPunchOut: 'Web', checkIn_Location: '15, Al Doctor Al Mahrouqi Street, Cairo', checkOut: '03-Mar-2026 - 01:00 PM', sourceOfPunchIn: 'Web' },
      { checkIn_Building: '-', checkIn: '03-Mar-2026 - 02:00 PM', checkOut_Location: 'Delhi', checkOut_Building: '-', sourceOfPunchOut: 'Mobile', checkIn_Location: 'Delhi', checkOut: '03-Mar-2026 - 06:00 PM', sourceOfPunchIn: 'Mobile' },
    ],
    firstIn_Location: '15, Al Doctor Al Mahrouqi Street, Cairo',
    lastOut_Location: 'Delhi',
    lastOut: '2026-03-03 18:00:00',
    unPaidBreak: '00:00',
    allowedToCheckIn: true,
    paidBreak: '00:00',
    status: 'Present',
  };

  it('keeps each check-in → check-out pair, the first check-in and the last check-out, office by the first check-in', () => {
    const r = read(sample, '2026-03-03');
    expect(r.kind).toBe('day');
    if (r.kind !== 'day') return;
    expect(r.day.day).toEqual({
      date: '2026-03-03',
      checkIn: '2026-03-03T07:00:00.000Z',
      checkOut: '2026-03-03T16:00:00.000Z',
      place: 'office',
      zohoStatus: 'Present',
      permissionHours: 0,
      pairs: [
        { in: '2026-03-03T07:00:00.000Z', out: '2026-03-03T11:00:00.000Z' },
        { in: '2026-03-03T12:00:00.000Z', out: '2026-03-03T16:00:00.000Z' },
      ],
    });
    expect(r.day.openAt).toBeNull();
    expect(r.day.punches).toBe(4);
    // never the address
    expect(JSON.stringify(r.day)).not.toMatch(/Mahrouqi|Delhi/);
  });

  it('reads a check-in elsewhere as remote, and a last check-in without a check-out as open', () => {
    const r = read({ status: 'Present', entries: [{ checkIn: '03-Mar-2026 - 09:00 AM', checkIn_Location: 'Maadi', checkOut: '03-Mar-2026 - 01:00 PM' }, { checkIn: '03-Mar-2026 - 02:00 PM', checkOut: '-' }] }, '2026-03-03');
    if (r.kind !== 'day') throw new Error(r.kind);
    expect(r.day.day.place).toBe('remote');
    expect(r.day.day.pairs).toEqual([{ in: '2026-03-03T07:00:00.000Z', out: '2026-03-03T11:00:00.000Z' }]);
    expect(r.day.openAt).toBe('2026-03-03T12:00:00.000Z');
    expect(r.day.day.checkOut).toBe('2026-03-03T11:00:00.000Z');
  });

  it('reads an answer kept inside { response: { result } }, and a day with no entries but its first and last', () => {
    const wrapped = read({ response: { result: [{ ...sample, entries: [sample.entries[0]] }], message: 'Success', status: 0 } }, '2026-03-03');
    expect(wrapped.kind === 'day' && wrapped.day.punches).toBe(2);
    const plain = read({ firstIn: '2026-03-03 09:00:00', lastOut: '2026-03-03 17:30:00', status: 'Present' }, '2026-03-03');
    if (plain.kind !== 'day') throw new Error(plain.kind);
    expect(plain.day.day.pairs).toEqual([{ in: '2026-03-03T07:00:00.000Z', out: '2026-03-03T15:30:00.000Z' }]);
  });

  it('keeps a day with Zoho’s status and no punch (absent, a weekend, leave), and nothing at all as empty', () => {
    const absent = read({ status: 'Absent', entries: [] }, '2026-03-03');
    if (absent.kind !== 'day') throw new Error(absent.kind);
    expect(absent.day.day).toMatchObject({ checkIn: null, checkOut: null, zohoStatus: 'Absent', pairs: null, place: null });
    expect(read({ entries: [], status: '' }, '2026-03-03').kind).toBe('empty');
    expect(read({}, '2026-03-03').kind).toBe('empty');
    expect(read(null, '2026-03-03').kind).toBe('empty');
  });

  it('never keeps a day short of a time it couldn’t read', () => {
    expect(read({ status: 'Present', entries: [{ checkIn: '03-Mar-2026 - 9 o’clock', checkOut: '03-Mar-2026 - 01:00 PM' }] }, '2026-03-03').kind).toBe('unreadable');
  });

  it('says what Zoho sent that couldn’t be read, the first of them, never a place (owner, 26 October 2026)', () => {
    const r = read({ status: 'Present', entries: [{ checkIn: '03-Mar-2026 - 9 o’clock', checkIn_Location: 'Office', checkOut: 'whenever' }] }, '2026-03-03');
    expect(r).toEqual({ kind: 'unreadable', message: '2 of Zoho People’s times on 2026-03-03 couldn’t be read: Zoho sent “03-Mar-2026 - 9 o[U+2019]clock”.' });
    // an unusual space or mark shown by its code, a long text cut, on one line
    expect(zohoSentText('25-Oct-2026 - 09:05\u202fAM')).toBe('25-Oct-2026 - 09:05[U+202F]AM');
    expect(zohoSentText('1761375900000')).toBe('1761375900000');
    expect(zohoSentText('a\nb')).toBe('a b');
    expect(zohoSentText('x'.repeat(80))).toBe(`${'x'.repeat(59)}…`);
  });

  it('tells a colleague’s time sent as the day alone, its hour gone (owner, 26 October 2026: Zoho sent “26-Oct-2026”)', () => {
    expect(isZohoDateOnly('26-Oct-2026', '2026-10-26', 'dd-MMM-yyyy')).toBe(true);
    expect(isZohoDateOnly('2026-10-26', '2026-10-26')).toBe(true);
    expect(isZohoDateOnly('27-Oct-2026 -', '2026-10-26', 'dd-MMM-yyyy')).toBe(true);
    expect(isZohoDateOnly('26-Oct-2026 - 09:55 AM', '2026-10-26', 'dd-MMM-yyyy')).toBe(false);
    expect(isZohoDateOnly('26-Oct-2025', '2026-10-26', 'dd-MMM-yyyy')).toBe(false);
    expect(isZohoDateOnly('whenever', '2026-10-26')).toBe(false);
  });

  it('reads the day’s first check-in and last check-out when the entries came without their hour, said as such', () => {
    const body = { firstIn: '2026-10-26 09:55:00', lastOut: '2026-10-26 18:10:00', status: 'Present', entries: [{ checkIn: '26-Oct-2026', checkOut: '26-Oct-2026', checkIn_Location: 'Trendlix' }, { checkIn: '26-Oct-2026', checkOut: '26-Oct-2026' }] };
    const r = read(body, '2026-10-26', { pattern: 'dd-MMM-yyyy' });
    if (r.kind !== 'unreadable') throw new Error(r.kind);
    expect(r.message).toBe('4 of Zoho People’s times on 2026-10-26 couldn’t be read: Zoho sent “26-Oct-2026”, a date without its time.');
    expect(r.dateOnly).toBe(true);
    expect(r.firstLast?.day).toMatchObject({ date: '2026-10-26', checkIn: '2026-10-26T06:55:00.000Z', checkOut: '2026-10-26T15:10:00.000Z', zohoStatus: 'Present' });
    expect(r.firstLast?.day.pairs).toHaveLength(1);
    expect(r.firstLast?.punches).toBe(2);
    // still in: the first check-in alone, open
    const open = read({ firstIn: '2026-10-26 09:55:00', lastOut: '-', status: 'Present', entries: [{ checkIn: '26-Oct-2026', checkOut: '' }] }, '2026-10-26', { pattern: 'dd-MMM-yyyy' });
    if (open.kind !== 'unreadable') throw new Error(open.kind);
    expect(open.firstLast).toMatchObject({ openAt: '2026-10-26T06:55:00.000Z', punches: 1, day: { checkIn: '2026-10-26T06:55:00.000Z', checkOut: null } });
    // its first check-in without its hour too: nothing to fall back on
    const none = read({ firstIn: '26-Oct-2026', lastOut: '26-Oct-2026', entries: [{ checkIn: '26-Oct-2026', checkOut: '26-Oct-2026' }] }, '2026-10-26', { pattern: 'dd-MMM-yyyy' });
    expect(none).toMatchObject({ kind: 'unreadable', dateOnly: true, firstLast: null });
    // a time that isn't a date alone: unreadable, nothing to fall back on
    expect(read({ firstIn: '2026-10-26 09:55:00', entries: [{ checkIn: 'whenever' }] }, '2026-10-26')).toEqual({ kind: 'unreadable', message: '1 of Zoho People’s times on 2026-10-26 couldn’t be read: Zoho sent “whenever”.' });
  });

  it('counts its pairs by the shift from the first check-in to the last check-out, the break included (the import’s rules)', () => {
    const r = read(sample, '2026-03-03');
    if (r.kind !== 'day') throw new Error(r.kind);
    const shift = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4] };
    const base = { month: '2026-03', shift, holidays: [], leaveDays: [], employedFrom: '2026-01-01', employedTo: null, systemPermissionHours: 0, permissionHoursPerMonth: 4 };
    const byPairs = attendanceMonth({ ...base, days: [r.day.day] });
    // 9:00 to 1:00 PM and 2:00 to 6:00 PM: 9 hours, the break included (owner, 31 October 2026: "9:00, break included")
    expect(byPairs.days[0]).toMatchObject({ status: 'worked', hoursCounted: 9 });
    // the Excel export's day (no pairs): first to last, at most the shift's 9 hours, as before
    const { pairs: _pairs, ...firstLast } = r.day.day;
    expect(attendanceMonth({ ...base, days: [firstLast as ImportedDay] }).days[0]).toMatchObject({ hoursCounted: 9 });
    // an open check-in alone: worked, no hours
    expect(attendanceMonth({ ...base, days: [{ ...r.day.day, checkOut: null, pairs: [] }] }).days[0]).toMatchObject({ status: 'worked', hoursCounted: 0 });
  });
});

describe('Zoho People: its refusals', () => {
  const answer = (status: number, body: unknown) => ({ status, body });

  it('tells its lock (7209, 429) to wait', () => {
    expect(zohoProblemOf(answer(200, { response: { errors: { code: 7209, message: 'API access blocked since threshold limit exceeded. Please try after some time' }, status: 1 } }))?.kind).toBe('lock');
    expect(zohoProblemOf(answer(429, null))?.kind).toBe('lock');
  });

  it('tells a refused token, someone unknown, a refusal to share, a date or method refused, and Zoho busy', () => {
    expect(zohoProblemOf(answer(200, { response: { message: 'Error occurred', errors: { code: 7202, message: 'Provided authentication token is invalid.' }, status: 1 } }))?.kind).toBe('token');
    expect(zohoProblemOf(answer(401, { code: 'INVALID_OAUTHTOKEN' }))?.kind).toBe('token');
    expect(zohoProblemOf(answer(200, { response: { errors: { code: 7048, message: 'Invalid user / No such user found' }, status: 1 } }))?.kind).toBe('not_found');
    expect(zohoProblemOf(answer(200, { response: { errors: { code: 7040, message: 'Permission denied to view records' }, status: 1 } }))?.kind).toBe('not_permitted');
    expect(zohoProblemOf(answer(403, { code: 'NO_PERMISSION', message: 'You don’t have permission to perform this operation as you are not an Admin.' }))?.kind).toBe('not_permitted');
    expect(zohoProblemOf(answer(200, { errors: { code: 7055, message: 'Invalid date format' } }))?.kind).toBe('date_format');
    expect(zohoProblemOf(answer(200, { errors: { code: 7216, message: 'This URL can be invoked via POST method only' } }))?.kind).toBe('method');
    expect(zohoProblemOf(answer(502, null))?.kind).toBe('busy');
    expect(zohoProblemOf(null)?.kind).toBe('unreachable');
    expect(zohoProblemOf(answer(200, { response: { errors: { code: 7218, message: 'Invalid OAuthScope' }, status: 1 } }))?.kind).toBe('scope');
  });

  it('reads no records (7024) and a day as answers, not refusals, and never says a token', () => {
    expect(zohoProblemOf(answer(200, { response: { errors: { code: 7024, message: 'No records found' }, status: 1 } }))).toBeNull();
    expect(zohoProblemOf(answer(200, { status: 'Present', entries: [] }))).toBeNull();
    expect(zohoProblemOf(answer(400, { response: { errors: { code: 7203, message: 'Invalid extra parameters found' } } }))?.message).toBe('Zoho People refused: Invalid extra parameters found.');
  });
});

describe('Zoho People: the requests and the sign-in', () => {
  it('asks one employee’s day by work email, the date in Zoho’s format and that format named', () => {
    const req = zohoAttendanceRequest('https://people.zoho.com', 'tok-1', { emailId: 'sara@trendlix.com' }, '2026-10-05', 'dd-MMM-yyyy');
    expect(req.method).toBe('GET');
    const url = new URL(req.url);
    expect(url.origin + url.pathname).toBe('https://people.zoho.com/people/api/attendance/getAttendanceEntries');
    expect(Object.fromEntries(url.searchParams)).toEqual({ date: '05-Oct-2026', dateFormat: 'dd-MMM-yyyy', emailId: 'sara@trendlix.com' });
    expect(req.headers.authorization).toBe('Zoho-oauthtoken tok-1');
    const post = zohoAttendanceRequest('https://people.zoho.com', 'tok-1', { empId: 'TRX-7' }, '2026-10-05', 'yyyy-MM-dd', 'POST');
    expect(post.url).not.toContain('?');
    expect(Object.fromEntries(new URLSearchParams(post.body))).toEqual({ date: '2026-10-05', dateFormat: 'yyyy-MM-dd', empId: 'TRX-7' });
  });

  it('asks the other ways when the times come without their hour: no format named, or the format with a time', () => {
    const params = (mode: 'named' | 'unnamed' | 'timed') => Object.fromEntries(new URL(zohoAttendanceRequest('https://people.zoho.com', 't', { emailId: 'sara@trendlix.com' }, '2026-10-26', 'dd-MMM-yyyy', 'GET', mode).url).searchParams);
    expect(params('named')).toEqual({ date: '26-Oct-2026', dateFormat: 'dd-MMM-yyyy', emailId: 'sara@trendlix.com' });
    expect(params('unnamed')).toEqual({ date: '26-Oct-2026', emailId: 'sara@trendlix.com' });
    expect(params('timed')).toEqual({ date: '26-Oct-2026 00:00', dateFormat: 'dd-MMM-yyyy HH:mm', emailId: 'sara@trendlix.com' });
  });

  it('calls People at the sign-in’s data centre', () => {
    expect(zohoPeopleHost('https://accounts.zoho.com')).toBe('https://people.zoho.com');
    expect(zohoPeopleHost('https://accounts.zoho.eu')).toBe('https://people.zoho.eu');
    expect(zohoPeopleHost('https://accounts.zoho.com.au')).toBe('https://people.zoho.com.au');
    expect(zohoPeopleHost('https://accounts.zohocloud.ca')).toBe('https://people.zohocloud.ca');
    expect(zohoPeopleHost('https://accounts.zoho.sa')).toBe('https://people.zoho.sa');
  });

  it('asks Zoho People’s scopes, offline, with consent and PKCE', () => {
    const url = new URL(zohoPeopleAuthorizeUrl({ clientId: '1000.ABC' }, { redirectUri: 'https://people.trendlix.com/zoho-people/oauth', state: 's', challenge: 'c', accounts: 'https://accounts.zoho.eu' }));
    expect(url.origin).toBe('https://accounts.zoho.eu');
    expect(url.searchParams.get('scope')).toBe(ZOHO_PEOPLE_SCOPES.join(','));
    expect(url.searchParams.get('scope')).toBe('ZOHOPEOPLE.attendance.READ,ZOHOPEOPLE.organization.READ,email');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://people.trendlix.com/zoho-people/oauth');
  });

  it('reads the organization’s time zone and date format, leaving out what the system can’t use', () => {
    expect(zohoOrganizationOf({ status: 200, body: { TimeFormat: 'hh:mm a', TimeZone: 'Africa/Cairo', DateFormat: 'dd-MMM-yyyy' } })).toEqual({ timeZone: 'Africa/Cairo', dateFormat: 'dd-MMM-yyyy' });
    expect(zohoOrganizationOf({ status: 200, body: { TimeZone: 'Mars/Olympus', DateFormat: 'EEE' } })).toEqual({ timeZone: null, dateFormat: null });
    expect(zohoOrganizationOf({ status: 403, body: { code: 'NO_PERMISSION' } })).toEqual({ timeZone: null, dateFormat: null });
  });
});

describe('Zoho People: a range and how long it takes', () => {
  it('takes 12 months at most, up to yesterday, the first day on or before the last', () => {
    expect(zohoRangeEnd('2025-11-01')).toBe('2026-10-31');
    expect(zohoRangeEnd('2025-10-26')).toBe('2026-10-25');
    expect(zohoFetchProblems({ from: '2025-11-01', to: '2026-10-24' }, '2026-10-25')).toEqual([]);
    expect(zohoFetchProblems({ from: '2025-10-01', to: '2026-10-24' }, '2026-10-25')).toEqual(['Fetch 12 months at most at a time: up to 2026-09-30 from 2025-10-01.']);
    expect(zohoFetchProblems({ from: '2026-10-01', to: '2026-10-25' }, '2026-10-25')).toEqual(['Fetch up to yesterday: today’s check-ins are fetched tonight.']);
    expect(zohoFetchProblems({ from: '2026-10-10', to: '2026-10-01' }, '2026-10-25')).toEqual(['The first day must be on or before the last day.']);
    expect(zohoFetchProblems({ from: '2026-02-30', to: '2026-03-01' }, '2026-10-25')).toEqual(['Choose the first and the last day to fetch.']);
  });

  it('says how long: a year for 40 people is about 4 hours at 60 calls a minute', () => {
    expect(zohoEstimateText(40, 365)).toBe('40 people × 365 days = 14,600 calls to Zoho: about 4 h 4 min');
    expect(zohoEstimateText(2, 1)).toBe('2 people × 1 day = 2 calls to Zoho: under a minute');
  });
});

describe('Zoho People: its sealed token', () => {
  const key = zohoPeopleKeyOf('a-jwt-secret-for-tests');

  it('opens only with its own key and purpose', () => {
    const sealed = sealZohoPeopleSecret('1000.refresh.token', key, 'refresh_token');
    expect(sealed).not.toContain('1000.refresh.token');
    expect(openZohoPeopleSecret(sealed, key, 'refresh_token')).toBe('1000.refresh.token');
    expect(openZohoPeopleSecret(sealed, key, 'oauth_state')).toBeNull();
    expect(openZohoPeopleSecret(sealed, zohoPeopleKeyOf('another-secret'), 'refresh_token')).toBeNull();
    expect(sameZohoPeopleKey(zohoPeopleKeyIdOf(key), key)).toBe(true);
    expect(sameZohoPeopleKey(zohoPeopleKeyIdOf(zohoPeopleKeyOf('another-secret')), key)).toBe(false);
  });
});
