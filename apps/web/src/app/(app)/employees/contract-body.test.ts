import { describe, expect, it } from 'vitest';
import { contractBody, conversionBody, lengthBody, payBody } from './contract-body';

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
      // fixed-term unless another length is chosen (18 October 2026)
      form: 'fixed',
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

  // owner, 27 October 2026: "can i add rate per hour with a minimum monthly payment?" (he chose "On each contract")
  it('sends the minimum a month by the hour, null when left empty, and never for a monthly salary', () => {
    const errors: string[] = [];
    expect(contractBody(form({ ...hourly, hourlyMinimum: '12,000' }), errors, false, false)).toMatchObject({ payBasis: 'hourly', hourlyRate: 150, hourlyMinimum: 12000 });
    // empty: none, sent as such so a raise or a draft clears the one before
    expect(contractBody(form({ ...hourly, hourlyMinimum: '' }), errors, false, false)).toMatchObject({ hourlyMinimum: null });
    expect(payBody(form(hourly), errors, true)).toMatchObject({ hourlyMinimum: null });
    expect(errors).toEqual([]);
    expect(contractBody(form({ ...monthly, hourlyMinimum: '12,000' }), errors, false, false)).not.toHaveProperty('hourlyMinimum');
    const wrong: string[] = [];
    for (const typed of ['0', 'abc', '-5']) contractBody(form({ ...hourly, hourlyMinimum: typed }), wrong, false, false);
    expect(wrong).toEqual(Array(3).fill('Enter the minimum a month as an amount in EGP above 0, e.g. 12,000, or leave it empty for none.'));
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

  // a renewal whose pay changes counts as a raise, with its reason, for the CEO to approve (owner's decisions, 16 October 2026)
  it('sends why the pay changes on a renewal whose pay changes, and nothing with the same pay', () => {
    const errors: string[] = [];
    expect(contractBody(form({ ...monthly, payChange: 'changes', raiseReason: 'annual' }), errors, true, false)).toMatchObject({ raiseReason: 'annual' });
    expect(errors).toEqual([]);
    expect(contractBody(form({ ...monthly, payChange: 'same', raiseReason: 'annual' }), errors, true, false)).not.toHaveProperty('raiseReason');
    // a first contract has no question to answer
    expect(contractBody(form({ ...monthly, raiseReason: 'annual' }), errors, false, false)).not.toHaveProperty('raiseReason');
    expect(errors).toEqual([]);
  });

  it('asks why the pay changes when none is chosen', () => {
    const errors: string[] = [];
    const body = contractBody(form({ ...monthly, payChange: 'changes', raiseReason: '' }), errors, true, true);
    expect(errors).toEqual(['Choose why the pay changes: annual raise, performance raise, counter-offer raise, promotion, market adjustment, cost of living or other.']);
    expect(body).not.toHaveProperty('raiseReason');
    const unknown: string[] = [];
    contractBody(form({ ...monthly, payChange: 'changes', raiseReason: 'bonus' }), unknown, true, true);
    expect(unknown).toHaveLength(1);
  });
});

describe('the pay fields as the API takes them', () => {
  it('sends the pay alone, without the term or the note', () => {
    const errors: string[] = [];
    expect(payBody(form({ ...monthly, allowanceTypeId: 'a-1', allowanceAmount: '1,000' }), errors, false)).toEqual({
      payBasis: 'monthly',
      grossSalary: 15000,
      basicPercent: 80,
      netSalary: 12519.38,
      allowances: [{ allowanceTypeId: 'a-1', amount: 1000 }],
    });
    expect(errors).toEqual([]);
  });

  it('clears an emptied net and days on a draft only', () => {
    const errors: string[] = [];
    expect(payBody(form({ ...monthly, netSalary: '' }), errors, true)).toMatchObject({ daysPerWeek: null, netSalary: null });
    const fresh = payBody(form({ ...monthly, netSalary: '' }), errors, false);
    expect(fresh).not.toHaveProperty('netSalary');
    expect(fresh).not.toHaveProperty('daysPerWeek');
    expect(errors).toEqual([]);
  });
});

