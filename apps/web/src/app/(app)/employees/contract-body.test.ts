import { describe, expect, it } from 'vitest';
import { contractBody } from './contract-body';

/** A submitted form: each entry once, or a list for repeated fields. */
function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) for (const v of Array.isArray(value) ? value : [value]) fd.append(key, v);
  return fd;
}

const monthly = {
  startDate: '1/11/2026',
  durationMonths: '12',
  probationMonths: '3',
  payBasis: 'monthly',
  salaryBasis: 'gross',
  grossSalary: '15,000',
  basicPercent: '80',
  daysPerWeek: '',
  netSalary: '12519.38',
  note: ' Agreed on the phone ',
};

const hourly = { ...monthly, payBasis: 'hourly', rateBasis: 'gross', grossSalary: '', hourlyRate: '150', hoursPerWeek: '20', daysPerWeek: '3', netSalary: '10437' };

describe('a contract as the API takes it', () => {
  it('sends a monthly salary', () => {
    const errors: string[] = [];
    expect(contractBody(form({ ...monthly, allowanceTypeId: 'a-1', allowanceAmount: '1,000' }), errors, false, false)).toEqual({
      startDate: '2026-11-01',
      durationMonths: 12,
      probationMonths: 3,
      payBasis: 'monthly',
      grossSalary: 15000,
      basicPercent: 80,
      netSalary: 12519.38,
      allowances: [{ allowanceTypeId: 'a-1', amount: 1000 }],
      note: 'Agreed on the phone',
    });
    expect(errors).toEqual([]);
  });

  it('sends the rate and the hours by the hour, not a gross', () => {
    const errors: string[] = [];
    const body = contractBody(form(hourly), errors, false, false);
    expect(errors).toEqual([]);
    expect(body).toMatchObject({ payBasis: 'hourly', hourlyRate: 150, hoursPerWeek: 20, daysPerWeek: 3, netSalary: 10437 });
    expect(body).not.toHaveProperty('grossSalary');
  });

  it('sends the gross rate worked out from the net per hour, and the net worked out', () => {
    const errors: string[] = [];
    const body = contractBody(form({ ...hourly, rateBasis: 'net', netRate: '120', hourlyRate: '144.59', hoursPerWeek: '16', netSalary: '8320.33' }), errors, false, false);
    expect(errors).toEqual([]);
    expect(body).toMatchObject({ payBasis: 'hourly', hourlyRate: 144.59, hoursPerWeek: 16, netSalary: 8320.33 });
    // the net rate and the switch are kept only for a refused save
    expect(body).not.toHaveProperty('netRate');
    expect(body).not.toHaveProperty('rateBasis');
  });

  it('asks for the net per hour when no gross rate could be worked out from it', () => {
    const errors: string[] = [];
    contractBody(form({ ...hourly, rateBasis: 'net', netRate: 'abc', hourlyRate: '', netSalary: '' }), errors, false, false);
    expect(errors).toEqual(['Enter the net per hour, e.g. 120.']);
    const typedGross: string[] = [];
    contractBody(form({ ...hourly, hourlyRate: '' }), typedGross, false, false);
    expect(typedGross).toEqual(['Enter the hourly rate, e.g. 150.']);
  });

  it('checks the hours, the days, the basic part and the length', () => {
    const errors: string[] = [];
    contractBody(form({ ...hourly, hoursPerWeek: '49', daysPerWeek: '7', basicPercent: '0', durationMonths: '0' }), errors, false, false);
    expect(errors).toEqual([
      'A fixed term runs for 1 to 60 months.',
      'Enter the hours a week as a number above 0, up to 48, e.g. 20 or 22.5.',
      "Enter the working days a week as a whole number from 1 to 6, or leave it empty for the shift's week.",
      'Enter the basic part as a whole percent of the gross, from 1 to 100, e.g. 80.',
    ]);
  });

  it('leaves out what a renewal has none of, and clears an emptied net and days on a draft', () => {
    const errors: string[] = [];
    const body = contractBody(form({ ...monthly, netSalary: '' }), errors, true, true);
    expect(errors).toEqual([]);
    expect(body).not.toHaveProperty('startDate');
    expect(body).not.toHaveProperty('probationMonths');
    expect(body).toMatchObject({ daysPerWeek: null, netSalary: null });
    expect(contractBody(form({ ...monthly, netSalary: '' }), errors, false, false)).not.toHaveProperty('netSalary');
  });
});
