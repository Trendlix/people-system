import { ENDING_RULE_DEFAULTS } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { daysUntil, dueNote, monthsLabel, noticeLabel } from './labels';

describe('noticeLabel', () => {
  it('words the seeded rules as the owner decided them', () => {
    const { probation, resignation, non_renewal, company_notice, death } = ENDING_RULE_DEFAULTS;
    expect(noticeLabel(probation.noticeAmount, probation.noticeUnit)).toBe('2 weeks');
    expect(noticeLabel(resignation.noticeAmount, resignation.noticeUnit)).toBe('3 months');
    expect(noticeLabel(non_renewal.noticeAmount, non_renewal.noticeUnit)).toBe('45 working days');
    expect(noticeLabel(company_notice.noticeAmount, company_notice.noticeUnit)).toBe('3 months');
    expect(noticeLabel(death.noticeAmount, death.noticeUnit)).toBe('None');
  });

  it('says one of a unit in the singular', () => {
    expect(noticeLabel(1, 'months')).toBe('1 month');
    expect(noticeLabel(1, 'weeks')).toBe('1 week');
    expect(noticeLabel(1, 'days')).toBe('1 day');
    expect(noticeLabel(1, 'working_days')).toBe('1 working day');
  });

  it('says None for no notice, whatever the unit', () => {
    expect(noticeLabel(0, 'months')).toBe('None');
    expect(noticeLabel(0, 'working_days')).toBe('None');
  });
});

describe('monthsLabel', () => {
  it('counts months', () => {
    expect(monthsLabel(12)).toBe('12 months');
    expect(monthsLabel(3)).toBe('3 months');
    expect(monthsLabel(1)).toBe('1 month');
  });

  it('words 0 as asked', () => {
    expect(monthsLabel(0)).toBe('None');
    expect(monthsLabel(0, 'No probation')).toBe('No probation');
  });
});

describe('daysUntil', () => {
  it('counts whole days between two dates', () => {
    expect(daysUntil('2026-10-15', '2026-10-15')).toBe(0);
    expect(daysUntil('2026-10-22', '2026-10-15')).toBe(7);
    expect(daysUntil('2026-10-14', '2026-10-15')).toBe(-1);
    // across the end of a month and a year
    expect(daysUntil('2027-01-02', '2026-12-30')).toBe(3);
  });
});

describe('dueNote', () => {
  const today = '2026-10-15';

  it('flags a date that has passed', () => {
    expect(dueNote('2026-10-14', today)).toEqual({ tone: 'passed', text: 'Passed' });
    expect(dueNote('2025-01-01', today)).toEqual({ tone: 'passed', text: 'Passed' });
  });

  it('flags a date within a week', () => {
    expect(dueNote('2026-10-15', today)).toEqual({ tone: 'soon', text: 'Today' });
    expect(dueNote('2026-10-16', today)).toEqual({ tone: 'soon', text: 'Tomorrow' });
    expect(dueNote('2026-10-18', today)).toEqual({ tone: 'soon', text: 'In 3 days' });
    expect(dueNote('2026-10-22', today)).toEqual({ tone: 'soon', text: 'In 7 days' });
  });

  it('leaves later dates, and missing ones, alone', () => {
    expect(dueNote('2026-10-23', today)).toBeNull();
    expect(dueNote(null, today)).toBeNull();
    expect(dueNote('', today)).toBeNull();
    expect(dueNote('not a date', today)).toBeNull();
  });
});
