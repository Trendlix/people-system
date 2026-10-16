import { describe, expect, it } from 'vitest';
import { firstContractDefaults, noProbationAgain } from './first-contract';

describe('the first contract, as hiring in one form starts it', () => {
  const settings = { probationMonths: 3, durationMonths: 12, basicPercentDefault: 75 };

  it('takes the settings’ length and probation, and the company’s basic share, with a monthly salary still to type', () => {
    expect(firstContractDefaults(settings, '', false)).toEqual({
      startDate: '',
      durationMonths: 12,
      probationMonths: 3,
      payBasis: 'monthly',
      grossSalary: null,
      hourlyRate: null,
      hoursPerWeek: null,
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

  it('keeps 80% basic with an API from before the company’s default', () => {
    expect(firstContractDefaults({ probationMonths: 3, durationMonths: 12 }, '', false).basicPercent).toBe(80);
  });
});
