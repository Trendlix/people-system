import { LEAVE_RULE_DEFAULTS } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  balanceText,
  editsLeaveSetup,
  hoursFromText,
  payText,
  PERMISSION_FIELDS,
  permissionSettingText,
  requestsCountText,
  seesYearClosing,
  settingsBody,
  typeBody,
  typeSource,
  unitText,
  wholeFrom,
  yearClosingHref,
} from './setup';

// Organization → Leave (owner, 18 October 2026: "can you apply the leaves according to the law?")

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

describe('who changes the Leave Setup', () => {
  it('is HR; HR and the CEO see the year closing', () => {
    expect(editsLeaveSetup({ roles: ['hr'] })).toBe(true);
    expect(editsLeaveSetup({ roles: ['ceo', 'admin', 'finance'] })).toBe(false);
    expect(seesYearClosing({ roles: ['ceo'] })).toBe(true);
    expect(seesYearClosing({ roles: ['finance', 'admin'] })).toBe(false);
    expect(yearClosingHref(2026)).toBe('/organization/leave/year-closing?year=2026');
  });
});

describe('the annual leave’s days (Art. 124)', () => {
  const law = Object.fromEntries(Object.entries(LEAVE_RULE_DEFAULTS).map(([k, v]) => [k, String(v)]));

  it('are the law’s to start with, read as whole numbers', () => {
    expect(settingsBody(form(law))).toEqual({ body: LEAVE_RULE_DEFAULTS, errors: [] });
    expect(settingsBody(form({ ...law, standardDays: '٢٢' })).body.standardDays).toBe(22);
    expect(unitText(1, 'years')).toBe('1 year');
    expect(unitText(21, 'days')).toBe('21 days');
  });

  it('say what is wrong: not a number, or fewer days from the second year than the first', () => {
    expect(settingsBody(form({ ...law, firstYearDays: '15.5' })).errors).toEqual(['Enter “First year of service” as a whole number of days from 0 to 366.']);
    expect(settingsBody(form({ ...law, standardDays: '10' })).errors).toEqual(['The days from the second year can’t be fewer than the first year’s.']);
    expect(settingsBody(form({ ...law, longServiceDays: '20' })).errors).toEqual(['The days after long service can’t be fewer than those from the second year.']);
  });

  it('reads whole numbers within limits', () => {
    expect(wholeFrom('', 0, 5)).toBeNull();
    expect(wholeFrom('3', 0, 5)).toBe(3);
    expect(wholeFrom('6', 0, 5)).toBeNaN();
    expect(wholeFrom('1.5', 0, 5)).toBeNaN();
  });
});

describe('permission’s hours (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day", "Yes, in Leave Setup")', () => {
  const law = Object.fromEntries(Object.entries(LEAVE_RULE_DEFAULTS).map(([k, v]) => [k, String(v)]));

  it('are saved with the annual leave’s days when the form has them, in half hours', () => {
    expect(PERMISSION_FIELDS.map((f) => [f.label, f.defaultHours])).toEqual([
      ['Permission hours a month', 4],
      ['Most permission hours a day', 2],
    ]);
    expect(settingsBody(form({ ...law, permissionHoursPerMonth: '4', permissionMaxHoursPerDay: '2' }))).toEqual({
      body: { ...LEAVE_RULE_DEFAULTS, permissionHoursPerMonth: 4, permissionMaxHoursPerDay: 2 },
      errors: [],
    });
    // 0 a month: no permission; a comma or Arabic digits typed
    expect(settingsBody(form({ ...law, permissionHoursPerMonth: '0', permissionMaxHoursPerDay: '1,5' })).body).toMatchObject({ permissionHoursPerMonth: 0, permissionMaxHoursPerDay: 1.5 });
    expect(hoursFromText('٤')).toBe(4);
    expect(hoursFromText('')).toBeNaN();
    // an API from before permission: the form has none, and none is sent
    expect(settingsBody(form(law)).body).not.toHaveProperty('permissionHoursPerMonth');
  });

  it('say what is wrong, as the API would', () => {
    expect(settingsBody(form({ ...law, permissionHoursPerMonth: '4.25', permissionMaxHoursPerDay: '2' })).errors).toEqual([
      'Enter the permission hours a month from 0 to 40, in half hours, e.g. 4 (0: no permission).',
    ]);
    expect(settingsBody(form({ ...law, permissionHoursPerMonth: '4', permissionMaxHoursPerDay: '' })).errors).toEqual([
      'Enter the most permission hours a day from 0.5 to 8, in half hours, e.g. 2.',
    ]);
    expect(settingsBody(form({ ...law, permissionHoursPerMonth: '2', permissionMaxHoursPerDay: '3' })).errors).toEqual([
      "The most hours a day (3 hours) can't be more than the hours a month (2 hours).",
    ]);
  });

  it('read in words for those who don’t change them', () => {
    expect(permissionSettingText(4)).toBe('4 hours');
    expect(permissionSettingText(1.5)).toBe('1 hour 30 minutes');
    expect(permissionSettingText(0)).toBe('None: no permission');
  });
});

