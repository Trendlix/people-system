import { CONTRACT_SOON_DAYS, CONTRACT_STATES, contractStatusOf, type ContractFacts, type ContractStatusInput } from '@trendlix/shared';

// The contract status in the Employees list, in place of the employee code (owner, 21 October 2026: "instead of the Emp
// code, add contract status"; "State + end date"): packages/shared contract-status.ts. Today is 21/10/2026 throughout.

const TODAY = '2026-10-21';

const signed = (over: Partial<ContractFacts> = {}): ContractFacts => ({ status: 'active', form: 'fixed', startDate: '2026-01-01', endDate: '2026-12-31', ...over });

/** A current full-time employment, active, joined 1 January 2026, with a signed fixed term to 31 December 2026. */
function current(over: Partial<NonNullable<ContractStatusInput['employment']>> = {}): ContractStatusInput {
  return {
    employment: { employmentType: 'full_time', status: 'active', joinDate: '2026-01-01', probationEnd: '2026-03-31', contract: signed(), endingOn: null, ...over },
    leftOn: null,
  };
}

const status = (input: ContractStatusInput) => contractStatusOf(input, TODAY);

describe('the contract status of a labour contract', () => {
  it('names every state', () => {
    expect(CONTRACT_STATES).toEqual(['signed', 'starts', 'probation', 'draft', 'ending', 'ended', 'no_contract', 'freelance', 'left', 'no_employment']);
    expect(CONTRACT_SOON_DAYS).toBe(30);
  });

  it('is signed with its end date, in force', () => {
    expect(status(current())).toEqual({ state: 'signed', text: 'Signed · ends 31/12/2026', endsOn: '2026-12-31', tone: 'ok' });
    // part-time is a labour contract too
    expect(status(current({ employmentType: 'part_time' }))).toMatchObject({ text: 'Signed · ends 31/12/2026', tone: 'ok' });
  });

  it('turns amber within 30 days of the end, saying when', () => {
    expect(status(current({ contract: signed({ endDate: '2026-11-05' }) }))).toEqual({
      state: 'signed',
      text: 'Signed · ends 05/11/2026 (in 15 days)',
      endsOn: '2026-11-05',
      tone: 'warn',
    });
    expect(status(current({ contract: signed({ endDate: '2026-11-20' }) }))).toMatchObject({ text: 'Signed · ends 20/11/2026 (in 30 days)', tone: 'warn' });
    expect(status(current({ contract: signed({ endDate: '2026-11-21' }) }))).toMatchObject({ text: 'Signed · ends 21/11/2026', tone: 'ok' }); // 31 days
    expect(status(current({ contract: signed({ endDate: '2026-10-22' }) }))).toMatchObject({ text: 'Signed · ends 22/10/2026 (tomorrow)', tone: 'warn' });
    expect(status(current({ contract: signed({ endDate: TODAY }) }))).toMatchObject({ text: 'Signed · ends 21/10/2026 (today)', tone: 'warn' });
  });

  it('is open-ended or for a specific job when signed without an end date', () => {
    expect(status(current({ contract: signed({ form: 'open_ended', endDate: null }) }))).toEqual({ state: 'signed', text: 'Signed · open-ended', endsOn: null, tone: 'ok' });
    expect(status(current({ contract: signed({ form: 'specific_job', endDate: null }) }))).toEqual({ state: 'signed', text: 'Signed · for a specific job', endsOn: null, tone: 'ok' });
    // a specific job with its expected end reads as any end
    expect(status(current({ contract: signed({ form: 'specific_job', endDate: '2027-03-31' }) }))).toMatchObject({ text: 'Signed · ends 31/03/2027' });
  });

  it('is on probation until the probation end, while it runs', () => {
    const probation = current({ status: 'probation', joinDate: '2026-10-16', probationEnd: '2027-01-15', contract: signed({ startDate: '2026-10-16', endDate: '2027-10-15' }) });
    expect(status(probation)).toEqual({ state: 'probation', text: 'On probation until 15/01/2027', endsOn: '2027-01-15', tone: 'ok' });
    // in amber within 30 days
    expect(status(current({ status: 'probation', probationEnd: '2026-11-05' }))).toEqual({
      state: 'probation',
      text: 'On probation until 05/11/2026 (in 15 days)',
      endsOn: '2026-11-05',
      tone: 'warn',
    });
    // past the probation end and not confirmed yet (the Standing column says Probation): the contract's end
    expect(status(current({ status: 'probation', probationEnd: '2026-10-20' }))).toMatchObject({ state: 'signed', text: 'Signed · ends 31/12/2026' });
    // confirmed early: Active, the contract's end
    expect(status(current({ status: 'active', probationEnd: '2027-01-15' }))).toMatchObject({ state: 'signed' });
  });

  it('starts later for a new joiner whose first day is still ahead', () => {
    const joiner = current({ status: 'probation', joinDate: '2026-11-01', probationEnd: '2027-01-31', contract: signed({ startDate: '2026-11-01', endDate: '2027-10-31' }) });
    expect(status(joiner)).toEqual({ state: 'starts', text: 'Signed · starts 01/11/2026', endsOn: '2027-10-31', tone: 'ok' });
    // a renewal signed ahead of its start, the employment going on: its end
    expect(status(current({ contract: signed({ startDate: '2027-01-01', endDate: '2027-12-31' }) }))).toMatchObject({ state: 'signed', text: 'Signed · ends 31/12/2027' });
  });

  it('is a draft, not signed', () => {
    expect(status(current({ contract: signed({ status: 'draft' }) }))).toEqual({ state: 'draft', text: 'Draft, not signed', endsOn: null, tone: 'muted' });
  });

  it('is ending with the notice of an approved ending, whatever the contract', () => {
    expect(status(current({ status: 'notice_period', endingOn: '2026-11-30' }))).toEqual({ state: 'ending', text: 'Ending 30/11/2026 (notice)', endsOn: '2026-11-30', tone: 'ok' });
    expect(status(current({ status: 'notice_period', endingOn: '2026-11-05' }))).toEqual({
      state: 'ending',
      text: 'Ending 05/11/2026 (notice, in 15 days)',
      endsOn: '2026-11-05',
      tone: 'warn',
    });
    // the last working day passed, HR still to complete it
    expect(status(current({ status: 'notice_period', endingOn: '2026-10-15' }))).toMatchObject({ text: 'Ending 15/10/2026 (notice, passed)', tone: 'warn' });
    // even without a contract, or on probation
    expect(status(current({ contract: null, endingOn: '2027-01-21' }))).toMatchObject({ state: 'ending', text: 'Ending 21/01/2027 (notice)' });
  });

  it('has ended once its end date passed, the employment going on, in amber', () => {
    expect(status(current({ contract: signed({ endDate: '2026-09-30' }) }))).toEqual({ state: 'ended', text: 'Ended 30/09/2026', endsOn: '2026-09-30', tone: 'warn' });
    // an ended or replaced version: nothing in force
    expect(status(current({ contract: signed({ status: 'ended', endDate: '2026-09-30' }) }))).toEqual({ state: 'ended', text: 'Ended 30/09/2026', endsOn: '2026-09-30', tone: 'muted' });
    expect(status(current({ contract: signed({ status: 'superseded', endDate: null }) }))).toMatchObject({ state: 'ended', text: 'Ended' });
  });

  it('is no contract for a current employment without one', () => {
    expect(status(current({ contract: null }))).toEqual({ state: 'no_contract', text: 'No contract', endsOn: null, tone: 'muted' });
  });
});

