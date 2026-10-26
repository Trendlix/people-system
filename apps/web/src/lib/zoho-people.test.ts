import type { ZohoRunView } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  hiddenText,
  nightlyText,
  noteOf,
  personText,
  runBadge,
  runDaysText,
  runPercent,
  runProgressText,
  runSkippedLines,
  runSummaryText,
  runWaitingText,
  runWhoText,
  seesZohoPeople,
  typedRangeDays,
  yesterdayOf,
  zohoConnectionText,
  zohoFetchBody,
  zohoPeopleBanner,
  zohoPeopleCallbackTarget,
  zohoPersonOptions,
  zohoTestBody,
  zohoWithChosen,
  zohoZoneDiffers,
  zohoZoneText,
} from './zoho-people';

// Zoho People's attendance on the website (owner, 25 October 2026: "Yes, daily + backfill"; then "but can it fetch
// historical data?"): who sees the page, the return from Zoho's sign-in, what Fetch from Zoho sends, and how a run reads.

const when = (iso: string) => `[${iso}]`;
const UUID = '0b1c2d3e-0000-4000-8000-0000000000a1';
const UUID2 = '0b1c2d3e-0000-4000-8000-0000000000a2';

function run(over: Partial<ZohoRunView> = {}): ZohoRunView {
  return {
    id: UUID,
    kind: 'fetch',
    from: '2026-09-01',
    to: '2026-09-30',
    everyone: true,
    chosen: 0,
    status: 'running',
    startedAt: '2026-10-25T10:00:00.000Z',
    finishedAt: null,
    startedBy: { id: 'u1', name: 'Hana HR' },
    cancelRequested: false,
    waitingUntil: null,
    minutesLeft: 20,
    counts: { people: 40, peopleDone: 3, calls: 1200, callsDone: 100, daysAdded: 0, punchesAdded: 0, daysReplaced: 0, daysUnchanged: 0, daysRecorded: 0, linesRefilled: 0 },
    skipped: [],
    notFound: [],
    noWorkEmail: [],
    hidden: 0,
    errors: [],
    problem: null,
    ...over,
  };
}

const form = (values: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
};

describe('who sees Organization → Zoho People', () => {
  it('HR and a Super Admin, never a developer', () => {
    expect(seesZohoPeople({ roles: ['hr'] })).toBe(true);
    expect(seesZohoPeople({ roles: ['super_admin'] })).toBe(true);
    expect(seesZohoPeople({ roles: ['super_admin'], developer: true })).toBe(false);
    expect(seesZohoPeople({ roles: ['hr'], developer: true })).toBe(false);
    for (const r of ['admin', 'ceo', 'finance', 'employee', 'manager'] as const) expect(seesZohoPeople({ roles: [r] })).toBe(false);
  });
});

describe('coming back from Zoho’s sign-in', () => {
  it('says connected, or why not in the system’s own words, and nothing else from the address', () => {
    expect(zohoPeopleBanner({ connected: '1' })?.tone).toBe('ok');
    expect(zohoPeopleBanner({ connected: '1' })?.text).toMatch(/^Zoho People is connected: every night at 02:00/);
    expect(zohoPeopleBanner({ problem: 'refused', said: 'invalid_redirect_uri' })).toEqual({
      tone: 'danger',
      text: 'Zoho refused the return address: add the redirect URI shown on this page to the Zoho app’s Authorized Redirect URIs.',
    });
    expect(zohoPeopleBanner({ problem: 'refused', said: '<script>' })?.text).toBe('Zoho refused the sign-in. Check the app’s settings on this page, then try again.');
    expect(zohoPeopleBanner({ problem: 'made-up' })).toBeNull();
    expect(zohoPeopleBanner({})).toBeNull();
  });

  it('returns the person to the page, connected or with the problem and Zoho’s code', () => {
    expect(zohoPeopleCallbackTarget({ ok: true, problem: null, said: null })).toBe('/organization/zoho-people?connected=1');
    expect(zohoPeopleCallbackTarget({ ok: false, problem: 'denied', said: 'access_denied' })).toBe('/organization/zoho-people?problem=denied&said=access_denied');
    expect(zohoPeopleCallbackTarget(null, 'unreachable')).toBe('/organization/zoho-people?problem=unreachable');
    expect(zohoPeopleCallbackTarget({ ok: false, problem: 'nonsense' as never, said: 'x y' }, 'refused')).toBe('/organization/zoho-people?problem=refused');
  });
});