describe('the contract’s length by the labour law (18 October 2026)', () => {
  it('sends a fixed term’s months, fixed-term unless another is chosen', () => {
    const errors: string[] = [];
    expect(lengthBody(form({ form: 'fixed', durationMonths: '12' }), errors, false)).toEqual({ form: 'fixed', durationMonths: 12 });
    expect(lengthBody(form({ durationMonths: '6' }), errors, false)).toEqual({ form: 'fixed', durationMonths: 6 });
    expect(lengthBody(form({ form: 'permanent', durationMonths: '6' }), errors, false)).toEqual({ form: 'fixed', durationMonths: 6 });
    expect(errors).toEqual([]);
    const zero: string[] = [];
    lengthBody(form({ form: 'fixed', durationMonths: '0' }), zero, false);
    expect(zero).toEqual(['A fixed term runs for 1 to 60 months.']);
  });

  it('sends an open-ended contract with no length or end date (Art. 87)', () => {
    const errors: string[] = [];
    // the months typed before switching to open-ended are not sent
    expect(lengthBody(form({ form: 'open_ended', durationMonths: '12' }), errors, true)).toEqual({ form: 'open_ended' });
    expect(errors).toEqual([]);
  });

  it('sends a specific job’s job, with its expected end date when known (Art. 155)', () => {
    const errors: string[] = [];
    expect(lengthBody(form({ form: 'specific_job', jobToDo: ' Building the new website ', endDate: '31/3/2027', durationMonths: '12' }), errors, false)).toEqual({
      form: 'specific_job',
      jobToDo: 'Building the new website',
      endDate: '2027-03-31',
    });
    expect(lengthBody(form({ form: 'specific_job', jobToDo: 'Launch', endDate: '' }), errors, false)).toEqual({ form: 'specific_job', jobToDo: 'Launch' });
    // a draft's emptied expected end is cleared
    expect(lengthBody(form({ form: 'specific_job', jobToDo: 'Launch', endDate: '' }), errors, true)).toEqual({ form: 'specific_job', jobToDo: 'Launch', endDate: null });
    expect(errors).toEqual([]);
    const missing: string[] = [];
    lengthBody(form({ form: 'specific_job', jobToDo: '  ' }), missing, false);
    expect(missing).toEqual(['Enter the job the contract is for: a contract for a specific job ends when it is done (Labour Law Art. 155).']);
  });

  it('sends no training stages: the paid trainee went on 25 October 2026, a fixed term for its months alone', () => {
    const errors: string[] = [];
    const stages = { traineeStageName: ['Basics'], traineeStageMonths: ['3'], traineeStagePay: ['4,000'] };
    expect(lengthBody(form({ form: 'fixed', durationMonths: '6', ...stages }), errors, false)).toEqual({ form: 'fixed', durationMonths: 6 });
    expect(errors).toEqual([]);
  });
});

// owner, 19 October 2026: interns have no probation; an intern is unpaid; an agreement converts to full-time
describe('interns’ and converted contracts', () => {
  it('sends an intern’s agreement without a gross, a net or a basic part, its allowances on top', () => {
    const errors: string[] = [];
    const intern = { startDate: '1/11/2026', form: 'fixed', durationMonths: '3', probationMonths: '0', unpaid: '1', payBasis: 'monthly', daysPerWeek: '5', note: '' };
    const body = contractBody(form({ ...intern, allowanceTypeId: 'transport', allowanceAmount: '1,500' }), errors, false, false);
    expect(body).toEqual({
      startDate: '2026-11-01',
      form: 'fixed',
      durationMonths: 3,
      probationMonths: 0,
      payBasis: 'monthly',
      daysPerWeek: 5,
      allowances: [{ allowanceTypeId: 'transport', amount: 1500 }],
      note: '',
    });
    expect(body).not.toHaveProperty('grossSalary');
    expect(errors).toEqual([]);
    // a draft clears the net and an emptied number of days, still no gross
    expect(payBody(form({ unpaid: '1', payBasis: 'monthly', daysPerWeek: '' }), errors, true)).toEqual({
      payBasis: 'monthly',
      daysPerWeek: null,
      netSalary: null,
      allowances: [],
    });
    expect(errors).toEqual([]);
  });

  it('sends an intern’s probation as the form gives it: 0', () => {
    const errors: string[] = [];
    expect(contractBody(form({ ...monthly, probationMonths: '0' }), errors, false, false)).toMatchObject({ probationMonths: 0 });
    expect(errors).toEqual([]);
  });

  it('converts an agreement to full-time: its start date, probation and pay, with convertsTo and no reason', () => {
    const errors: string[] = [];
    const body = conversionBody(form({ ...monthly, startDate: '1/4/2027', probationMonths: '2', allowanceTypeId: 'transport', allowanceAmount: '1,500' }), errors);
    expect(body).toEqual({
      startDate: '2027-04-01',
      form: 'fixed',
      durationMonths: 12,
      probationMonths: 2,
      payBasis: 'monthly',
      grossSalary: 15000,
      basicPercent: 80,
      netSalary: 12519.38,
      allowances: [{ allowanceTypeId: 'transport', amount: 1500 }],
      note: 'Agreed on the phone',
      convertsTo: 'full_time',
    });
    expect(errors).toEqual([]);
    // the full-time gross is required
    const missing: string[] = [];
    conversionBody(form({ ...monthly, grossSalary: '' }), missing);
    expect(missing).toEqual(['Enter the gross salary, e.g. 15,000.']);
  });
});
