import { describe, expect, it } from 'vitest';
import type { OfferView } from '../../../lib/types';
import {
  answerBody,
  emailSendBody,
  extendBody,
  internMonthsOf,
  newOfferDefaults,
  offerBody,
  offerDefaults,
  recordSentBody,
  sentOfferBody,
  submitted,
  withdrawBody,
} from './form-body';

/** A submitted form: each entry once, or a list for repeated fields. */
function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) for (const v of Array.isArray(value) ? value : [value]) fd.append(key, v);
  return fd;
}

const filled = {
  fullNameEn: ' Omar Khaled Mahmoud ',
  fullNameAr: 'عمر خالد محمود',
  email: ' Omar.Khaled@Gmail.com ',
  mobile: '+201012345678',
  employeeId: '',
  employmentType: 'full_time',
  departmentId: 'dep-1',
  jobTitleId: 'title-1',
  gradeId: '',
  managerId: 'mgr-1',
  shiftId: '',
  workArrangement: 'office',
  joinDate: '1/11/2026',
  payBasis: 'monthly',
  salaryBasis: 'gross',
  grossSalary: '15,000',
  daysPerWeek: '',
  basicPercent: '80',
  netSalary: '12519.38',
  probationMonths: '3',
  durationMonths: '12',
  expiresOn: '22/10/2026',
  message: 'We enjoyed meeting you.',
  note: '',
};

const allowances = [{ allowanceTypeId: 'a-1', amount: 1000 }];

describe('a new offer', () => {
  it('is sent as the API takes it', () => {
    const errors: string[] = [];
    const body = offerBody(form(filled), errors, { draft: false, allowances });
    expect(errors).toEqual([]);
    expect(body).toEqual({
      fullNameEn: 'Omar Khaled Mahmoud',
      fullNameAr: 'عمر خالد محمود',
      email: 'omar.khaled@gmail.com',
      mobile: '+201012345678',
      employeeId: undefined,
      employmentType: 'full_time',
      paidByCommission: false,
      workNature: 'regular',
      departmentId: 'dep-1',
      jobTitleId: 'title-1',
      gradeId: undefined,
      managerId: 'mgr-1',
      shiftId: undefined,
      workArrangement: 'office',
      officeDays: [],
      joinDate: '2026-11-01',
      payBasis: 'monthly',
      grossSalary: 15000,
      hourlyRate: undefined,
      hoursPerWeek: undefined,
      daysPerWeek: undefined,
      basicPercent: 80,
      netSalary: 12519.38,
      probationMonths: 3,
      durationMonths: 12,
      allowances,
      expiresOn: '2026-10-22',
      message: 'We enjoyed meeting you.',
      note: '',
    });
    // left out of the JSON: the API's defaults apply
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('gradeId');
  });

  it('sends paid by commission for a full-time offer only, and the nature of the work (18 October 2026)', () => {
    const errors: string[] = [];
    expect(offerBody(form({ ...filled, paidByCommission: 'on', workNature: 'seasonal' }), errors, { draft: false, allowances })).toMatchObject({
      employmentType: 'full_time',
      paidByCommission: true,
      workNature: 'seasonal',
    });
    // another type: never by commission, even if the box came along
    expect(offerBody(form({ ...filled, employmentType: 'part_time', paidByCommission: 'on' }), errors, { draft: false, allowances })).toMatchObject({
      paidByCommission: false,
      workNature: 'regular',
    });
    expect(errors).toEqual([]);
    expect(newOfferDefaults(null, '2026-10-15')).toMatchObject({ paidByCommission: false, workNature: 'regular' });
  });

  it('says what is missing or wrong', () => {
    const errors: string[] = [];
    offerBody(
      form({ ...filled, fullNameEn: '', fullNameAr: ' ', email: 'not-an-email', employmentType: '', joinDate: '', grossSalary: '', probationMonths: '4' }),
      errors,
      { draft: false, allowances: [] },
    );
    expect(errors).toEqual([
      "Enter the candidate's full name in English.",
      "Enter the candidate's full name in Arabic, as on their national ID.",
      'Enter a valid email address, e.g. name@example.com.',
      'Choose the employment type.',
      'Enter the join date, e.g. 14/10/2026.',
      'Enter the gross salary, e.g. 15,000.',
      'Enter the probation as a whole number of months, from 0 to 3.',
    ]);
  });

  it('asks for the net when the gross was to be worked out from it', () => {
    const errors: string[] = [];
    offerBody(form({ ...filled, salaryBasis: 'net', wantedNet: 'abc', grossSalary: '' }), errors, { draft: false, allowances: [] });
    expect(errors).toEqual(['Enter the net salary wanted as an amount in EGP, e.g. 13,000.']);
  });

  it('keeps the office days of a hybrid arrangement only, and needs one', () => {
    const errors: string[] = [];
    const hybrid = offerBody(form({ ...filled, workArrangement: 'hybrid', officeDays: ['0', '3', '9'] }), errors, { draft: false, allowances: [] });
    expect(hybrid.officeDays).toEqual([0, 3]);
    expect(offerBody(form({ ...filled, officeDays: ['1'] }), errors, { draft: false, allowances: [] }).officeDays).toEqual([]);
    expect(errors).toEqual([]);
    offerBody(form({ ...filled, workArrangement: 'hybrid' }), errors, { draft: false, allowances: [] });
    expect(errors).toEqual(['Pick at least one office day for a hybrid arrangement.']);
  });
});

