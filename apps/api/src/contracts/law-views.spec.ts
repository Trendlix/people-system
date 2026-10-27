import { Prisma } from '../generated/prisma/client.js';
import { employmentView } from '../employees/employees.service.js';
import {
  agreementNumber,
  agreementVersions,
  ART_154_NOTE,
  art154Estimate,
  contractBecameOpenEnded,
  contractView,
  employmentCasualTooLong,
  endingView,
  lawFieldsOf,
  type ContractRow,
  type EndingRow,
} from './views.js';

// Employment types by the labour law in the API's views (owner, 18 October 2026: "can we update the employment types
// based on the labour law?"): the warnings (Labour Law 14/2025 Art. 88(3), Art. 1(7)) and Art. 154's note on a fixed term
// the company doesn't renew. Everyone here is invented.

const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

function contract(over: Partial<ContractRow> = {}): ContractRow {
  return {
    id: 'c-1',
    number: 'CON-2025-0001',
    employmentId: 'emp-1',
    version: 1,
    form: 'fixed',
    jobToDo: null,
    startDate: day('2025-01-01'),
    endDate: day('2025-12-31'),
    durationMonths: 12,
    probationMonths: 0,
    probationEnd: null,
    grossSalary: new Prisma.Decimal(10000),
    basicPercent: 80,
    netSalary: null,
    insuredSalary: new Prisma.Decimal(10000),
    payBasis: 'monthly',
    hourlyRate: null,
    hoursPerWeek: null,
    hourlyMinimum: null,
    daysPerWeek: null,
    allowances: [],
    jobTitleEn: null,
    jobTitleAr: null,
    gradeCode: null,
    departmentName: null,
    shiftCode: null,
    status: 'active',
    signedOn: day('2025-01-01'),
    insuranceFiledOn: null,
    labourOfficeFiledOn: null,
    note: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    kind: 'contract',
    raiseReason: null,
    approval: null,
    sentAt: null,
    approvedById: null,
    approvedBy: null,
    approvedAt: null,
    returnedReason: null,
    newJobTitleId: null,
    newJobTitle: null,
    newGradeId: null,
    newGrade: null,
    form2From: null,
    raiseRequest: null,
    convertsTo: null,
    ...over,
  } as ContractRow;
}

const CTX = { seesSalary: true, workingDays: null, nonRenewal: null };

describe('the fixed term become open-ended (Art. 88(3))', () => {
  it('is warned of for a signed fixed term past its end while the employment goes on', () => {
    expect(contractBecameOpenEnded(contract(), null, '2026-01-01')).toBe(true);
    expect(contractView(contract(), CTX).becameOpenEnded).toBe(true);
  });

  it('is not on its last day, once the employment ended, for a draft or replaced version, nor for the other lengths', () => {
    expect(contractBecameOpenEnded(contract(), null, '2025-12-31')).toBe(false);
    expect(contractBecameOpenEnded(contract(), day('2026-02-01'), '2026-03-01')).toBe(false);
    expect(contractBecameOpenEnded(contract({ status: 'superseded' }), null, '2026-03-01')).toBe(false);
    expect(contractBecameOpenEnded(contract({ status: 'draft' }), null, '2026-03-01')).toBe(false);
    expect(contractBecameOpenEnded(contract({ form: 'open_ended', endDate: null, durationMonths: null }), null, '2026-03-01')).toBe(false);
    expect(contractBecameOpenEnded(contract({ form: 'specific_job', jobToDo: 'The website' }), null, '2026-03-01')).toBe(false);
    expect(contractView(contract(), { ...CTX, employmentEndDate: day('2025-12-31') }).becameOpenEnded).toBe(false);
  });
});

describe('casual work past six months (Art. 1(7))', () => {
  it('counts from the join date to today, or to the day the employment ended', () => {
    const e = { workNature: 'casual', joinDate: day('2026-01-01'), endDate: null };
    expect(employmentCasualTooLong(e, '2026-06-30')).toBe(false);
    expect(employmentCasualTooLong(e, '2026-07-01')).toBe(true);
    expect(employmentCasualTooLong({ ...e, endDate: day('2026-06-30') }, '2026-10-01')).toBe(false);
    expect(employmentCasualTooLong({ ...e, workNature: 'seasonal' }, '2027-01-01')).toBe(false);
  });

  it('comes with the nature of the work, remote work and the commission', () => {
    expect(lawFieldsOf({ workArrangement: 'hybrid', paidByCommission: true, workNature: 'regular', joinDate: day('2026-01-01'), endDate: null })).toEqual({
      paidByCommission: true,
      workNature: 'regular',
      workPattern: 'partly_remote',
      casualTooLong: false,
    });
  });

  it('is on the profile’s employment, with the law’s fields', () => {
    const view = employmentView(
      {
        id: 'emp-1',
        employeeId: 'e-1',
        employmentType: 'freelance',
        status: 'active',
        joinDate: day('2025-01-01'),
        probationEnd: null,
        jdAcknowledgedAt: null,
        endDate: null,
        officeDays: [],
        shift: null,
        contracts: [contract()],
        endings: [],
        jobTitle: null,
        workArrangement: 'wfh',
        workNature: 'casual',
        paidByCommission: false,
      } as unknown as Parameters<typeof employmentView>[0],
      { seesSalary: true, seesEndings: true, nonRenewal: null },
    );
    expect(view).toMatchObject({ underLabourLaw: false, workPattern: 'remote', workNature: 'casual', casualTooLong: true, becameOpenEnded: true, paidByCommission: false });
  });
});

// the paid trainee's training stages went on 25 October 2026 (owner: "unpaid internship and training are the same thing")
describe('a contract without training stages', () => {
  it('shows none of the trainee’s fields any more', () => {
    const view = contractView(contract(), CTX);
    expect(view).not.toHaveProperty('traineeStages');
    expect(view).not.toHaveProperty('traineeMonths');
    expect(view).not.toHaveProperty('traineeStage');
  });
});

