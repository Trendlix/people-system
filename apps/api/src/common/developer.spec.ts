import {
  DEVELOPER_CODE_SEARCH,
  DEVELOPER_NO_MATCH,
  developerPeople,
  developerQuery,
  developerRolesProblem,
  HIDDEN,
  hiddenDigits,
  isDeveloperRole,
  maskForDeveloper,
  personTag,
  scrubText,
  unknownEmail,
} from '@trendlix/shared';

// The Developer role (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real numbers";
// hidden: "Money and personal IDs"): the masking every answer a developer receives goes through (packages/shared
// developer.ts), and the roles a developer may hold.

const NONE = { employees: [], users: [], applicants: [], offers: [] };
const OMAR = {
  id: '0e0e0e0e-1111-4222-8333-444455556666',
  employeeCode: 'EMP-0182',
  fullNameEn: 'Omar Khaled Mahmoud',
  fullNameAr: 'عمر خالد محمود',
  displayName: 'Omar Khaled',
  workEmail: 'omar@trendlix.test',
  personalEmail: 'omar.k@mail.test',
  emergencyName: 'Mona Khaled',
};

describe('what a developer receives', () => {
  it('a payroll line: every amount 0, the days, hours, scores and percents as they are, warnings without their digits', () => {
    const line = {
      id: '7f6d1c3e-1111-4222-8333-444455556666',
      name: 'Omar Khaled',
      employeeCode: 'EMP-0182',
      terms: { year: 2026, gross: 20000, basicPercent: 80, paidDays: 30, hoursPerDay: 9, insuredWage: 16700, allowances: [{ name: 'Transport', amount: 500, taxable: true }] },
      inputs: { workedHours: 170, expectedHours: 180, released: 1000, leaveDays: 2 },
      result: { gross: 20000, net: 17250.5, earned: 19000, attendanceScore: 0.95, kpiScore: 0.9, absentHours: 3, monthlyTax: 1200, warnings: ['Installments take EGP 3,000 (12%) of the pay on 2026-10-01.'] },
    };
    expect(maskForDeveloper(line, '/api/payroll/runs/1')).toEqual({
      id: '7f6d1c3e-1111-4222-8333-444455556666',
      // a person (it has their code): their pseudonym (22 October 2026: "make all real employees data encrypted for developer role")
      name: 'Employee EMP-0182',
      employeeCode: 'EMP-0182',
      terms: { year: 2026, gross: 0, basicPercent: 80, paidDays: 30, hoursPerDay: 9, insuredWage: 0, allowances: [{ name: 'Transport', amount: 0, taxable: true }] },
      inputs: { workedHours: 170, expectedHours: 180, released: 0, leaveDays: 2 },
      result: { gross: 0, net: 0, earned: 0, attendanceScore: 0.95, kpiScore: 0.9, absentHours: 3, monthlyTax: 0, warnings: ['Installments take EGP •,••• (••%) of the pay on ••••-••-••.'] },
    });
    // the answer itself is never changed
    expect(line.result.gross).toBe(20000);
  });

  it('personal IDs as ••••, wherever they are; an email pseudonymous; dates as they are', () => {
    expect(
      maskForDeveloper(
        { nationalId: '29503121234567', printedNo: 'KX1234567', mobile: '+201012345678', email: 'omar@mail.test', bank: { accountNo: '1234567890', iban: 'EG3800190005000000001234', bankName: 'CIB' }, joinDate: '2024-01-01' },
        '/api/employees/1',
      ),
    ).toEqual({ nationalId: HIDDEN, printedNo: HIDDEN, mobile: HIDDEN, email: unknownEmail('omar@mail.test'), bank: { accountNo: HIDDEN, iban: HIDDEN, bankName: 'CIB' }, joinDate: '2024-01-01' });
  });

  it('an audit change of money or an ID: from and to hidden; of anything else as it is', () => {
    const changes = [
      { field: 'grossSalary', label: 'Gross salary', from: '10,000', to: '12,000' },
      { field: 'bank.accountNo', label: 'Bank · Account number', from: '111', to: '222' },
      { field: 'values.purchasePrice', label: 'Purchase price', from: 30000, to: 32000 },
      { field: 'jobTitle', label: 'Job title', from: 'Editor', to: 'Senior Editor' },
    ];
    expect(maskForDeveloper({ changes }, '/api/audit')).toEqual({
      changes: [
        { field: 'grossSalary', label: 'Gross salary', from: '0', to: '0' },
        { field: 'bank.accountNo', label: 'Bank · Account number', from: HIDDEN, to: HIDDEN },
        { field: 'values.purchasePrice', label: 'Purchase price', from: 0, to: 0 },
        { field: 'jobTitle', label: 'Job title', from: 'Editor', to: 'Senior Editor' },
      ],
    });
  });

  it('names that are money on some pages only: by the API path', () => {
    // an asset list's total is a count; a pay version's total is money
    expect(maskForDeveloper({ total: 12 }, '/api/assets')).toEqual({ total: 12 });
    expect(maskForDeveloper({ total: 25000 }, '/api/employees/1/salary-history')).toEqual({ total: 0 });
    // a leave type's days used, a claim type's amounts used
    expect(maskForDeveloper({ usedInYear: 5 }, '/api/leave/balances')).toEqual({ usedInYear: 5 });
    expect(maskForDeveloper({ usedInYear: 5000 }, '/api/reimbursements/types')).toEqual({ usedInYear: 0 });
  });

  it('a document’s tag values: pay and IDs hidden, the rest as they are', () => {
    const people = developerPeople({ ...NONE, employees: [{ ...OMAR, fullNameAr: 'عمر خالد' }] });
    expect(maskForDeveloper({ values: { national_id: '29503121234567', gross_salary: '20,000', phone: '+201012345678', full_name_ar: 'عمر خالد' } }, '/api/documents/check', people)).toEqual({
      values: { national_id: HIDDEN, gross_salary: '0', phone: HIDDEN, full_name_ar: 'موظف EMP-0182' },
    });
  });

  it('a decimal or a date under a money field', () => {
    const decimal = { toNumber: () => 12, toFixed: () => '12.00', toJSON: () => '12' };
    const at = new Date('2026-10-22T10:00:00Z');
    expect(maskForDeveloper({ amount: decimal, paidOn: at, cost: null }, '/api/x')).toEqual({ amount: 0, paidOn: at, cost: null });
  });

  it('digits hidden in a text, a date, a moment and an id kept', () => {
    expect(hiddenDigits('EGP 3,000')).toBe('EGP •,•••');
    expect(hiddenDigits('3,000')).toBe('0');
    expect(hiddenDigits('2026-10-22')).toBe('2026-10-22');
    expect(hiddenDigits('2026-10-22T10:00:00.000Z')).toBe('2026-10-22T10:00:00.000Z');
    expect(hiddenDigits('7f6d1c3e-1111-4222-8333-444455556666')).toBe('7f6d1c3e-1111-4222-8333-444455556666');
    expect(hiddenDigits('٣٬٠٠٠ جنيه')).toBe('•٬••• جنيه');
  });
});