describe('the connection', () => {
  const c = { status: 'connected' as const, accountEmail: 'hr@trendlix.com', connectedAt: '2026-10-25T08:30:00.000Z', problem: null };
  it('reads connected as whom, needs connecting again with why, or not connected', () => {
    expect(zohoConnectionText(c, when)).toBe('Connected as hr@trendlix.com since [2026-10-25T08:30:00.000Z].');
    expect(zohoConnectionText({ ...c, status: 'needs_reconnecting', problem: 'Zoho refused the sign-in.' }, when)).toBe('Needs connecting again: Zoho refused the sign-in.');
    expect(zohoConnectionText(null, when)).toBe('Not connected.');
  });

  it('says Zoho’s own time zone and date format, and warns when its zone isn’t Cairo’s', () => {
    expect(zohoZoneText({ timeZone: 'Africa/Cairo', dateFormat: 'dd-MMM-yyyy' }, 'Africa/Cairo')).toBe('Zoho People’s time zone: Africa/Cairo · date format: dd-MMM-yyyy.');
    expect(zohoZoneText({ timeZone: null, dateFormat: null }, 'Africa/Cairo')).toBe('Zoho People’s time zone isn’t read yet: its times are read as Africa/Cairo’s · date format not read yet.');
    expect(zohoZoneDiffers({ timeZone: 'Asia/Dubai' }, 'Africa/Cairo')).toBe(true);
    expect(zohoZoneDiffers({ timeZone: 'Africa/Cairo' }, 'Africa/Cairo')).toBe(false);
    expect(zohoZoneDiffers({ timeZone: null }, 'Africa/Cairo')).toBe(false);
  });

  it('tests with a colleague’s work email written in full, or the account’s own', () => {
    expect(zohoTestBody(form({ email: '' }))).toEqual({ body: { email: null }, errors: [] });
    expect(zohoTestBody(form({ email: ' Sara@Trendlix.com ' }))).toEqual({ body: { email: 'sara@trendlix.com' }, errors: [] });
    expect(zohoTestBody(form({ email: 'sara' })).body).toBeNull();
  });
});

describe('Fetch from Zoho', () => {
  const today = '2026-10-25';

  it('sends the days typed, everyone or the people chosen', () => {
    expect(yesterdayOf(today)).toBe('2026-10-24');
    expect(yesterdayOf('2026-03-01')).toBe('2026-02-28');
    expect(zohoFetchBody(form({ from: '01/09/2026', to: '30/09/2026', who: 'everyone' }), today)).toEqual({ body: { from: '2026-09-01', to: '2026-09-30', employeeIds: [] }, errors: [] });
    expect(zohoFetchBody(form({ from: '01/09/2026', to: '30/09/2026', who: 'chosen', employeeId: [UUID, UUID, UUID2, 'nope'] }), today).body).toEqual({ from: '2026-09-01', to: '2026-09-30', employeeIds: [UUID, UUID2] });
  });

  it('refuses a day that isn’t one, the wrong way round, today, more than 12 months, or nobody chosen', () => {
    expect(zohoFetchBody(form({ from: '', to: '30/09/2026' }), today).errors).toEqual(['Enter the first and the last day as DD/MM/YYYY, e.g. 01/09/2026.']);
    expect(zohoFetchBody(form({ from: '30/09/2026', to: '01/09/2026' }), today).errors).toContain('The first day must be on or before the last day.');
    expect(zohoFetchBody(form({ from: '01/10/2026', to: '25/10/2026' }), today).errors).toContain('Fetch up to yesterday: today’s check-ins are fetched tonight.');
    expect(zohoFetchBody(form({ from: '01/09/2025', to: '01/09/2026' }), today).errors).toEqual(['Fetch 12 months at most at a time: up to 31/08/2026 from 01/09/2025.']);
    expect(zohoFetchBody(form({ from: '01/09/2025', to: '31/08/2026' }), today).errors).toEqual([]);
    expect(zohoFetchBody(form({ from: '01/09/2026', to: '30/09/2026', who: 'chosen' }), today).errors).toEqual(['Choose the people to fetch, or fetch everyone.']);
  });

  it('offers the people not chosen yet, the former ones marked, each chosen once', () => {
    const people = [
      { id: UUID, name: 'Sara Planner', employeeCode: 'EMP-7', former: false },
      { id: UUID2, name: 'Adam Former', employeeCode: 'EMP-2', former: true },
    ];
    expect(zohoPersonOptions(people, [])).toEqual([
      { value: UUID2, label: 'Adam Former · EMP-2 · former' },
      { value: UUID, label: 'Sara Planner · EMP-7' },
    ]);
    expect(zohoPersonOptions(people, [UUID2]).map((o) => o.value)).toEqual([UUID]);
    expect(zohoWithChosen([UUID], UUID)).toEqual([UUID]);
    expect(zohoWithChosen([UUID], '')).toEqual([UUID]);
    expect(zohoWithChosen([UUID], UUID2)).toEqual([UUID, UUID2]);
  });

  it('counts the days of a range typed, none while it isn’t one', () => {
    expect(typedRangeDays('2026-09-01', '2026-09-30')).toBe(30);
    expect(typedRangeDays('2025-10-25', '2026-10-24')).toBe(365);
    expect(typedRangeDays('2026-09-30', '2026-09-01')).toBeNull();
    expect(typedRangeDays(null, '2026-09-01')).toBeNull();
    expect(typedRangeDays('2024-01-01', '2026-01-01')).toBeNull();
  });
});