describe('a fixed term the company doesn’t renew (Art. 154)', () => {
  function ending(over: Partial<EndingRow> = {}): EndingRow {
    return {
      id: 'end-1',
      employmentId: 'emp-1',
      ruleKey: 'non_renewal',
      initiator: 'company',
      noticeGivenOn: day('2026-10-01'),
      payInLieu: false,
      lastWorkingDay: day('2026-12-31'),
      certifiedOffice: null,
      certifiedSerial: null,
      certifiedOn: null,
      decisionDueOn: null,
      reason: null,
      note: null,
      status: 'pending_ceo',
      hrApprovedById: null,
      hrApprovedBy: null,
      hrApprovedAt: null,
      ceoDecidedById: null,
      ceoDecidedBy: null,
      ceoDecidedAt: null,
      ceoNote: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      rule: { label: 'Fixed term not renewed', endReason: 'contract_ended' },
      employment: {
        employmentType: 'full_time',
        endDate: null,
        joinDate: day('2024-01-01'),
        contracts: [{ grossSalary: new Prisma.Decimal(12000), allowances: [{ amount: new Prisma.Decimal(1000) }] }],
      },
      ...over,
    } as EndingRow;
  }

  it('carries the note and the estimate: years of service × the last monthly wage, information only', () => {
    expect(art154Estimate(ending(), true)).toEqual({ serviceYears: 3, lastMonthlyWage: 13000, amount: 39000 });
    const view = endingView(ending(), true);
    expect(view.art154Note).toBe(ART_154_NOTE);
    expect(view.art154Note).toBe("Under Art. 154 the employee may be owed one month's wage for each year of service — check with your lawyer");
    expect(view.art154Estimate).toEqual({ serviceYears: 3, lastMonthlyWage: 13000, amount: 39000 });
  });

  it('counts part of a year in whole months, and hides the amounts from those who don’t see salaries', () => {
    const shorter = ending({ lastWorkingDay: day('2025-06-30') });
    expect(art154Estimate(shorter, true)).toEqual({ serviceYears: 1.5, lastMonthlyWage: 13000, amount: 19500 });
    expect(endingView(shorter).art154Estimate).toEqual({ serviceYears: 1.5, lastMonthlyWage: null, amount: null });
  });

  it('is only for the non-renewal ending', () => {
    expect(endingView(ending({ ruleKey: 'resignation' }), true)).toMatchObject({ art154Note: null, art154Estimate: null });
  });

  it('is never an intern’s, whose agreement isn’t an employment contract (19 October 2026)', () => {
    const e = ending();
    expect(endingView({ ...e, employment: { ...e.employment, employmentType: 'intern' } }, true)).toMatchObject({ art154Note: null, art154Estimate: null });
  });
});

// Interns (owner, 19 October 2026: "or can be only renewed 1 time, after that it should be converted to a full time
// contract"): which versions are an employment's agreements, and how one is shown.
describe('an intern’s agreement in the views', () => {
  const versions = [
    { version: 1, kind: 'contract', convertsTo: null },
    { version: 2, kind: 'contract', convertsTo: null },
    { version: 3, kind: 'contract', convertsTo: 'full_time' },
  ];

  it('is a whole contract of an intern’s employment, a conversion to full-time and salary amendments left out', () => {
    expect(agreementVersions('intern', versions)).toEqual([1, 2]);
    expect(agreementVersions('intern', [...versions, { version: 4, kind: 'amendment', convertsTo: null }].reverse())).toEqual([1, 2]);
    // a trainee is no type any more (25 October 2026): no agreements
    expect(agreementVersions('trainee', versions)).toBeNull();
    expect(agreementVersions('full_time', versions)).toBeNull();
    expect(agreementVersions('freelance', versions)).toBeNull();
    expect(agreementNumber({ version: 1, kind: 'contract', convertsTo: null }, [1, 2])).toBe(1);
    expect(agreementNumber({ version: 2, kind: 'contract', convertsTo: null }, [1, 2])).toBe(2);
    expect(agreementNumber({ version: 3, kind: 'contract', convertsTo: 'full_time' }, [1, 2])).toBe(0);
    expect(agreementNumber({ version: 1, kind: 'contract', convertsTo: null }, null)).toBe(0);
  });

  it('says which agreement it is and what follows it, with no non-renewal notice and no Art. 88 warning', () => {
    const past = contract();
    const first = contractView(past, { ...CTX, agreements: [1] });
    expect(first).toMatchObject({ training: { agreement: 1, next: 'renew_or_convert' }, nonRenewalNoticeBy: null, becameOpenEnded: false, convertsTo: null });
    const renewal = contractView(contract({ version: 2 }), { ...CTX, agreements: [1, 2] });
    expect(renewal.training).toEqual({ agreement: 2, next: 'convert_or_end' });
    // the same contract as a full-time employment's: the fixed term's reminders as before
    const fullTime = contractView(past, CTX);
    expect(fullTime.training).toBeNull();
    expect(fullTime.nonRenewalNoticeBy).not.toBeNull();
    expect(fullTime.becameOpenEnded).toBe(true);
  });

  it('shows a conversion to full-time as such, not as an agreement', () => {
    const conversion = contractView(contract({ version: 3, convertsTo: 'full_time', probationMonths: 3, probationEnd: day('2025-03-31') }), { ...CTX, agreements: [1, 2] });
    expect(conversion).toMatchObject({ convertsTo: 'full_time', training: null, probationMonths: 3, probationEnd: '2025-03-31' });
    expect(conversion.nonRenewalNoticeBy).not.toBeNull();
  });
});
