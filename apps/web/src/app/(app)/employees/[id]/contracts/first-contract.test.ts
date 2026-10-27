import { describe, expect, it } from 'vitest';
import { firstContractDefaults, noProbationAgain } from './first-contract';

describe('the first contract, as hiring in one form starts it', () => {
  const settings = { probationMonths: 3, durationMonths: 12, basicPercentDefault: 75 };

  it('takes the settings’ length and probation, and the company’s basic share, with a monthly salary still to type', () => {
    expect(firstContractDefaults(settings, '', false)).toEqual({
      startDate: '',
      // fixed-term stays the default (owner, 18 October 2026), with no job
      form: 'fixed',
      durationMonths: 12,
      jobToDo: '',
      endDate: '',
      probationMonths: 3,
      payBasis: 'monthly',
      grossSalary: null,
      hourlyRate: null,
      hoursPerWeek: null,
      hourlyMinimum: null,
      daysPerWeek: null,
      basicPercent: 75,
      netSalary: null,
      allowances: [],
      note: '',
    });
    expect(firstContractDefaults(settings, '2026-11-01', false).startDate).toBe('2026-11-01');
  });

  it('has no probation for someone employed here before: once with an employer (Art. 90)', () => {
    expect(firstContractDefaults(settings, '', true).probationMonths).toBe(0);
    expect(noProbationAgain('Omar Khaled')).toBe('0: Omar Khaled was employed here before, and probation comes only once with an employer (Labour Law Art. 90).');
  });

  // owner, 19 October 2026: an intern's agreement has no probation, and runs 3 months to start with
  it('has no probation for an intern, and 3 months', () => {
    expect(firstContractDefaults(settings, '', false, 'intern')).toMatchObject({ probationMonths: 0, durationMonths: 3 });
    expect(firstContractDefaults(settings, '', false, 'full_time')).toMatchObject({ probationMonths: 3, durationMonths: 12 });
  });

  it('keeps 80% basic with an API from before the company’s default', () => {
    expect(firstContractDefaults({ probationMonths: 3, durationMonths: 12 }, '', false).basicPercent).toBe(80);
  });
});