describe('the contract status without a current employment', () => {
  it('says when they left, or that they were never employed', () => {
    expect(status({ employment: null, leftOn: '2026-09-30' })).toEqual({ state: 'left', text: 'Left on 30/09/2026', endsOn: '2026-09-30', tone: 'muted' });
    expect(status({ employment: null, leftOn: null })).toEqual({ state: 'no_employment', text: 'No employment', endsOn: null, tone: 'muted' });
  });
});

describe('the contract status outside an employment contract', () => {
  it('is no labour contract for freelance, whatever is on file', () => {
    for (const contract of [null, signed(), signed({ status: 'draft' })]) {
      expect(status(current({ employmentType: 'freelance', contract }))).toEqual({ state: 'freelance', text: 'Freelance: no labour contract', endsOn: null, tone: 'muted' });
    }
  });

  it('is the training agreement for a trainee, never probation', () => {
    const trainee = (over: Partial<NonNullable<ContractStatusInput['employment']>> = {}) => current({ employmentType: 'trainee', probationEnd: null, ...over });
    expect(status(trainee())).toEqual({ state: 'signed', text: 'Training agreement · ends 31/12/2026', endsOn: '2026-12-31', tone: 'ok' });
    expect(status(trainee({ status: 'probation', probationEnd: '2027-01-15' }))).toMatchObject({ state: 'signed', text: 'Training agreement · ends 31/12/2026' });
    expect(status(trainee({ contract: signed({ endDate: '2026-11-05' }) }))).toMatchObject({ text: 'Training agreement · ends 05/11/2026 (in 15 days)', tone: 'warn' });
    expect(status(trainee({ contract: signed({ endDate: '2026-09-30' }) }))).toMatchObject({ state: 'ended', text: 'Training agreement · ended 30/09/2026', tone: 'warn' });
    expect(status(trainee({ contract: signed({ status: 'draft' }) }))).toMatchObject({ state: 'draft', text: 'Training agreement · draft, not signed', tone: 'muted' });
    expect(status(trainee({ contract: null }))).toMatchObject({ state: 'no_contract', text: 'No training agreement', tone: 'muted' });
    expect(status(trainee({ joinDate: '2026-11-01', contract: signed({ startDate: '2026-11-01' }) }))).toMatchObject({ state: 'starts', text: 'Training agreement · starts 01/11/2026' });
  });

  it('is the unpaid internship for an intern', () => {
    const intern = (over: Partial<NonNullable<ContractStatusInput['employment']>> = {}) => current({ employmentType: 'intern', probationEnd: null, ...over });
    expect(status(intern({ contract: signed({ endDate: '2027-01-15' }) }))).toEqual({ state: 'signed', text: 'Unpaid internship · ends 15/01/2027', endsOn: '2027-01-15', tone: 'ok' });
    expect(status(intern({ contract: signed({ endDate: '2026-11-05' }) }))).toMatchObject({ text: 'Unpaid internship · ends 05/11/2026 (in 15 days)', tone: 'warn' });
    expect(status(intern({ contract: signed({ status: 'draft' }) }))).toMatchObject({ text: 'Unpaid internship · draft, not signed' });
    expect(status(intern({ contract: null }))).toMatchObject({ state: 'no_contract', text: 'Unpaid internship · no agreement', tone: 'muted' });
  });
});

describe('today', () => {
  it('is Cairo’s when not given', () => {
    const cairo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
    expect(contractStatusOf(current({ contract: signed({ endDate: cairo }) }))).toMatchObject({ text: `Signed · ends ${cairo.slice(8, 10)}/${cairo.slice(5, 7)}/${cairo.slice(0, 4)} (today)` });
  });
});
