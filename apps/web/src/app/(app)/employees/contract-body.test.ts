import { describe, expect, it } from 'vitest';
import { contractBody, lengthBody, payBody } from './contract-body';

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

  it('sends a trainee’s training agreement: fixed-term for its stages’ months, with the stages (Art. 29)', () => {
    const errors: string[] = [];
    const stages = { traineeStageName: ['Basics', 'Practice'], traineeStageMonths: ['3', '9'], traineeStagePay: ['4,000', '6,000'] };
    expect(lengthBody(form({ form: 'fixed', durationMonths: '24', ...stages }), errors, false)).toEqual({
      form: 'fixed',
      durationMonths: 12,
      traineeStages: [
        { name: 'Basics', months: 3, pay: 4000 },
        { name: 'Practice', months: 9, pay: 6000 },
      ],
    });
    expect(errors).toEqual([]);
    // the whole contract: the stages go with the pay
    expect(contractBody(form({ ...monthly, ...stages }), errors, false, false)).toMatchObject({ form: 'fixed', durationMonths: 12, traineeStages: expect.any(Array) });
    expect(errors).toEqual([]);
    const falling: string[] = [];
    lengthBody(form({ traineeStageName: ['Basics', 'Practice'], traineeStageMonths: ['3', ''], traineeStagePay: ['6000', '4000'] }), falling, false);
    expect(falling).toEqual([
      'Training stage 2’s length must be a whole number of months, 1 or more.',
      expect.stringMatching(/^Training stage 2’s pay must be more than stage 1’s/),
    ]);
  });
});