// owner, 19 October 2026: interns have no probation; an intern is unpaid, for a short term
describe('an intern’s offer', () => {
  it('sends an intern’s monthly, with no gross, net or basic part, no probation, and its allowances', () => {
    const errors: string[] = [];
    const intern = { ...filled, employmentType: 'intern', payBasis: 'hourly', grossSalary: '', netSalary: '', probationMonths: '0', durationMonths: '3' };
    const body = offerBody(form(intern), errors, { draft: false, allowances });
    expect(errors).toEqual([]);
    expect(body).toMatchObject({ employmentType: 'intern', payBasis: 'monthly', probationMonths: 0, durationMonths: 3, allowances });
    expect(body).not.toHaveProperty('grossSalary');
    expect(body).not.toHaveProperty('basicPercent');
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('netSalary');
    // a draft clears the net
    expect(offerBody(form(intern), errors, { draft: true, allowances })).toMatchObject({ netSalary: null, hourlyRate: null, hoursPerWeek: null });
  });

  it('keeps an intern’s agreement to 12 months', () => {
    const errors: string[] = [];
    offerBody(form({ ...filled, employmentType: 'intern', grossSalary: '', durationMonths: '13' }), errors, { draft: false, allowances: [] });
    expect(errors).toEqual(['An internship agreement is short: 1 to 12 months (3 unless you choose another).']);
  });

  it('starts an internship at 3 months, or the draft’s own', () => {
    expect(internMonthsOf({ employmentType: 'full_time', durationMonths: 12 })).toBe(3);
    expect(internMonthsOf({ employmentType: 'intern', durationMonths: 6 })).toBe(6);
  });
});

