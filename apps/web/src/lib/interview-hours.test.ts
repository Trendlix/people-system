import { describe, expect, it } from 'vitest';
import { bufferOptions, changeText, defaultChoices, defaultsFormBody, hoursFormBody, interviewHoursHref, noticeOptions, rowsOf, rulesText, savedHoursText } from './interview-hours';

// Interview hours on the website (owner, 25 October 2026: "Hours + calendar": weekly interview hours set once, with
// one-off changes, the notice and buffer only ever stricter than the company's): the form's rows, what it sends, and the
// words of the lists.

const DEFAULTS = { noticeHours: 24, bufferMinutes: 15 };

function form(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

describe('the notice and buffer choices', () => {
  it('offer the company’s first (sent empty), then only stricter ones', () => {
    const notice = noticeOptions(DEFAULTS);
    expect(notice[0]).toEqual({ value: '', label: 'The company’s (24 hours)' });
    expect(notice.slice(1).map((c) => c.value)).toEqual(['48', '72', '96', '120', '168', '336']);
    expect(notice.find((c) => c.value === '48')?.label).toBe('2 days');
    const buffer = bufferOptions(DEFAULTS);
    expect(buffer[0]).toEqual({ value: '', label: 'The company’s (15 minutes)' });
    expect(buffer.slice(1).map((c) => c.value)).toEqual(['20', '30', '45', '60', '90', '120']);
  });

  it('keep a saved value off the list, if it is still stricter', () => {
    expect(noticeOptions(DEFAULTS, 30).map((c) => c.value)).toContain('30');
    expect(noticeOptions(DEFAULTS, 12).map((c) => c.value)).not.toContain('12');
    expect(bufferOptions({ noticeHours: 0, bufferMinutes: 0 }, 25).map((c) => c.value)).toContain('25');
  });

  it('give the company every value, its saved one included', () => {
    const { notice, buffer } = defaultChoices({ noticeHours: 36, bufferMinutes: 15 });
    expect(notice.map((c) => c.value)).toContain('0');
    expect(notice.map((c) => c.value)).toContain('36');
    expect(buffer.find((c) => c.value === '15')?.label).toBe('15 minutes');
  });
});

describe('the hours form', () => {
  it('starts from the saved hours, on the 12-hour clock and DD/MM/YYYY', () => {
    expect(rowsOf(null)).toEqual({ ranges: [], changes: [] });
    expect(
      rowsOf({
        windows: [{ day: 0, from: '12:00', to: '15:00' }],
        changes: [
          { date: '2026-11-03', kind: 'off', from: null, to: null },
          { date: '2026-11-05', kind: 'extra', from: '09:30', to: '11:00' },
        ],
        effectiveFrom: '2026-10-25',
        noticeHours: null,
        bufferMinutes: null,
      }),
    ).toEqual({
      ranges: [{ day: 0, from: '12:00 PM', to: '3:00 PM' }],
      changes: [
        { kind: 'off', date: '03/11/2026', from: '', to: '' },
        { kind: 'extra', date: '05/11/2026', from: '9:30 AM', to: '11:00 AM' },
      ],
    });
  });

  it('sends the ranges, the changes, the day they count from, and the company’s notice as none', () => {
    const fd = form([
      ['windowDay', '0'],
      ['windowFrom', '12:00 PM'],
      ['windowTo', '3:00 PM'],
      ['windowDay', '2'],
      ['windowFrom', ''],
      ['windowTo', ''],
      ['windowDay', '2'],
      ['windowFrom', '10:00 AM'],
      ['windowTo', '12:30 PM'],
      ['changeKind', 'off'],
      ['changeDate', '3/11/2026'],
      ['changeFrom', ''],
      ['changeTo', ''],
      ['changeKind', 'extra'],
      ['changeDate', '05/11/2026'],
      ['changeFrom', '9:30 AM'],
      ['changeTo', '11:00 AM'],
      ['effectiveFrom', '25/10/2026'],
      ['noticeHours', ''],
      ['bufferMinutes', '30'],
    ]);
    expect(hoursFormBody(fd)).toEqual({
      body: {
        windows: [
          { day: 0, from: '12:00', to: '15:00' },
          { day: 2, from: '10:00', to: '12:30' },
        ],
        changes: [
          { date: '2026-11-03', kind: 'off', from: null, to: null },
          { date: '2026-11-05', kind: 'extra', from: '09:30', to: '11:00' },
        ],
        effectiveFrom: '2026-10-25',
        noticeHours: null,
        bufferMinutes: 30,
      },
      errors: [],
    });
  });

  it('says what the form can see is wrong, each once', () => {
    const fd = form([
      ['windowDay', '1'],
      ['windowFrom', '10:00 AM'],
      ['windowTo', '5:-- PM'],
      ['windowDay', '1'],
      ['windowFrom', ''],
      ['windowTo', '2:00 PM'],
      ['changeKind', 'extra'],
      ['changeDate', ''],
      ['changeFrom', ''],
      ['changeTo', ''],
      ['changeKind', 'extra'],
      ['changeDate', '06/11/2026'],
      ['changeFrom', '9:00 AM'],
      ['changeTo', ''],
      ['effectiveFrom', '31/02/2026'],
      ['noticeHours', 'x'],
      ['bufferMinutes', ''],
    ]);
    expect(hoursFormBody(fd)).toEqual({
      body: null,
      errors: [
        'Give Monday’s range a start and an end time.',
        'Give the extra hours a date, as DD/MM/YYYY.',
        'Give the extra hours on 06/11/2026 a start and an end time.',
        'Give the day the weekly hours count from, as DD/MM/YYYY.',
        'Choose the minimum notice.',
      ],
    });
  });

  it('sends an empty week as no ranges at all (the API then clears the hours)', () => {
    const fd = form([
      ['windowDay', '0'],
      ['windowFrom', ''],
      ['windowTo', ''],
      ['effectiveFrom', '25/10/2026'],
      ['noticeHours', ''],
      ['bufferMinutes', ''],
    ]);
    expect(hoursFormBody(fd).body).toEqual({ windows: [], changes: [], effectiveFrom: '2026-10-25', noticeHours: null, bufferMinutes: null });
  });
});

describe('the company’s defaults form', () => {
  it('sends both, with the API’s own checks', () => {
    expect(defaultsFormBody(form([['noticeHours', '48'], ['bufferMinutes', '10']]))).toEqual({ body: { noticeHours: 48, bufferMinutes: 10 }, errors: [] });
    expect(defaultsFormBody(form([['noticeHours', ''], ['bufferMinutes', '7']])).errors).toEqual([
      'Give the minimum notice in whole hours, from 0 to 336 (two weeks).',
      'Give the buffer between interviews in minutes, in fives, from 0 to 120.',
    ]);
  });
});

describe('the words', () => {
  it('reads one-off changes, the rules in effect and a save', () => {
    expect(changeText({ kind: 'off', from: null, to: null })).toBe('Day off from interviews');
    expect(changeText({ kind: 'extra', from: '09:30', to: '11:00' })).toBe('Extra hours 9:30 AM–11:00 AM');
    expect(rulesText(null, DEFAULTS)).toBe('24 hours’ notice · 15 minutes between interviews');
    expect(rulesText({ noticeHours: 48, bufferMinutes: 30 }, DEFAULTS)).toBe('2 days’ notice · 30 minutes between interviews');
    expect(rulesText({ noticeHours: 1, bufferMinutes: null }, { noticeHours: 0, bufferMinutes: 0 })).toBe('1 hour’s notice · no buffer between interviews');
    expect(rulesText(null, { noticeHours: 0, bufferMinutes: 0 })).toBe('No minimum notice · no buffer between interviews');
    expect(savedHoursText(null)).toBe('Saved: you have no interview hours now.');
    expect(interviewHoursHref('a b')).toBe('/organization/interview-hours/a%20b');
  });
});
