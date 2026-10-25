import { describe, expect, it } from 'vitest';
import type { CoverageDay, CoverageOff } from '@trendlix/shared';
import {
  atWorkText,
  busyDays,
  clashText,
  coverGroups,
  coveringText,
  coversText,
  dayRange,
  elsewhereLines,
  namesText,
  offLines,
  overLimitText,
  placeText,
  shortDay,
  standInText,
  standInValue,
} from './coverage';

// Who else is off (owner, 25 October 2026: "Names, no leave types", "Warn and need HR", "Required over 2 days"): the
// coverage of a request's days in words.

const omar: CoverageOff = { id: 'o', fullNameEn: 'Omar', waiting: false, halfDay: false, type: 'Annual leave' };
const sara: CoverageOff = { id: 's', fullNameEn: 'Sara', waiting: false, halfDay: false, type: 'Sick leave' };
const day = (date: string, d: Partial<CoverageDay> = {}): CoverageDay => ({
  date,
  members: 4,
  atWork: 3,
  off: [],
  remote: [],
  onDuty: [],
  self: true,
  limitedOff: 1,
  fewestAtWork: null,
  over: false,
  ...d,
});

describe('the coverage in words', () => {
  it('says days short, and ranges within a month, across months and across years', () => {
    expect(shortDay('2026-11-12')).toBe('12 Nov');
    expect(dayRange('2026-11-12', '2026-11-12')).toBe('12 Nov');
    expect(dayRange('2026-11-12', '2026-11-14')).toBe('12–14 Nov');
    expect(dayRange('2026-11-30', '2026-12-02')).toBe('30 Nov–2 Dec');
    expect(dayRange('2026-12-30', '2027-01-02')).toBe('30 Dec 2026–2 Jan 2027');
    expect(namesText(['Omar'])).toBe('Omar');
    expect(namesText(['Omar', 'Sara'])).toBe('Omar and Sara');
    expect(namesText(['Omar', 'Sara', 'Ali'])).toBe('Omar, Sara and Ali');
  });

  it('names who is off, by name only for the employee, grouping the days with the same people', () => {
    const days = [day('2026-11-12', { off: [omar, sara] }), day('2026-11-15', { off: [{ ...sara, waiting: true }] }), day('2026-11-16', { off: [{ ...sara, waiting: true }] })];
    expect(offLines(days, 'requester')).toEqual(['Omar and Sara are off on 12 Nov', 'Sara is off on 15–16 Nov (waiting)']);
    // never a leave's type to the employee
    expect(offLines(days, 'requester').join(' ')).not.toMatch(/Annual|Sick/);
    // waiting for some only: said of each
    expect(offLines([day('2026-11-12', { off: [omar, { ...sara, waiting: true }] })], 'requester')).toEqual(['Omar and Sara (waiting) are off on 12 Nov']);
    // a day with nobody off breaks the run
    expect(offLines([day('2026-11-12', { off: [omar] }), day('2026-11-15'), day('2026-11-16', { off: [omar] })], 'requester')).toEqual([
      'Omar is off on 12 Nov',
      'Omar is off on 16 Nov',
    ]);
    expect(offLines([day('2026-11-12')], 'requester')).toEqual([]);
  });

  it('says "on leave" to an approver and the type to HR and the CEO', () => {
    const days = [day('2026-11-12', { off: [omar, { ...sara, halfDay: true }] })];
    expect(offLines(days, 'approver')).toEqual(['Omar and Sara (half a day) are on leave on 12 Nov']);
    expect(offLines(days, 'hr')).toEqual(['Omar (Annual leave) and Sara (Sick leave, half a day) are off on 12 Nov']);
    expect(offLines([day('2026-11-12', { off: [omar] })], 'hr')).toEqual(['Omar is off on 12 Nov (Annual leave)']);
  });

  it('says who works elsewhere apart: working remotely or on duty, at work', () => {
    const days = [
      day('2026-11-12', { remote: [{ id: 'm', fullNameEn: 'Mona', waiting: false }], onDuty: [{ id: 'a', fullNameEn: 'Ali', waiting: true }] }),
      day('2026-11-15', { onDuty: [{ id: 'a', fullNameEn: 'Ali', waiting: true }] }),
    ];
    expect(elsewhereLines(days)).toEqual(['Mona is working remotely on 12 Nov', 'Ali is on duty on 12–15 Nov (waiting)']);
    expect(atWorkText({ atWork: 3, members: 4 })).toBe('3 of 4 at work');
    expect(busyDays([day('2026-11-11'), ...days]).map((d) => d.date)).toEqual(['2026-11-12', '2026-11-15']);
  });

  it('warns of the staffing limit, still sendable: HR (the CEO for a C-level person) approves it too', () => {
    const over = (date: string) => day(date, { atWork: 1, members: 4, fewestAtWork: 2, over: true, off: [omar, sara] });
    const video = { nameEn: 'Video' };
    expect(overLimitText(video, [over('2026-11-12')])).toBe('This would leave Video with 1 of 4 at work on 12 Nov (the limit is 2): HR will need to approve it too.');
    expect(overLimitText(video, [over('2026-11-12'), over('2026-11-15'), over('2026-11-16')], true)).toBe(
      'This would leave Video with 1 of 4 at work on 12 Nov and 2 more days (the limit is 2): the CEO will need to approve it too.',
    );
    expect(overLimitText(video, [day('2026-11-12')])).toBeNull();
    expect(overLimitText(null, [over('2026-11-12')])).toBeNull();
    expect(clashText(video, [day('2026-11-11'), over('2026-11-12'), over('2026-11-15')])).toBe('Over the staffing limit: Video would have 1 of 4 at work on 12 Nov and 1 more day (the limit is 2).');
  });

  it('warns of the colleagues the employee covers on those days, and says it to HR', () => {
    const clash = { employee: { id: 'o', fullNameEn: 'Omar' }, startDate: '2026-11-12', endDate: '2026-11-14', waiting: false };
    expect(coveringText(clash)).toBe('You’re covering Omar on 12–14 Nov');
    expect(coveringText({ ...clash, waiting: true })).toBe('You’re covering Omar on 12–14 Nov (waiting)');
    expect(coversText('Sara', clash)).toBe('Sara is covering Omar on 12–14 Nov');
  });

  it('lists the team first among those who may cover, and names the stand-in', () => {
    const c = (id: string, sameTeam: boolean) => ({ id, fullNameEn: id, department: 'Production', team: sameTeam ? 'Video' : null, sameTeam });
    expect(coverGroups([c('a', false), c('b', true), c('c', true)])).toEqual({ team: [c('b', true), c('c', true)], others: [c('a', false)] });
    expect(placeText({ department: 'Production', team: 'Video' })).toBe('Video · Production');
    expect(placeText({ department: null, team: null })).toBeNull();
    expect(standInText({ employee: { fullNameEn: 'Dana' }, hr: false })).toBe('Dana');
    expect(standInText({ employee: null, hr: true })).toBe('HR');
    expect(standInText(null)).toBeNull();
    expect(standInValue({ employee: { id: 'x' }, hr: false })).toBe('x');
    expect(standInValue({ employee: null, hr: true })).toBe('hr');
    expect(standInValue(null)).toBe('');
  });
});