describe('pay by the hour', () => {
  const hourly = { ...filled, payBasis: 'hourly', hourlyRate: '150', hoursPerWeek: '20', grossSalary: '13000', daysPerWeek: '3' };

  it('sends the rate, the hours and the monthly estimate as the gross', () => {
    const errors: string[] = [];
    const body = offerBody(form(hourly), errors, { draft: false, allowances: [] });
    expect(errors).toEqual([]);
    expect(body).toMatchObject({ payBasis: 'hourly', hourlyRate: 150, hoursPerWeek: 20, grossSalary: 13000, daysPerWeek: 3 });
  });

  it('needs the rate and the hours', () => {
    const errors: string[] = [];
    offerBody(form({ ...hourly, hourlyRate: '', hoursPerWeek: '', grossSalary: '' }), errors, { draft: false, allowances: [] });
    expect(errors).toEqual(['Enter the hourly rate, e.g. 150.', 'Enter the hours a week, e.g. 20.']);
  });

  it('sends the gross rate worked out from the net per hour', () => {
    const errors: string[] = [];
    const fromNet = { ...hourly, rateBasis: 'net', netRate: '120', hourlyRate: '144.59', hoursPerWeek: '16', grossSalary: '10024.91', netSalary: '8320.33' };
    const body = offerBody(form(fromNet), errors, { draft: false, allowances: [] });
    expect(errors).toEqual([]);
    expect(body).toMatchObject({ payBasis: 'hourly', hourlyRate: 144.59, hoursPerWeek: 16, grossSalary: 10024.91, netSalary: 8320.33 });
    // the net rate and the switch are kept only for a refused save
    expect(body).not.toHaveProperty('netRate');
    expect(body).not.toHaveProperty('rateBasis');
  });

  it('asks for the net per hour when the gross rate was to be worked out from it', () => {
    const errors: string[] = [];
    offerBody(form({ ...hourly, rateBasis: 'net', netRate: 'abc', hourlyRate: '', grossSalary: '' }), errors, { draft: false, allowances: [] });
    expect(errors).toEqual(['Enter the net per hour as an amount in EGP, e.g. 120.']);
  });

  it('keeps the hours within the legal working week', () => {
    const errors: string[] = [];
    expect(offerBody(form({ ...hourly, hoursPerWeek: '60' }), errors, { draft: false, allowances: [] }).hoursPerWeek).toBeNull();
    expect(errors).toEqual(['Enter the hours a week as a number up to 48, the legal working week, e.g. 20 or 22.5.']);
  });

  it('checks the days a week', () => {
    const errors: string[] = [];
    // at most 6, as the server allows (the legal working week)
    offerBody(form({ ...hourly, daysPerWeek: '7' }), errors, { draft: false, allowances: [] });
    expect(errors).toEqual(['Enter the working days a week as a whole number from 1 to 6, e.g. 3.']);
  });
});

describe('changing a draft', () => {
  it('clears what was emptied, and the other pay basis', () => {
    const errors: string[] = [];
    const body = offerBody(form({ ...filled, departmentId: '', mobile: '', netSalary: '' }), errors, { draft: true, allowances: [] });
    expect(errors).toEqual([]);
    expect(body).toMatchObject({
      departmentId: null,
      mobile: null,
      gradeId: null,
      employeeId: null,
      hourlyRate: null,
      hoursPerWeek: null,
      daysPerWeek: null,
      netSalary: null,
      allowances: [],
    });
  });
});

describe('the small forms', () => {
  it('changes only the last day and the note of a sent offer', () => {
    const errors: string[] = [];
    expect(sentOfferBody(form({ expiresOn: '29/10/2026', note: ' Called on Sunday ', fullNameEn: 'x' }), errors)).toEqual({
      expiresOn: '2026-10-29',
      note: 'Called on Sunday',
    });
    expect(errors).toEqual([]);
    sentOfferBody(form({ expiresOn: '' }), errors);
    expect(errors).toEqual(['Enter the last day to accept, e.g. 14/10/2026.']);
  });

  it('extends to a real date', () => {
    const errors: string[] = [];
    expect(extendBody(form({ expiresOn: '5.11.2026' }), errors)).toEqual({ expiresOn: '2026-11-05' });
    extendBody(form({ expiresOn: '31/02/2026' }), errors);
    expect(errors).toEqual(['Enter the new last day to accept as DD/MM/YYYY, e.g. 14/10/2026.']);
  });

  it('withdraws with a reason only when given', () => {
    expect(withdrawBody(form({ reason: ' Position filled ' }))).toEqual({ reason: 'Position filled' });
    expect(withdrawBody(form({ reason: '  ' }))).toEqual({});
  });

  it('records accepted or declined, nothing else', () => {
    const errors: string[] = [];
    expect(answerBody(form({ answer: 'declined', reason: 'Another offer' }), errors)).toEqual({ answer: 'declined', reason: 'Another offer' });
    expect(answerBody(form({ answer: 'accepted', reason: '' }), errors)).toEqual({ answer: 'accepted' });
    expect(errors).toEqual([]);
    answerBody(form({ answer: 'maybe' }), errors);
    expect(errors).toEqual(['Choose whether the candidate accepted or declined.']);
  });

  it("an earlier offer's answer with the day it was given, today when left empty (25 October 2026)", () => {
    const errors: string[] = [];
    expect(answerBody(form({ answer: 'accepted', answeredOn: '22/09/2026' }), errors)).toEqual({ answer: 'accepted', answeredOn: '2026-09-22' });
    expect(answerBody(form({ answer: 'declined', answeredOn: ' ' }), errors)).toEqual({ answer: 'declined' });
    expect(errors).toEqual([]);
    answerBody(form({ answer: 'accepted', answeredOn: '31/09/2026' }), errors);
    expect(errors).toEqual(['Enter the day of the answer as DD/MM/YYYY, e.g. 14/10/2026.']);
  });

  it('records as sent earlier on the day typed (25 October 2026)', () => {
    const errors: string[] = [];
    expect(recordSentBody(form({ sentOn: '20/9/2026' }), errors)).toEqual({ sentOn: '2026-09-20' });
    expect(errors).toEqual([]);
    recordSentBody(form({ sentOn: '' }), errors);
    expect(errors).toEqual(['Enter the day the offer was sent, e.g. 14/10/2026.']);
  });

  it('sends by email to a valid address', () => {
    const errors: string[] = [];
    expect(emailSendBody(form({ to: ' Omar@Gmail.com ' }), 'https://people.trendlix.com', errors)).toEqual({
      via: 'email',
      origin: 'https://people.trendlix.com',
      to: 'omar@gmail.com',
    });
    emailSendBody(form({ to: '' }), 'https://people.trendlix.com', errors);
    expect(errors).toEqual(['Enter the email address to send the offer to.']);
  });

  it('keeps what was typed, lists for repeated fields', () => {
    expect(submitted(form({ name: 'Omar', officeDays: ['0', '2'], $ACTION_ID_x: '1' }))).toEqual({ name: 'Omar', officeDays: ['0', '2'] });
  });
});