describe('a run', () => {
  it('reads its progress, its days and whose', () => {
    expect(runPercent(run())).toBe(8);
    expect(runPercent(run({ counts: { ...run().counts, calls: 0, callsDone: 0 } }))).toBe(0);
    expect(runPercent(run({ status: 'finished', counts: { ...run().counts, calls: 0, callsDone: 0 } }))).toBe(100);
    expect(runProgressText(run())).toBe('Fetching: 100 of 1,200 calls (8%), 3 of 40 people');
    expect(runDaysText(run())).toBe('01/09/2026 – 30/09/2026');
    expect(runDaysText(run({ from: '2026-10-24', to: '2026-10-24' }))).toBe('24/10/2026');
    expect(runWhoText(run())).toBe('Everyone');
    expect(runWhoText(run({ everyone: false, chosen: 1 }))).toBe('1 person chosen');
    expect(runWaitingText(run(), when)).toBeNull();
    expect(runWaitingText(run({ waitingUntil: '2026-10-25T12:20:00.000Z' }), when)).toBe('Zoho asked to wait: going on at [2026-10-25T12:20:00.000Z].');
  });

  it('says what it did, its counts that aren’t none, the approved months’ days for the record', () => {
    expect(runSummaryText(run())).toBeNull();
    expect(
      runSummaryText(run({ counts: { ...run().counts, daysAdded: 12, punchesAdded: 34, daysReplaced: 2, daysUnchanged: 40, daysRecorded: 3, linesRefilled: 1 } })),
    ).toBe('12 days added (34 check-ins and check-outs), 2 days replaced as Zoho changed them, 40 days unchanged, 3 days added for the record, payroll unchanged, 1 draft payroll line refilled');
    expect(
      runSkippedLines(
        run({
          skipped: [
            { reason: 'payroll_approved', days: 4 },
            { reason: 'before_join', days: 1 },
            { reason: 'not_found', days: 0 },
          ],
        }),
      ),
    ).toEqual(['Payroll approved: the day kept as it was: 4 days', 'Before their join date: 1 day']);
  });

  it('says a finished run with days unread or refused as finished with problems (owner, 26 October 2026)', () => {
    expect(runBadge(run({ status: 'finished', skipped: [{ reason: 'unreadable', days: 1087 }] }))).toEqual({ label: 'Finished with problems', className: 'bg-warn-soft text-warn' });
    expect(runBadge(run({ status: 'finished', skipped: [{ reason: 'not_permitted', days: 3 }] })).label).toBe('Finished with problems');
    expect(runBadge(run({ status: 'finished', skipped: [{ reason: 'before_join', days: 196 }, { reason: 'unreadable', days: 0 }] }))).toEqual({ label: 'Finished', className: 'bg-ok-soft text-ok' });
    expect(runBadge(run({ status: 'failed', skipped: [{ reason: 'unreadable', days: 2 }] }))).toEqual({ label: 'Failed', className: 'bg-danger-soft text-danger' });
    expect(runBadge(run()).label).toBe('Fetching');
  });

  it('lists a person, the C-level people hidden from HR as a count', () => {
    expect(personText({ employeeId: UUID, name: 'Adam Former', employeeCode: 'EMP-2', email: 'adam@trendlix.com', former: true })).toBe('Adam Former (EMP-2) · adam@trendlix.com · former employee');
    expect(personText({ employeeId: UUID, name: 'Sara', employeeCode: 'EMP-7', email: null, former: false })).toBe('Sara (EMP-7)');
    expect(hiddenText(0)).toBeNull();
    expect(hiddenText(2)).toBe('and 2 C-level people only the CEO and a Super Admin see');
  });

  it('says when the nightly run runs and how the last one went', () => {
    expect(nightlyText({ time: '02:00', last: null })).toBe('Every night at 02:00 (Cairo), yesterday’s check-ins and check-outs are fetched for everyone. It hasn’t run yet.');
    expect(nightlyText({ time: '02:00', last: { day: '2026-10-24', status: 'finished', finishedAt: '2026-10-25T00:05:00.000Z', problem: null } })).toBe(
      'Every night at 02:00 (Cairo), yesterday’s check-ins and check-outs are fetched for everyone. The last one, for 24/10/2026, finished.',
    );
    expect(nightlyText({ time: '02:00', last: { day: '2026-10-24', status: 'failed', finishedAt: null, problem: 'Zoho People refused the connection’s sign-in.' } })).toBe(
      'Every night at 02:00 (Cairo), yesterday’s check-ins and check-outs are fetched for everyone. The last one, for 24/10/2026, failed: Zoho People refused the connection’s sign-in.',
    );
  });
});

describe('the dashboard’s note', () => {
  it('takes the API’s note, and nothing else', () => {
    expect(noteOf({ tone: 'danger', text: 'Last night’s fetch from Zoho People failed.' })).toEqual({ tone: 'danger', text: 'Last night’s fetch from Zoho People failed.' });
    expect(noteOf(null)).toBeNull();
    expect(noteOf({ tone: 'ok', text: 'x' })).toBeNull();
    expect(noteOf({ tone: 'warn', text: '  ' })).toBeNull();
    expect(noteOf('text')).toBeNull();
  });
});
