import { createHash } from 'node:crypto';
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
  scrubText,
  TAG_ALPHABET,
  tagFromDigest,
  unknownEmail,
  type DeveloperDigest,
} from '@trendlix/shared';
import { developerDigestOf, developerTagKeyOf } from '../auth/developer-tags.js';

// The Developer role (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real numbers";
// hidden: "Money and personal IDs"): the masking every answer a developer receives goes through (packages/shared
// developer.ts), and the roles a developer may hold. Since 23 October 2026 ("in developer view use **** instead of IDs"):
// people's codes "••••", pseudonyms keyed tags ("Employee 7K3Q"), no search for people.

/** The tags' keyed digest, as the API makes it (developer-tags.ts), with a test secret. */
const DIGEST = developerDigestOf(developerTagKeyOf('a test secret, not the server’s'));
const TAG = /^[2-9A-HJ-NP-Z]{4}$/;
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
/** A tag from its pseudonym ("Employee 7K3Q" → "7K3Q"). */
const tagIn = (pseudonym: string) => pseudonym.split(' ').at(-1)!;

describe('what a developer receives', () => {
  const people = developerPeople({ ...NONE, employees: [OMAR] }, DIGEST);
  const omar = people.byId.get(OMAR.id)!;

  it('a payroll line: every amount 0, the days, hours, scores and percents as they are, warnings without their digits', () => {
    const line = {
      id: '7f6d1c3e-1111-4222-8333-444455556666',
      name: 'Omar Khaled',
      employeeCode: 'EMP-0182',
      terms: { year: 2026, gross: 20000, basicPercent: 80, paidDays: 30, hoursPerDay: 9, insuredWage: 16700, allowances: [{ name: 'Transport', amount: 500, taxable: true }] },
      inputs: { workedHours: 170, expectedHours: 180, released: 1000, leaveDays: 2 },
      result: { gross: 20000, net: 17250.5, earned: 19000, attendanceScore: 0.95, kpiScore: 0.9, absentHours: 3, monthlyTax: 1200, warnings: ['Installments take EGP 3,000 (12%) of the pay on 2026-10-01.'] },
    };
    expect(maskForDeveloper(line, '/api/payroll/runs/1', people)).toEqual({
      id: '7f6d1c3e-1111-4222-8333-444455556666',
      // a person (it has their code): their pseudonym, a tag (22 October 2026: "make all real employees data encrypted
      // for developer role"; 23 October 2026: "in developer view use **** instead of IDs"), and the code hidden
      name: omar.en,
      employeeCode: HIDDEN,
      terms: { year: 2026, gross: 0, basicPercent: 80, paidDays: 30, hoursPerDay: 9, insuredWage: 0, allowances: [{ name: 'Transport', amount: 0, taxable: true }] },
      inputs: { workedHours: 170, expectedHours: 180, released: 0, leaveDays: 2 },
      result: { gross: 0, net: 0, earned: 0, attendanceScore: 0.95, kpiScore: 0.9, absentHours: 3, monthlyTax: 0, warnings: ['Installments take EGP •,••• (••%) of the pay on ••••-••-••.'] },
    });
    expect(omar.en).toMatch(/^Employee [2-9A-HJ-NP-Z]{4}$/);
    // the answer itself is never changed
    expect(line.result.gross).toBe(20000);
  });

  it('personal IDs as ••••, wherever they are; an email pseudonymous; dates of activity as they are', () => {
    expect(
      maskForDeveloper(
        {
          nationalId: '29503121234567',
          printedNo: 'KX1234567',
          mobile: '+201012345678',
          email: 'omar@mail.test',
          bank: { accountNo: '1234567890', iban: 'EG3800190005000000001234', bankName: 'CIB' },
          joinDate: '2024-01-01',
          createdAt: '2026-10-22T10:00:00.000Z',
        },
        '/api/employees/1',
      ),
    ).toEqual({
      nationalId: HIDDEN,
      printedNo: HIDDEN,
      mobile: HIDDEN,
      email: unknownEmail('omar@mail.test'),
      bank: { accountNo: HIDDEN, iban: HIDDEN, bankName: 'CIB' },
      // the hire date is an employment's (22 October 2026: "Hide per-person details")
      joinDate: null,
      createdAt: '2026-10-22T10:00:00.000Z',
    });
  });

  it('the ID card’s and the employee file’s papers’ dates null; a job offer’s expiry stays (23 October 2026)', () => {
    expect(maskForDeveloper({ nationalId: '29503121234567', issueDate: '2020-05-01', expiryDate: '2027-05-01' }, '/api/employees/1/identity')).toEqual({ nationalId: HIDDEN, issueDate: null, expiryDate: null });
    expect(maskForDeveloper([{ kind: 'passport', documentNo: 'A123', expiresOn: '2029-01-01' }], '/api/employees/1/paperwork')).toEqual([{ kind: 'passport', documentNo: HIDDEN, expiresOn: null }]);
    expect(maskForDeveloper({ items: [{ expiresOn: '2029-01-01' }] }, '/api/paperwork/search')).toEqual({ items: [{ expiresOn: null }] });
    expect(maskForDeveloper({ expiresOn: '2026-10-30' }, '/api/offers/1')).toEqual({ expiresOn: '2026-10-30' });
  });

  it('an audit change of money or an ID: from and to hidden; of anything else as it is', () => {
    const changes = [
      { field: 'grossSalary', label: 'Gross salary', from: '10,000', to: '12,000' },
      { field: 'bank.accountNo', label: 'Bank · Account number', from: '111', to: '222' },
      { field: 'values.purchasePrice', label: 'Purchase price', from: 30000, to: 32000 },
      { field: 'jobTitle', label: 'Job title', from: 'Editor', to: 'Senior Editor' },
      { field: 'shiftId', label: 'Shift', from: 'Shift A', to: 'Shift B' },
    ];
    expect(maskForDeveloper({ changes }, '/api/audit')).toEqual({
      changes: [
        { field: 'grossSalary', label: 'Gross salary', from: '0', to: '0' },
        { field: 'bank.accountNo', label: 'Bank · Account number', from: HIDDEN, to: HIDDEN },
        { field: 'values.purchasePrice', label: 'Purchase price', from: 0, to: 0 },
        // a person's job title (22 October 2026: "Hide per-person details")
        { field: 'jobTitle', label: 'Job title', from: HIDDEN, to: HIDDEN },
        { field: 'shiftId', label: 'Shift', from: 'Shift A', to: 'Shift B' },
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

  it('a document’s tag values: pay, IDs and codes hidden, the rest as they are', () => {
    const shortName = developerPeople({ ...NONE, employees: [{ ...OMAR, fullNameAr: 'عمر خالد' }] }, DIGEST);
    expect(
      maskForDeveloper({ values: { national_id: '29503121234567', gross_salary: '20,000', phone: '+201012345678', full_name_ar: 'عمر خالد', employee_code: 'EMP-0182' } }, '/api/documents/check', shortName),
    ).toEqual({
      values: { national_id: HIDDEN, gross_salary: '0', phone: HIDDEN, full_name_ar: shortName.byId.get(OMAR.id)!.ar, employee_code: HIDDEN },
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
  const SARA_ID = '1e1e1e1e-1111-4222-8333-444455556666';
  const OUTSIDER = '8b8b8b8b-1111-4222-8333-444455556666';
  const SALMA_ID = '7c7c7c7c-1111-4222-8333-444455556666';
  const NOUR_ID = '6d6d6d6d-1111-4222-8333-444455556666';
  const people = developerPeople(
    {
      employees: [OMAR, { ...OMAR, id: SARA_ID, employeeCode: 'EMP-0007', fullNameEn: 'Sara Adel', fullNameAr: 'سارة عادل', displayName: null, workEmail: 'sara@trendlix.test', personalEmail: null, emergencyName: null }],
      users: [
        { id: '9a9a9a9a-1111-4222-8333-444455556666', email: 'omar@trendlix.test' },
        { id: OUTSIDER, email: 'accountant@outside.test' },
      ],
      applicants: [{ id: SALMA_ID, number: 'APP-2026-0001', fullName: 'Salma Ahmed', email: 'salma@mail.test' }],
      offers: [{ id: NOUR_ID, number: 'OFF-2026-0003', fullNameEn: 'Nour Hassan', fullNameAr: 'نور حسن', email: 'nour@mail.test' }],
    },
    DIGEST,
  );
  const omar = people.byId.get(OMAR.id)!;
  const sara = people.byId.get(SARA_ID)!;
  const salma = people.byId.get(SALMA_ID)!;
  const nour = people.byId.get(NOUR_ID)!;

  it('a profile: pseudonyms for the names and emails, the code hidden; address, birth, education, emergency contact and photo hidden', () => {
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
      employeeCode: HIDDEN,
      fullNameEn: omar.en,
      fullNameAr: omar.ar,
      displayName: omar.en,
      workEmail: omar.email,
      personalEmail: omar.email,
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
      // an employment's date (22 October 2026: "Hide per-person details")
      joinDate: null,
    });
    expect(omar).toEqual({ en: `Employee ${tagIn(omar.en)}`, ar: `موظف ${tagIn(omar.en)}`, email: `employee-${tagIn(omar.en).toLowerCase()}@hidden.invalid` });
  });

  it('references to a person: the same pseudonym from their id, email or name, wherever they are', () => {
    const body = {
      createdBy: { email: 'omar@trendlix.test', name: 'Omar Khaled' },
      manager: { id: OMAR.id, name: 'Omar Khaled Mahmoud' },
      approvedBy: { id: '9a9a9a9a-1111-4222-8333-444455556666', email: 'omar@trendlix.test', name: 'Omar' },
      outsider: { by: { id: OUTSIDER, email: 'accountant@outside.test', name: 'Hany Accountant' } },
      holderName: 'Sara Adel',
      department: { id: 'd', name: 'Production' },
      asset: { code: 'PK-CAM-0003', name: 'Sony FX6' },
    };
    const outsider = people.byId.get(OUTSIDER)!;
    expect(outsider.en).toMatch(/^User [2-9A-HJ-NP-Z]{4}$/);
    expect(outsider.email).toBe(`user-${tagIn(outsider.en).toLowerCase()}@hidden.invalid`);
    expect(maskForDeveloper(body, '/api/x', people)).toEqual({
      createdBy: { email: omar.email, name: omar.en },
      manager: { id: OMAR.id, name: omar.en },
      approvedBy: { id: '9a9a9a9a-1111-4222-8333-444455556666', email: omar.email, name: omar.en },
      outsider: { by: { id: OUTSIDER, email: outsider.email, name: outsider.en } },
      holderName: sara.en,
      // not people: their names as they are; a department on a page about people is where someone works, hidden
      // (22 October 2026: "Hide per-person details")
      department: { id: null, name: HIDDEN },
      asset: { code: 'PK-CAM-0003', name: 'Sony FX6' },
    });
  });

  it('applicants and offers: by their tags, their numbers hidden; their links and answers hidden', () => {
    expect(
      maskForDeveloper(
        { number: 'APP-2026-0001', fullName: 'Salma Ahmed', email: 'salma@mail.test', mobile: '01555755833', linkedin: 'https://linkedin.com/in/salma', answers: [{ key: 'q1', text: 'Agency background?', answer: 'yes, at Bold Agency' }] },
        '/api/recruitment/applications/1',
        people,
      ),
    ).toEqual({
      number: HIDDEN,
      fullName: salma.en,
      email: salma.email,
      mobile: HIDDEN,
      linkedin: HIDDEN,
      answers: [{ key: 'q1', text: 'Agency background?', answer: HIDDEN }],
    });
    expect(salma.en).toMatch(/^Applicant [2-9A-HJ-NP-Z]{4}$/);
    expect(maskForDeveloper({ number: 'OFF-2026-0003', fullNameEn: 'Nour Hassan', fullNameAr: 'نور حسن', email: 'nour@mail.test' }, '/api/offers/1', people)).toEqual({
      number: HIDDEN,
      fullNameEn: nour.en,
      fullNameAr: nour.ar,
      email: nour.email,
    });
    expect(nour).toEqual({ en: `Candidate ${tagIn(nour.en)}`, ar: `مرشح ${tagIn(nour.en)}`, email: `candidate-${tagIn(nour.en).toLowerCase()}@hidden.invalid` });
  });

  it('any text: real names, emails, phone numbers, national IDs and codes replaced; dates and enums kept', () => {
    expect(scrubText('Omar Khaled Mahmoud (EMP-0182) asked for leave; tell sara@trendlix.test or call +20 100 123 4567', people)).toBe(
      `${omar.en} (${HIDDEN}) asked for leave; tell ${sara.email} or call ••••`,
    );
    expect(scrubText('عمر خالد محمود — 29503121234567', people)).toBe(`${omar.ar} — ••••`);
    // a name inside another word is no name; nor a short one
    expect(scrubText('Omarius and Om', people)).toBe('Omarius and Om');
    expect(scrubText('2026-10-22', people)).toBe('2026-10-22');
    // an emergency contact's name is never shown
    expect(scrubText('Call Mona Khaled', people)).toBe(`Call ${HIDDEN}`);
    expect(maskForDeveloper({ title: 'Sara Adel’s leave was approved', endReason: 'resigned', rejectReason: 'Not a fit for Sara', noticeBy: '2026-11-01' }, '/api/x', people)).toEqual({
      title: `${sara.en}’s leave was approved`,
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

  // 23 October 2026: "people search is off for developers" (a code search would link a real code to its tag)
  it('a search for people finds nothing, by a name or a code; an asset’s, a kit’s, a custody record’s or a vacancy’s code finds', () => {
    for (const code of ['PK-CAM-0003', 'pk-cam', 'PK-KIT-A', 'CUS-0042', 'cus-', 'VAC-2026-0001', 'IT-LAP-0001']) expect(DEVELOPER_CODE_SEARCH.test(code), code).toBe(true);
    // a person's code, or a part of one an asset's search by its holder's code would match
    for (const code of ['EMP-0182', 'MP-0182', 'APP-2026-0001', 'PP-2026', 'CAN-0001', 'AN-0001', 'OFF-2026-0003', 'FF-2026', 'CON-2026-0007', 'Omar', '0182']) {
      expect(DEVELOPER_CODE_SEARCH.test(code), code).toBe(false);
    }
    const none = (rest: Record<string, unknown> = {}) => ({ q: DEVELOPER_NO_MATCH, ...rest });
    for (const path of ['/api/offers', '/api/contracts', '/api/recruitment/applications', '/api/recruitment/general-cvs', '/api/recruitment/candidates', '/api/audit', '/api/assets/custody/people', '/api/assets/reports/holders', '/api/offboarding/former', '/api/paperwork/search']) {
      expect(developerQuery({ q: 'EMP-0182', page: '2' }, path), path).toEqual(none({ page: '2' }));
      expect(developerQuery({ q: 'Omar' }, path), path).toEqual(none());
      expect(developerQuery({ q: 'PK-CAM-0003' }, path), path).toEqual(none());
    }
    for (const path of ['/api/assets', '/api/assets/kits', '/api/assets/custody', '/api/assets/counts', '/api/recruitment/vacancies']) {
      expect(developerQuery({ q: 'PK-CAM-0003' }, path), path).toBeNull();
      expect(developerQuery({ q: 'CUS-0042' }, path), path).toBeNull();
      // by a name or a person's code, nothing (an asset is found by its holder's)
      expect(developerQuery({ q: 'EMP-0182' }, path), path).toEqual(none());
      expect(developerQuery({ q: 'Sony' }, path), path).toEqual(none());
    }
    // without the path: a search for people; a list is no code
    expect(developerQuery({ q: 'PK-CAM-0003' })).toEqual(none());
    expect(developerQuery({ q: ['PK-CAM-0003', 'Omar'] }, '/api/assets')).toEqual(none());
    // a person's name, email, national ID or code as a filter
    expect(developerQuery({ email: 'omar@trendlix.test', nationalId: '29503121234567', employeeCode: 'EMP-0182' }, '/api/offboarding/rehire-check')).toEqual({
      email: DEVELOPER_NO_MATCH,
      nationalId: DEVELOPER_NO_MATCH,
      employeeCode: DEVELOPER_NO_MATCH,
    });
    expect(developerQuery({ status: 'active', q: '' }, '/api/offers')).toBeNull();
    // the assets list's filter by who holds it (their name or code): nothing; its code search stays
    expect(developerQuery({ q: 'PK-CAM', holder: 'EMP-0182' }, '/api/assets')).toEqual({ q: 'PK-CAM', holder: DEVELOPER_NO_MATCH });
    expect(developerQuery({ holder: 'Omar' }, '/api/assets')).toEqual({ holder: DEVELOPER_NO_MATCH });
  });

  it('the company: its address stays, its representative is a person', () => {
    expect(maskForDeveloper({ nameEn: 'TrendLIX', addressAr: '15 شارع المحروقي', city: 'مدينة نصر', repName: 'Omar Khaled Mahmoud', repTitle: 'CEO' }, '/api/company', people)).toEqual({
      nameEn: 'TrendLIX',
      addressAr: '15 شارع المحروقي',
      city: 'مدينة نصر',
      // a company page cuts its people off, even their pseudonym: theirs signing as the CEO would say who they are
      // (22 October 2026: "Hide per-person details")
      repName: HIDDEN,
      repTitle: 'CEO',
    });
    expect(maskForDeveloper({ repName: 'Someone Outside' }, '/api/company', people)).toEqual({ repName: HIDDEN });
  });

  it('an email nobody has: a keyed pseudonym of its own, the same in any case', () => {
    expect(unknownEmail('Someone@Mail.test', people)).toBe(unknownEmail('someone@mail.test', people));
    expect(unknownEmail('someone@mail.test', people)).toMatch(/^hidden-[2-9a-hj-np-z]{6}@hidden\.invalid$/);
    // without the key, no tag at all
    expect(unknownEmail('someone@mail.test')).toBe('hidden@hidden.invalid');
  });
});

/** A digest whose first letters read `tag` (the rest zero bits): a tag's rules tried on a chosen one. */
function digestReading(tag: string): Uint8Array {
  const out = new Uint8Array(32);
  tag
    .split('')
    .flatMap((c) => TAG_ALPHABET.indexOf(c).toString(2).padStart(5, '0').split('').map(Number))
    .forEach((bit, i) => {
      if (bit) out[i >> 3] |= 0x80 >> (i & 7);
    });
  return out;
}

// 23 October 2026: "in developer view use **** instead of IDs"; told: names become a stable tag that isn't the real code
describe('a person’s tag', () => {
  const people = developerPeople({ ...NONE, employees: [OMAR] }, DIGEST);
  const tag = tagIn(people.byId.get(OMAR.id)!.en);

  it('4 letters without look-alikes, the same each time', () => {
    expect(tag).toMatch(TAG);
    expect(TAG_ALPHABET).toHaveLength(32);
    for (const c of '01OI') expect(TAG_ALPHABET, c).not.toContain(c);
    expect(tagIn(developerPeople({ ...NONE, employees: [OMAR] }, DIGEST).byId.get(OMAR.id)!.en)).toBe(tag);
    expect(tagFromDigest(digestReading('7K3Q'))).toBe('7K3Q');
  });

  it('keyed: another key, another tag; the id’s plain hash isn’t it', () => {
    const other = developerDigestOf(developerTagKeyOf('another secret'));
    const ids = ['0e0e0e0e-1111-4222-8333-444455556666', '1e1e1e1e-1111-4222-8333-444455556666', '2e2e2e2e-1111-4222-8333-444455556666'];
    const tags = (digest: DeveloperDigest) => ids.map((id) => tagFromDigest(digest(id)));
    expect(tags(other)).not.toEqual(tags(DIGEST));
    expect(tags(DIGEST)).not.toEqual(ids.map((id) => tagFromDigest(createHash('sha256').update(id).digest())));
    expect(developerTagKeyOf('a secret')).toEqual(developerTagKeyOf('a secret'));
    expect(() => developerTagKeyOf('')).toThrow();
  });

  it('never the code’s own number', () => {
    const digest: DeveloperDigest = (text) => (text === 'id-2345' ? digestReading('2345') : DIGEST(text));
    const row = (code: string) => ({ ...OMAR, id: 'id-2345', employeeCode: code });
    // EMP-2345 is never "Employee 2345": its next, longer tag
    expect(developerPeople({ ...NONE, employees: [row('EMP-2345')] }, digest).byId.get('id-2345')!.en).toBe('Employee 23452');
    expect(developerPeople({ ...NONE, employees: [row('EMP-0182')] }, digest).byId.get('id-2345')!.en).toBe('Employee 2345');
    expect(tag.replace(/\D/g, '')).not.toBe('0182');
  });

  it('two people never share one: the first added keeps it, the next ones’ are longer, in whatever order they come', () => {
    const digest: DeveloperDigest = (text) => (text.startsWith('same-') ? digestReading('7K3QM9') : DIGEST(text));
    const rows = [
      { ...OMAR, id: 'same-a', employeeCode: 'EMP-0003', createdAt: new Date('2026-01-03') },
      { ...OMAR, id: 'same-b', employeeCode: 'EMP-0001', createdAt: new Date('2026-01-01') },
      { ...OMAR, id: 'same-c', employeeCode: 'EMP-0002', createdAt: '2026-01-02T00:00:00.000Z' },
      { ...OMAR, id: 'same-d', employeeCode: 'EMP-0004', createdAt: new Date('2026-01-04') },
    ];
    for (const employees of [rows, [...rows].reverse()]) {
      const p = developerPeople({ ...NONE, employees }, digest);
      const of = (id: string) => p.byId.get(id)!.en;
      expect(of('same-b')).toBe('Employee 7K3Q');
      expect(of('same-c')).toBe('Employee 7K3QM');
      expect(of('same-a')).toBe('Employee 7K3QM9');
      expect(of('same-d')).toMatch(/^Employee [2-9A-HJ-NP-Z]{6}$/);
      expect(new Set(rows.map((r) => of(r.id))).size).toBe(4);
    }
  });

  it('the same person, the same tag: their account, their candidate profile, its applications and their offer', () => {
    const p = developerPeople(
      {
        employees: [OMAR],
        // linked by users.employee_id, though the email is another
        users: [
          { id: 'u1', email: 'someone.else@trendlix.test', employeeId: OMAR.id },
          { id: 'u2', email: 'omar@trendlix.test' },
        ],
        candidates: [
          { id: 'c1', code: 'CAN-0001', fullName: 'Omar Khaled Mahmoud', employeeId: OMAR.id },
          { id: 'c2', code: 'CAN-0002', fullName: 'Salma Ahmed' },
        ],
        applicants: [
          { id: 'a1', number: 'APP-2026-0001', fullName: 'Salma Ahmed', email: 'salma@mail.test', candidateId: 'c2' },
          { id: 'a2', number: 'APP-2026-0002', fullName: 'Omar Khaled', email: 'omar.k@mail.test', candidateId: 'c1' },
          { id: 'a3', number: 'APP-2026-0003', fullName: 'Nobody Linked', email: 'nobody@mail.test' },
        ],
        offers: [{ id: 'o1', number: 'OFF-2026-0001', fullNameEn: 'Salma Ahmed', fullNameAr: null, email: 'salma@mail.test', applicationId: 'a1' }],
      },
      DIGEST,
    );
    const of = (id: string) => tagIn(p.byId.get(id)!.en);
    expect(p.byId.get('u1')).toEqual(p.byId.get(OMAR.id));
    expect(p.byId.get('u2')).toEqual(p.byId.get(OMAR.id));
    expect(p.byId.get('c1')!.en).toBe(`Candidate ${of(OMAR.id)}`);
    expect(p.byId.get('a2')!.en).toBe(`Applicant ${of(OMAR.id)}`);
    expect(of('a1')).toBe(of('c2'));
    expect(p.byId.get('o1')!.en).toBe(`Candidate ${of('c2')}`);
    expect(new Set([of(OMAR.id), of('c2'), of('a3')]).size).toBe(3);
    // found by the code a person object carries too
    expect(p.byCode.get('APP-2026-0001')).toEqual(p.byId.get('a1'));
    expect(p.byCode.get('EMP-0182')).toEqual(p.byId.get(OMAR.id));
    // someone added since the people were read: a keyed tag of their id, never their code
    const masked = maskForDeveloper({ id: 'new-person', employeeCode: 'EMP-0999', fullNameEn: 'New Person' }, '/api/employees', p) as Record<string, string>;
    expect(masked).toEqual({ id: 'new-person', employeeCode: HIDDEN, fullNameEn: `Employee ${p.tagOf('new-person')}` });
    expect(p.tagOf('new-person')).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
  });
});

describe('a person’s code, hidden wherever it is (23 October 2026)', () => {
  const people = developerPeople({ ...NONE, employees: [OMAR] }, DIGEST);

  it('in a text, in any case; an asset’s, a kit’s, a custody record’s and a vacancy’s stay', () => {
    expect(scrubText('EMP-0182 signed CON-2026-0007 and CON-2026-0007-A1; from APP-2026-0001 (CAN-0001), offer OFF-2026-0003', people)).toBe(
      `${HIDDEN} signed ${HIDDEN} and ${HIDDEN}; from ${HIDDEN} (${HIDDEN}), offer ${HIDDEN}`,
    );
    expect(scrubText('emp-0182_contract.pdf')).toBe(`${HIDDEN}_contract.pdf`);
    const kept = 'PK-CAM-0003 in PK-KIT-A, handed over on CUS-0042 for VAC-2026-0001; grade G3, shift A';
    expect(scrubText(kept, people)).toBe(kept);
    // a code inside another word is none
    expect(scrubText('XEMP-0182 and EMP-0182X')).toBe('XEMP-0182 and EMP-0182X');
  });

  it('in its fields: an employee’s code, an application’s number, a candidate’s code, a reference, a contract’s number', () => {
    expect(
      maskForDeveloper(
        {
          employeeCode: 'EMP-0182',
          applications: [{ number: 'APP-2026-0001', vacancy: { number: 'VAC-2026-0001' } }],
          candidate: { code: 'CAN-0001' },
          movedTo: { reference: 'APP-2026-0002' },
          contract: { number: 'CON-2026-0007-A1', version: 2 },
          asset: { code: 'PK-CAM-0003' },
          custody: { code: 'CUS-0042' },
        },
        '/api/x',
        people,
      ),
    ).toEqual({
      employeeCode: HIDDEN,
      applications: [{ number: HIDDEN, vacancy: { number: 'VAC-2026-0001' } }],
      candidate: { code: HIDDEN },
      movedTo: { reference: HIDDEN },
      contract: { number: HIDDEN, version: 2 },
      asset: { code: 'PK-CAM-0003' },
      custody: { code: 'CUS-0042' },
    });
  });
});

// Two gaps found with candidate profiles (22 October 2026): a CV's file name written with underscores, and a list of
// email objects.
describe('names in file names and lists of email objects', () => {
  const people = developerPeople({ ...NONE, applicants: [{ id: '7c7c7c7c-1111-4222-8333-444455556666', number: 'APP-2026-0001', fullName: 'Salma Ahmed', email: 'salma@mail.test' }] }, DIGEST);
  const salma = people.byId.get('7c7c7c7c-1111-4222-8333-444455556666')!;

  it('a real name in a file name, its words apart by _ . or -, is hidden', () => {
    expect(scrubText('Salma_Ahmed_CV.pdf', people)).toBe(`${HIDDEN}_CV.pdf`);
    expect(scrubText('cv-salma.ahmed-2026.pdf', people)).toBe(`cv-${HIDDEN}-2026.pdf`);
    expect(scrubText('Salma Ahmed', people)).toBe(salma.en);
  });

  it('every email in a list of objects under an emails key is hidden', () => {
    const masked = maskForDeveloper({ emails: [{ email: 'salma@mail.test', firstSeen: '2026-10-01' }, { email: 'other@mail.test' }] }, '/api/recruitment/candidates/1', people) as {
      emails: { email: string; firstSeen?: string }[];
    };
    expect(masked.emails[0]).toEqual({ email: salma.email, firstSeen: '2026-10-01' });
    expect(masked.emails[1].email).toBe(unknownEmail('other@mail.test', people));
    expect(JSON.stringify(masked)).not.toContain('@mail.test');
  });
});
