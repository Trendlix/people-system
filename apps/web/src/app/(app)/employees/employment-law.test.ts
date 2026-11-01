import { EMPLOYMENT_TYPES, LABELS } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  ART_154_NOTE,
  art154Estimate,
  art154Text,
  BECAME_OPEN_ENDED,
  CASUAL_TOO_LONG,
  contractLengthText,
  FREELANCE_NO_LEAVE,
  FREELANCE_SHORT,
  INTERN_NO_LEAVE,
  INTERN_SHORT,
  lawWarnings,
  noLeaveText,
  outsideLawShort,
  TRAINING_ENDED,
  typeWord,
  workNatureLabel,
} from './employment-law';

describe('the employment types by the labour law (18 October 2026)', () => {
  it('are full-time, part-time, the unpaid internship and freelance, freelance named outside the law', () => {
    // the unpaid internship since 19 October 2026, the one internship since 25 October 2026 (owner: "unpaid internship
    // and training are the same thing"): the paid trainee is gone
    expect(EMPLOYMENT_TYPES).toEqual(['full_time', 'part_time', 'intern', 'freelance']);
    expect(EMPLOYMENT_TYPES.map((t) => LABELS.employmentType[t])).toEqual(['Full-time', 'Part-time', 'Unpaid internship', 'Freelance (outside the labour law)']);
  });

  it('names a type in a sentence without the label’s note', () => {
    expect(typeWord('full_time')).toBe('full-time');
    expect(typeWord('part_time')).toBe('part-time');
    expect(typeWord('freelance')).toBe('freelance');
    expect(typeWord('intern')).toBe('unpaid internship');
    // a value the screens don't know is shown as it is
    expect(typeWord('robot')).toBe('robot');
  });

  it('has no leave outside the labour law: a freelancer’s or an intern’s', () => {
    expect(noLeaveText('freelance')).toBe(FREELANCE_NO_LEAVE);
    expect(noLeaveText('intern')).toBe(INTERN_NO_LEAVE);
    expect(INTERN_NO_LEAVE).toMatch(/^No leave under an unpaid internship/);
    for (const t of ['full_time', 'part_time']) expect(noLeaveText(t)).toBeNull();
    expect(outsideLawShort('freelance')).toBe(FREELANCE_SHORT);
    expect(outsideLawShort('intern')).toBe(INTERN_SHORT);
    expect(outsideLawShort('part_time')).toBeUndefined();
  });
});

describe('the nature of the work', () => {
  it('has a label for each nature, regular for an API from before it', () => {
    expect(workNatureLabel('seasonal')).toBe('Seasonal');
    expect(workNatureLabel(undefined)).toBe('Regular');
  });
});

describe('a contract’s length', () => {
  it('is fixed-term for its months, open-ended, or for a specific job', () => {
    expect(contractLengthText({ form: 'fixed', durationMonths: 12 })).toBe('Fixed-term · 12 months');
    expect(contractLengthText({ form: 'fixed', durationMonths: 1 })).toBe('Fixed-term · 1 month');
    expect(contractLengthText({ form: 'fixed' })).toBe('Fixed-term');
    expect(contractLengthText({ form: 'open_ended', durationMonths: null })).toBe('Open-ended');
    expect(contractLengthText({ form: 'specific_job', jobToDo: 'Building the new website' })).toBe('For a specific job: Building the new website');
    expect(contractLengthText({ form: 'specific_job', jobToDo: null })).toBe('For a specific job');
  });
});

describe('HR’s warnings', () => {
  it('are badges in the brief’s words, each with what it means', () => {
    expect(lawWarnings({})).toEqual([]);
    expect(lawWarnings({ becameOpenEnded: false, casualTooLong: false })).toEqual([]);
    expect(lawWarnings({ becameOpenEnded: true, casualTooLong: true }).map((w) => w.text)).toEqual([
      'Became open-ended — Art. 88',
      'Casual work past 6 months',
    ]);
    expect(lawWarnings({ casualTooLong: true })).toEqual([CASUAL_TOO_LONG]);
    expect(BECAME_OPEN_ENDED.detail).toBe('The term ended without a signed renewal: renew it in writing, or record how it ends.');
  });

  it('warns of a training or internship agreement past its end with the way forward, never open-ended (19 October 2026)', () => {
    expect(TRAINING_ENDED.key).toBe('training_ended');
    expect(TRAINING_ENDED.text).toBe('Internship ended');
    expect(TRAINING_ENDED.detail).toBe('Renew it, convert it to a full-time contract, or end it with End employment.');
    expect(TRAINING_ENDED.detail).not.toMatch(/open-ended|Art\. 88|in writing/);
  });
});

describe('a fixed term the company doesn’t renew (Art. 154)', () => {
  it('estimates a month’s wage for each year of service, in whole months, as the API does', () => {
    // joined 1 November 2024, the term ends 31 October 2026: 2 years
    expect(art154Estimate('2024-11-01', '2026-10-31', 15_000)).toEqual({ serviceYears: 2, lastMonthlyWage: 15_000, amount: 30_000 });
    // 1 year and 6 months: 1.5 years, half a month's wage on top
    expect(art154Estimate('2025-05-01', '2026-10-31', 12_000)).toEqual({ serviceYears: 1.5, lastMonthlyWage: 12_000, amount: 18_000 });
    // a month short of a whole one doesn't count
    expect(art154Estimate('2025-11-15', '2026-11-13', 10_000)).toEqual({ serviceYears: 0.92, lastMonthlyWage: 10_000, amount: 9166.67 });
    // the wage hidden with the salary: the years alone
    expect(art154Estimate('2024-11-01', '2026-10-31', null)).toEqual({ serviceYears: 2, lastMonthlyWage: null, amount: null });
  });

  it('says so in words, information only', () => {
    expect(ART_154_NOTE).toBe("Under Art. 154 the employee may be owed one month's wage for each year of service — check with your lawyer");
    expect(art154Text({ serviceYears: 1.5, lastMonthlyWage: 12_000, amount: 18_000 })).toBe(
      '1.5 years of service × EGP 12,000.00, the last monthly wage: about EGP 18,000.00. Information only: no money is moved.',
    );
    expect(art154Text({ serviceYears: 1, lastMonthlyWage: null, amount: null })).toBe('1 year of service. Information only: no money is moved.');
  });
});