describe('a leave type', () => {
  const base = { nameEn: 'Compassionate leave', nameAr: 'إجازة وفاة', paid: 'paid', balance: 'per_request', maxPerRequest: '3', sortOrder: '10', active: 'on' };

  it('is read into what the API takes, the checkboxes sent only when ticked', () => {
    expect(typeBody(form(base))).toEqual({
      body: {
        nameEn: 'Compassionate leave',
        nameAr: 'إجازة وفاة',
        paid: 'paid',
        payPercent: null,
        balance: 'per_request',
        daysPerYear: null,
        maxPerRequest: 3,
        maxTimesInService: null,
        minServiceMonths: null,
        noticeDays: null,
        documentRequired: false,
        gender: null,
        calendarDays: false,
        halfDays: false,
        active: true,
        sortOrder: 10,
      },
      errors: [],
    });
  });

  it('needs a pay percent when partly paid, days a year when yearly, days a request when per request', () => {
    expect(typeBody(form({ ...base, paid: 'partly' })).errors).toEqual(['Enter the share of the pay a partly paid day pays, a whole percent from 0 to 100, e.g. 75.']);
    expect(typeBody(form({ ...base, paid: 'partly', payPercent: '75' })).body.payPercent).toBe(75);
    expect(typeBody(form({ ...base, balance: 'yearly' })).errors).toEqual(['Enter the days a year this type gives.']);
    expect(typeBody(form({ ...base, maxPerRequest: '' })).errors).toEqual(['Enter the days a request this type gives.']);
    // a casual leave's most a year, counted against the annual balance (Art. 128)
    expect(typeBody(form({ ...base, balance: 'from_annual', daysPerYear: '7', maxPerRequest: '2' })).body).toMatchObject({ daysPerYear: 7, maxPerRequest: 2 });
    // the days a year aren't kept for a type that doesn't have them
    expect(typeBody(form({ ...base, daysPerYear: '7' })).body.daysPerYear).toBeNull();
    expect(typeBody(form({ ...base, nameEn: '', noticeDays: 'ten' })).errors).toEqual([
      'Enter the name in English (up to 100 characters), e.g. Compassionate leave.',
      'Enter the days of notice as a whole number from 0 to 365, or leave it empty for none.',
    ]);
  });

  it('is worded on its card: its pay, its days and where it comes from', () => {
    expect(payText({ paid: 'partly', payPercent: 75 })).toBe('Paid at 75%');
    expect(payText({ paid: 'unpaid', payPercent: null })).toBe('Unpaid');
    expect(balanceText({ balance: 'from_annual', daysPerYear: 7, maxPerRequest: 2 })).toBe('From the annual balance, at most 7 days a year');
    expect(balanceText({ balance: 'per_request', daysPerYear: null, maxPerRequest: 30 })).toBe('30 days a request');
    expect(balanceText({ balance: 'yearly', daysPerYear: 1, maxPerRequest: null })).toBe('1 day a year of its own');
    expect(balanceText({ balance: 'none', daysPerYear: null, maxPerRequest: null })).toBe('No balance');
    expect(typeSource({ kind: 'hajj' })).toBe('Labour Law Art. 130');
    expect(typeSource({ kind: 'custom' })).toBe('Added by HR');
    expect(requestsCountText(0)).toBe('No requests yet');
    expect(requestsCountText(1)).toBe('1 request');
  });
});