describe('the Developer role', () => {
  it('held with nothing but Employee beside it', () => {
    expect(isDeveloperRole(['developer'])).toBe(true);
    expect(developerRolesProblem(['developer'])).toBeNull();
    expect(developerRolesProblem(['employee', 'developer'])).toBeNull();
    expect(developerRolesProblem(['hr', 'developer'])).toBe('A developer holds no other role but Employee: they look at everything and change nothing.');
    expect(developerRolesProblem(['hr', 'super_admin'])).toBeNull();
  });
});

// The owner, 22 October 2026: "make all real employees data encrypted for developer role".
describe('no real personal data for a developer', () => {
  const people = developerPeople({
    employees: [OMAR, { ...OMAR, id: '1e1e1e1e-1111-4222-8333-444455556666', employeeCode: 'EMP-0007', fullNameEn: 'Sara Adel', fullNameAr: 'سارة عادل', displayName: null, workEmail: 'sara@trendlix.test', personalEmail: null, emergencyName: null }],
    users: [
      { id: '9a9a9a9a-1111-4222-8333-444455556666', email: 'omar@trendlix.test' },
      { id: '8b8b8b8b-1111-4222-8333-444455556666', email: 'accountant@outside.test' },
    ],
    applicants: [{ id: '7c7c7c7c-1111-4222-8333-444455556666', number: 'APP-2026-0001', fullName: 'Salma Ahmed', email: 'salma@mail.test' }],
    offers: [{ id: '6d6d6d6d-1111-4222-8333-444455556666', number: 'OFF-2026-0003', fullNameEn: 'Nour Hassan', fullNameAr: 'نور حسن', email: 'nour@mail.test' }],
  });

  it('a profile: pseudonyms for the names and emails; address, birth, education, emergency contact and photo hidden', () => {
    const profile = {
      id: OMAR.id,
      employeeCode: 'EMP-0182',
      fullNameEn: OMAR.fullNameEn,
      fullNameAr: OMAR.fullNameAr,
      displayName: OMAR.displayName,
      workEmail: OMAR.workEmail,
      personalEmail: OMAR.personalEmail,
      addressAr: '15 شارع عباس العقاد',
      city: 'مدينة نصر',
      governorate: 'Cairo',
      dateOfBirth: '1995-03-12',
      gender: 'male',
      nationality: 'Egyptian',
      maritalStatus: 'married',
      emergencyName: OMAR.emergencyName,
      emergencyRelation: 'Sister',
      university: 'Cairo University',
      graduationYear: 2017,
      photoId: '5e5e5e5e-1111-4222-8333-444455556666',
      notes: 'Prefers morning shifts',
      status: 'active',
      joinDate: '2024-01-01',
    };
    expect(maskForDeveloper(profile, '/api/employees/1', people)).toEqual({
      id: OMAR.id,
      employeeCode: 'EMP-0182',
      fullNameEn: 'Employee EMP-0182',
      fullNameAr: 'موظف EMP-0182',
      displayName: 'Employee EMP-0182',
      workEmail: 'emp-0182@hidden.invalid',
      personalEmail: 'emp-0182@hidden.invalid',
      addressAr: HIDDEN,
      city: HIDDEN,
      governorate: null,
      dateOfBirth: null,
      gender: null,
      nationality: null,
      maritalStatus: null,
      emergencyName: HIDDEN,
      emergencyRelation: HIDDEN,
      university: HIDDEN,
      graduationYear: null,
      photoId: null,
      notes: HIDDEN,
      status: 'active',
      joinDate: '2024-01-01',
    });
  });

  it('references to a person: the same pseudonym from their id, email or name, wherever they are', () => {
    const body = {
      createdBy: { email: 'omar@trendlix.test', name: 'Omar Khaled' },
      manager: { id: OMAR.id, name: 'Omar Khaled Mahmoud' },
      approvedBy: { id: '9a9a9a9a-1111-4222-8333-444455556666', email: 'omar@trendlix.test', name: 'Omar' },
      outsider: { by: { id: '8b8b8b8b-1111-4222-8333-444455556666', email: 'accountant@outside.test', name: 'Hany Accountant' } },
      holderName: 'Sara Adel',
      department: { id: 'd', name: 'Production' },
      asset: { code: 'PK-CAM-0003', name: 'Sony FX6' },
    };
    expect(maskForDeveloper(body, '/api/x', people)).toEqual({
      createdBy: { email: 'emp-0182@hidden.invalid', name: 'Employee EMP-0182' },
      manager: { id: OMAR.id, name: 'Employee EMP-0182' },
      approvedBy: { id: '9a9a9a9a-1111-4222-8333-444455556666', email: 'emp-0182@hidden.invalid', name: 'Employee EMP-0182' },
      outsider: { by: { id: '8b8b8b8b-1111-4222-8333-444455556666', email: `user-${personTag('8b8b8b8b-1111-4222-8333-444455556666')}@hidden.invalid`, name: `User ${personTag('8b8b8b8b-1111-4222-8333-444455556666')}` } },
      holderName: 'Employee EMP-0007',
      // not people: as they are
      department: { id: 'd', name: 'Production' },
      asset: { code: 'PK-CAM-0003', name: 'Sony FX6' },
    });
  });

  it('applicants and offers: by their numbers; their links and answers hidden', () => {
    expect(
      maskForDeveloper(
        { number: 'APP-2026-0001', fullName: 'Salma Ahmed', email: 'salma@mail.test', mobile: '01555755833', linkedin: 'https://linkedin.com/in/salma', answers: [{ key: 'q1', text: 'Agency background?', answer: 'yes, at Bold Agency' }] },
        '/api/recruitment/applications/1',
        people,
      ),
    ).toEqual({
      number: 'APP-2026-0001',
      fullName: 'Applicant APP-2026-0001',
      email: 'app-2026-0001@hidden.invalid',
      mobile: HIDDEN,
      linkedin: HIDDEN,
      answers: [{ key: 'q1', text: 'Agency background?', answer: HIDDEN }],
    });
    expect(maskForDeveloper({ number: 'OFF-2026-0003', fullNameEn: 'Nour Hassan', fullNameAr: 'نور حسن', email: 'nour@mail.test' }, '/api/offers/1', people)).toEqual({
      number: 'OFF-2026-0003',
      fullNameEn: 'Candidate OFF-2026-0003',
      fullNameAr: 'مرشح OFF-2026-0003',
      email: 'off-2026-0003@hidden.invalid',
    });
  });

  it('any text: real names, emails, phone numbers and national IDs replaced; codes, dates and enums kept', () => {
    expect(scrubText('Omar Khaled Mahmoud asked for leave; tell sara@trendlix.test or call +20 100 123 4567', people)).toBe(
      'Employee EMP-0182 asked for leave; tell emp-0007@hidden.invalid or call ••••',
    );
    expect(scrubText('عمر خالد محمود — 29503121234567', people)).toBe('موظف EMP-0182 — ••••');
    // a name inside another word is no name; nor a short one
    expect(scrubText('Omarius and Om', people)).toBe('Omarius and Om');
    expect(scrubText('2026-10-22', people)).toBe('2026-10-22');
    // an emergency contact's name is never shown
    expect(scrubText('Call Mona Khaled', people)).toBe(`Call ${HIDDEN}`);
    expect(maskForDeveloper({ title: 'Sara Adel’s leave was approved', endReason: 'resigned', rejectReason: 'Not a fit for Sara', noticeBy: '2026-11-01' }, '/api/x', people)).toEqual({
      title: 'Employee EMP-0007’s leave was approved',
      endReason: 'resigned',
      rejectReason: HIDDEN,
      noticeBy: '2026-11-01',
    });
  });

  it('an audit change of a person’s data: from and to hidden', () => {
    expect(
      maskForDeveloper(
        {
          changes: [
            { field: 'fullNameEn', from: 'Omar K. Mahmoud', to: 'Omar Khaled Mahmoud' },
            { field: 'addressAr', from: 'x', to: 'y' },
            { field: 'dateOfBirth', from: '1995-03-12', to: '1995-03-13' },
            { field: 'status', from: 'probation', to: 'active' },
          ],
        },
        '/api/audit',
        people,
      ),
    ).toEqual({
      changes: [
        { field: 'fullNameEn', from: HIDDEN, to: HIDDEN },
        { field: 'addressAr', from: HIDDEN, to: HIDDEN },
        { field: 'dateOfBirth', from: HIDDEN, to: HIDDEN },
        { field: 'status', from: 'probation', to: 'active' },
      ],
    });
  });

  it('a search: by a code only, never by a name or a person’s detail', () => {
    for (const code of ['EMP-0182', 'EMP-01', 'APP-2026-0001', 'PK-CAM-0003', 'cus-0042']) expect(DEVELOPER_CODE_SEARCH.test(code), code).toBe(true);
    expect(developerQuery({ q: 'EMP-0182', page: '2' })).toBeNull();
    expect(developerQuery({ q: 'Omar', page: '2' })).toEqual({ q: DEVELOPER_NO_MATCH, page: '2' });
    expect(developerQuery({ email: 'omar@trendlix.test', nationalId: '29503121234567' })).toEqual({ email: DEVELOPER_NO_MATCH, nationalId: DEVELOPER_NO_MATCH });
    expect(developerQuery({ status: 'active' })).toBeNull();
  });

  it('the company: its address stays, its representative is a person', () => {
    expect(maskForDeveloper({ nameEn: 'TrendLIX', addressAr: '15 شارع المحروقي', city: 'مدينة نصر', repName: 'Omar Khaled Mahmoud', repTitle: 'CEO' }, '/api/company', people)).toEqual({
      nameEn: 'TrendLIX',
      addressAr: '15 شارع المحروقي',
      city: 'مدينة نصر',
      repName: 'Employee EMP-0182',
      repTitle: 'CEO',
    });
    expect(maskForDeveloper({ repName: 'Someone Outside' }, '/api/company', people)).toEqual({ repName: HIDDEN });
  });

  it('pseudonyms stay the same, and a tag never shows the id', () => {
    expect(personTag('8b8b8b8b-1111-4222-8333-444455556666')).toBe(personTag('8b8b8b8b-1111-4222-8333-444455556666'));
    expect(personTag('8b8b8b8b-1111-4222-8333-444455556666')).toMatch(/^[0-9a-f]{6}$/);
    expect(unknownEmail('Someone@Mail.test')).toBe(unknownEmail('someone@mail.test'));
  });
});
