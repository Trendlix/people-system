import { EMPLOYMENT_TYPES, LABELS, WORK_NATURES } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  ART_154_NOTE,
  art154Estimate,
  art154Text,
  BECAME_OPEN_ENDED,
  CASUAL_TOO_LONG,
  contractLengthText,
  employmentTypeHint,
  FREELANCE_NOTE,
  lawWarnings,
  typeWord,
  WORK_NATURE_HINTS,
  workNatureLabel,
  workPatternNote,
} from './employment-law';

describe('the employment types by the labour law (18 October 2026)', () => {
  it('are full-time, part-time, trainee and freelance, freelance named outside the law', () => {
    expect(EMPLOYMENT_TYPES).toEqual(['full_time', 'part_time', 'trainee', 'freelance']);
    expect(EMPLOYMENT_TYPES.map((t) => LABELS.employmentType[t])).toEqual([
      'Full-time',
      'Part-time',
      'Trainee',
      'Freelance (outside the labour law)',
    ]);
  });

  it('names a type in a sentence without the label’s note', () => {
    expect(typeWord('full_time')).toBe('full-time');
    expect(typeWord('trainee')).toBe('trainee');
    expect(typeWord('freelance')).toBe('freelance');
    // a value the screens don't know is shown as it is
    expect(typeWord('robot')).toBe('robot');
  });

  it('hints at what each type means, where its terms are', () => {
    expect(employmentTypeHint('full_time', 'below')).toBeNull();
    expect(employmentTypeHint('', 'tab')).toBeNull();
    expect(employmentTypeHint('part_time', 'below')).toMatch(/contract's terms, below\.$/);
    expect(employmentTypeHint('part_time', 'tab')).toMatch(/on the Employment tab\.$/);
    // an offer has the pay terms itself
    expect(employmentTypeHint('part_time', 'offer')).toBeNull();
    expect(employmentTypeHint('trainee', 'below')).toMatch(/at least 14 years old \(Art\. 28\).*Its stages are set below\.$/);
    expect(employmentTypeHint('trainee', 'offer')).toMatch(/once the offer is accepted\.$/);
    expect(employmentTypeHint('freelance', 'tab')).toBe(FREELANCE_NOTE);
    expect(FREELANCE_NOTE).toMatch(/^Outside the labour law.*Art\. 1\(1\).*No leave and no company social insurance; a service agreement/);
  });
});

describe('the nature of the work and remote work', () => {
  it('has a hint for each nature, casual with its 6 months', () => {
    for (const n of WORK_NATURES) expect(WORK_NATURE_HINTS[n]).toBeTruthy();
    expect(WORK_NATURE_HINTS.casual).toMatch(/within 6 months \(Labour Law Art\. 1\(7\)\)/);
    expect(workNatureLabel('seasonal')).toBe('Seasonal');
    // an API from before it: regular
    expect(workNatureLabel(undefined)).toBe('Regular');
  });

  it('names Work from home and Hybrid as the law’s remote work (Art. 96(1))', () => {
    expect(workPatternNote('wfh')).toBe('Remote work (Labour Law Art. 96(1))');
    expect(workPatternNote('hybrid')).toBe('Partly remote work (Labour Law Art. 96(1))');
    expect(workPatternNote('office')).toBeNull();
    expect(workPatternNote('outdoor')).toBeNull();
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
    expect(BECAME_OPEN_ENDED.detail).toMatch(/Art\. 88\(3\).*Renew it in writing, or record how it ends\.$/);
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