describe('what the form starts with', () => {
  it('opens a new offer for 7 days, with the contract settings', () => {
    const d = newOfferDefaults({ probationMonths: 2, durationMonths: 24 }, '2026-10-15');
    expect(d).toMatchObject({ expiresOn: '2026-10-22', probationMonths: 2, durationMonths: 24, payBasis: 'monthly', basicPercent: 80, workArrangement: 'office' });
    expect(newOfferDefaults(null, '2026-12-28')).toMatchObject({ expiresOn: '2027-01-04', probationMonths: 3, durationMonths: 12 });
    // the basic share of the gross set on Payroll Setup (16 October 2026)
    expect(newOfferDefaults({ probationMonths: 3, durationMonths: 12, basicPercentDefault: 75 }, '2026-10-15').basicPercent).toBe(75);
  });

  it("takes a draft's values", () => {
    const offer = {
      fullNameEn: 'Omar',
      fullNameAr: 'عمر',
      email: 'o@x.com',
      mobile: null,
      employeeId: null,
      employmentType: 'part_time',
      department: { id: 'd', nameEn: 'Marketing', nameAr: null, parent: null },
      jobTitle: null,
      grade: null,
      manager: null,
      shift: { id: 's', code: 'A', workingDays: [0, 1, 2, 3, 4] },
      workArrangement: 'hybrid',
      officeDays: [1, 3],
      joinDate: '2026-11-01',
      payBasis: 'hourly',
      grossSalary: 13000,
      hourlyRate: 150,
      hoursPerWeek: 20,
      daysPerWeek: 3,
      basicPercent: null,
      netSalary: 11000,
      allowances: [{ allowanceTypeId: 'a', nameEn: 'Transport', nameAr: 'بدل انتقال', taxable: false, insured: false, amount: 500 }],
      probationMonths: 3,
      durationMonths: 12,
      expiresOn: '2026-10-22',
      message: null,
      note: 'n',
    } as unknown as OfferView;
    expect(offerDefaults(offer)).toMatchObject({
      mobile: '',
      departmentId: 'd',
      jobTitleId: '',
      shiftId: 's',
      officeDays: [1, 3],
      payBasis: 'hourly',
      basicPercent: 80,
      allowances: [{ allowanceTypeId: 'a', amount: 500 }],
      message: '',
      note: 'n',
    });
  });
});
