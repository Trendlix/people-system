import type { INestApplication } from '@nestjs/common';
import { cvFacts, DEVELOPER_NO_FILES, DEVELOPER_READ_ONLY, HIDDEN, type ScreeningComments, type VacancySuggestions } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, PASSWORD, signIn } from './helpers.js';

// The Developer role (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real numbers";
// "act as super admin with numbers hidden and real sensitve numbers as national ids hidden changing nothing, and no act
// as"; hidden: "Money and personal IDs"). A Super Admin gives it (with nothing but Employee beside it); the developer
// opens what a Super Admin opens, but every amount comes 0 and every personal ID "••••", across an employee's profile,
// identity and bank, a payroll run, a loan, a claim, an offer, a vacancy and an asset; every change is refused, and every
// file with pay or IDs; never views as anyone; never told of what waits for HR or the CEO; what they open is logged with
// the values hidden. Distinctive amounts, so every answer can be searched for them. Since "Hide per-person details" and
// "and the social insurance" (22 October 2026), no page about people carries the person's job title, department, grade,
// hire or contract dates, or social insurance; the company's setup pages still name its departments, job titles and
// grades, without their people. Every name is invented; the test deletes what it made.

const RUN = `dv${Date.now().toString(36)}`;
const CURRENT = todayInCairo().slice(0, 7);
const MONTH = monthsLater(CURRENT, -1);
// the 13th, so the hire date, the probation's end and the contract's end are no month's first or last day
const JOINED = `${monthsLater(CURRENT, -3)}-13`;
const NATIONAL_ID = `2870723${String(Date.now() % 10_000_000).padStart(7, '0')}`; // born 23 July 1987, as BIRTH below
const ACCOUNT = '100099887766';
const MOBILE = '+201098765432';
const GROSS = 123457;
const OFFER_GROSS = 234567;
const SALARY_MIN = 345679;
const PURCHASE = 456781;
const LOAN = 56789;
const CLAIM = 6789.5;
const AMOUNTS = [GROSS, OFFER_GROSS, SALARY_MIN, PURCHASE, LOAN, CLAIM];
// the person's own data (owner, 22 October 2026: "make all real employees data encrypted for developer role"): invented,
// each distinctive, so every answer can be searched for it
const FULL_EN = `Omar Masked ${RUN}`;
/** The run's tag in Arabic letters, for the Arabic fields (which take Arabic letters only). */
const AR_TAG = RUN.split('').map((c) => 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'[c.charCodeAt(0) % 28]).join('');
const FULL_AR = `عمر مستتر ${AR_TAG}`;
const DISPLAY = `Omar Display ${RUN}`;
const WORK_EMAIL = `omar.${RUN}@trendlix.com`;
const PERSONAL_EMAIL = `omar.home.${RUN}@mail.test`;
const ADDRESS = `شارع ${AR_TAG}`;
const CITY = `مدينة ${AR_TAG}`;
const BIRTH = '1987-07-23';
const EMERGENCY = `Mona Contact ${RUN}`;
const UNIVERSITY = `University ${RUN}`;
const LOAN_REASON = `Invented loan ${RUN}`;
const CLAIM_TEXT = `Invented taxi ${RUN}`;
const OFFER_NAME = `Offer Person ${RUN}`;
const OFFER_EMAIL = `offer.${RUN}@mail.test`;
// a candidate's profile (candidate profiles, 22 October 2026): a general CV HR added, its person invented
const CANDIDATE_NAME = `Cand Person ${RUN}`;
const CANDIDATE_EMAIL = `cand.${RUN}@mail.test`;
const CANDIDATE_MOBILE = `+2011${String(Date.now() % 100_000_000).padStart(8, '0')}`;
// a screening comment on the candidate (owner, 24 October 2026: "is there a way to add screening comments?"): free text
// about a person, "••••" for a developer
const SCREENING_TEXT = `Invented screening note ${RUN}`;
// what the rules read from that CV (owner, 24 October 2026: "CV years in list + more rules"): the jobs of their past,
// their school, their certification and their city, invented and distinctive (the city's name in letters alone, as the
// rules take a city with its country)
const LETTERS = RUN.split('').map((c) => 'abcdefghijklmnopqrstuvwxyz'[c.charCodeAt(0) % 26]).join('');
const PAST_TITLE = `Colorist ${RUN}`;
const PAST_COMPANY = `Studio ${RUN}`;
const CV_SCHOOL = `Faculty of Film ${RUN}`;
const CV_CERTIFICATION = `Certified Grader ${RUN}`;
const CV_CITY = `Q${LETTERS}, UAE`;
const CV_TEXT = [CANDIDATE_NAME, CV_CITY, 'Experience', `${PAST_TITLE}, ${PAST_COMPANY}, Jan 2022 - Present`, 'Education', `Bachelor of Film, ${CV_SCHOOL}, 2018`, 'Certifications', CV_CERTIFICATION, 'Skills', 'Premiere Pro'].join('\n');
// a second person, whose fixed term ended three months ago while the work goes on (owner, 23 October 2026, as a
// developer, on the home page: "Employee EMP-0023 · EMP-0023", "Ends 11/03/2024", "Passed", "Became open-ended — Art.
// 88"): on Contracts Ending Soon and the law's warnings
const ENDED_EN = `Ended Person ${RUN}`;
const ENDED_EMAIL = `ended.${RUN}@trendlix.com`;
const JOINED_BEFORE = `${monthsLater(CURRENT, -15)}-13`;
const PERSONAL = [
  FULL_EN,
  FULL_AR,
  DISPLAY,
  WORK_EMAIL,
  PERSONAL_EMAIL,
  ADDRESS,
  CITY,
  BIRTH,
  EMERGENCY,
  UNIVERSITY,
  LOAN_REASON,
  CLAIM_TEXT,
  OFFER_NAME,
  OFFER_EMAIL,
  ENDED_EN,
  ENDED_EMAIL,
  PAST_TITLE,
  PAST_COMPANY,
  CV_SCHOOL,
  CV_CERTIFICATION,
  CV_CITY,
  SCREENING_TEXT,
];
// the person's job and social insurance (owner, 22 October 2026: "why is the employment data can be viewed by developer
// access"; "Hide per-person details", "and the social insurance"): invented and distinctive, so every answer about people
// can be searched for them. The company's own insurance office is set in the database, so no audit entry of the company
// carries it (the company's page shows it)
const DEPARTMENT = `Developer test ${RUN}`;
const JOB_TITLE = `Editor ${RUN}`;
const GRADE_CODE = `GD${RUN}`;
const GRADE_LEVEL = `Level ${RUN}`;
const INSURANCE_NO = `8${String(Date.now()).slice(-8)}`;
const INSURANCE_START = `${monthsLater(CURRENT, -3)}-14`;
const FILED_ON = `${monthsLater(CURRENT, -3)}-16`;
const OFFICE = `مكتب ${AR_TAG}`;
/** A date as the API sends it and as the audit log writes it (DD/MM/YYYY). */
const written = (date: string) => [date, date.split('-').reverse().join('/')];

/** The answer as text, and whether any of the real numbers is in it, however written. */
function leaks(body: unknown): string[] {
  const text = JSON.stringify(body);
  const found: string[] = [];
  for (const n of AMOUNTS) for (const shown of [String(n), n.toLocaleString('en-US')]) if (text.includes(shown)) found.push(shown);
  for (const id of [NATIONAL_ID, ACCOUNT, MOBILE, MOBILE.slice(1)]) if (text.includes(id)) found.push(id);
  return found;
}

/** The person's own data found in an answer, and the accounts' emails (`emails`): none may reach a developer. */
function personalLeaks(body: unknown, emails: readonly string[] = []): string[] {
  const text = JSON.stringify(body);
  return [...PERSONAL, ...emails].filter((v) => text.includes(JSON.stringify(v).slice(1, -1)));
}

/** The person's job, employment dates and social insurance found in an answer (`dates`: the contract's, once made). */
function jobLeaks(body: unknown, dates: readonly string[]): string[] {
  const text = JSON.stringify(body);
  const values = [DEPARTMENT, JOB_TITLE, GRADE_CODE, GRADE_LEVEL, OFFICE, INSURANCE_NO, ...[JOINED, JOINED_BEFORE, INSURANCE_START, FILED_ON, ...dates].flatMap(written)];
  return values.filter((v) => text.includes(JSON.stringify(v).slice(1, -1)));
}

/** A person's code of any kind, anyone's (owner, 23 October 2026: "in developer view use **** instead of IDs"). */
const PERSON_CODE = /(?<![A-Za-z0-9])(?:EMP-\d{3,}|APP-\d{4}-\d+|CAN-\d{3,}|OFF-\d{4}-\d+|CON-\d{4}-\d+)/gi;
/** A pseudonym: a word and a tag, 4 to 6 capitals and digits without look-alikes (never the code). */
const TAGGED = /^(Employee|Applicant|Candidate|User) [2-9A-HJ-NP-Z]{4,6}$/;
/** A pseudonym's tag ("Employee 7K3Q" → "7K3Q"). */
const tagIn = (pseudonym: string) => pseudonym.split(' ').at(-1)!;

/** The seeded people's codes (`codes`), and anyone's code, found in an answer: none may reach a developer. */
function codeLeaks(body: unknown, codes: readonly string[]): string[] {
  const text = JSON.stringify(body);
  return [...codes.filter((c) => c && text.toLowerCase().includes(c.toLowerCase())), ...(text.match(PERSON_CODE) ?? [])];
}

describe('The Developer role (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const as = (key: string) => ({
    get: (path: string) => api().get(`/api${path}`).set('Cookie', sessions[key]),
    post: (path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[key]).send(body),
    patch: (path: string, body: object) => api().patch(`/api${path}`).set('Cookie', sessions[key]).send(body),
    put: (path: string, body: object) => api().put(`/api${path}`).set('Cookie', sessions[key]).send(body),
    del: (path: string) => api().delete(`/api${path}`).set('Cookie', sessions[key]),
  });

  async function account(key: string, roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    sessions[key] = await signIn(app, email);
    return email;
  }

  let employeeId: string;
  let employmentId: string;
  let runId: string;
  let loanId: string;
  let claimId: string;
  let claimTypeId: string;
  let offerId: string;
  let vacancyId: string;
  let assetCode: string;
  let departmentId: string;
  let jobTitleId: string;
  /** The vacancy's job title, in the other department: the company's, never the person's. */
  let vacancyTitleId: string;
  let employeeCode: string;
  let offerNumber: string;
  let generalCvId: string;
  let candidateId: string;
  let ownGradeId: string;
  let otherDepartmentId: string;
  let contractId: string;
  /** The contract's start, end and probation's end, as the API sends them. */
  let contractDates: string[] = [];
  let officeBefore: string | null = null;
  // the people's codes (23 October 2026): the contract's number, the candidate's code, the general CV's number
  let contractNumber: string;
  let candidateCode: string;
  let generalCvNumber: string;
  // the second person, their fixed term ended (23 October 2026: the home page's Contracts Ending Soon)
  let endedId: string;
  let endedEmploymentId: string;
  let endedCode: string;
  let endedNumber: string;
  /** Their contract's start, end and probation's end, as the API sends them. */
  let endedDates: string[] = [];
  /** Every seeded person's code. */
  const codes = () => [employeeCode, endedCode, offerNumber, candidateCode, generalCvNumber, contractNumber, endedNumber];
  /** Every seeded contract's dates. */
  const allDates = () => [...contractDates, ...endedDates];

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('superAdmin', ['super_admin']);
    await account('admin', ['admin']);
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    // the developer: an account given the role by the Super Admin below, signed in again once it holds it
    const devEmail = await account('developer', ['employee']);
    await prisma.payrollRun.deleteMany({ where: { month: new Date(`${MONTH}-01`) } });

    // the department, a second one with nobody in it, the person's own grade and the company's insurance office: in the
    // database, so no audit entry of the company's setup names them (22 October 2026: "Hide per-person details")
    departmentId = (await prisma.department.create({ data: { nameEn: DEPARTMENT }, select: { id: true } })).id;
    otherDepartmentId = (await prisma.department.create({ data: { nameEn: `Developer empty ${RUN}` }, select: { id: true } })).id;
    jobTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: JOB_TITLE }, select: { id: true } })).id;
    vacancyTitleId = (await prisma.jobTitle.create({ data: { departmentId: otherDepartmentId, titleEn: `Writer ${RUN}` }, select: { id: true } })).id;
    ownGradeId = (await prisma.grade.create({ data: { code: GRADE_CODE, rank: 500 + (Date.now() % 400), levelEn: GRADE_LEVEL }, select: { id: true } })).id;
    officeBefore = (await prisma.company.findUnique({ where: { id: 1 }, select: { insuranceOffice: true } }))?.insuranceOffice ?? null;
    await prisma.company.update({ where: { id: 1 }, data: { insuranceOffice: OFFICE } });
    const shiftId = (await prisma.shift.findFirstOrThrow({ where: { code: 'A' }, select: { id: true } })).id;
    const gradeId = (await prisma.grade.findFirstOrThrow({ where: { code: 'G3' }, select: { id: true } })).id;

    // a person with their national ID, bank details, mobile and a signed contract
    const person = (
      await as('hr')
        .post('/employees', {
          fullNameEn: FULL_EN,
          fullNameAr: FULL_AR,
          displayName: DISPLAY,
          workEmail: WORK_EMAIL,
          personalEmail: PERSONAL_EMAIL,
          mobile: MOBILE,
          addressAr: ADDRESS,
          city: CITY,
          dateOfBirth: BIRTH,
          emergencyName: EMERGENCY,
          emergencyRelation: 'Sister',
          university: UNIVERSITY,
        })
        .expect((r) => {
          if (r.status !== 201) throw new Error(`The person wasn't made: ${JSON.stringify(r.body)}`);
        })
    ).body;
    employeeId = person.id;
    employeeCode = person.employeeCode;
    employmentId = (
      await as('hr').post(`/employees/${employeeId}/employments`, { employmentType: 'full_time', joinDate: JOINED, departmentId, shiftId, jobTitleId, gradeId: ownGradeId }).expect(201)
    ).body.employment.id;
    await as('hr').patch(`/employees/${employeeId}/identity`, { nationalId: NATIONAL_ID, printedNo: 'KX7654321' }).expect(200);
    await as('hr').patch(`/employees/${employeeId}/bank`, { bankName: 'CIB', accountNo: ACCOUNT }).expect(200);
    // the Social Insurance tab's: the number, the subscription start, registered, the occupation
    await as('hr').patch(`/employees/${employeeId}`, { insuranceNo: INSURANCE_NO, insuranceStartDate: INSURANCE_START, socialInsured: true, occupationCode: '194200' }).expect(200);
    const draft = (await as('hr').post(`/employees/${employeeId}/employments/${employmentId}/contracts`, { grossSalary: GROSS }).expect(201)).body as {
      id: string;
      number: string;
      startDate: string;
      endDate: string;
      probationEnd: string;
    };
    contractId = draft.id;
    contractNumber = draft.number;
    contractDates = [draft.startDate, draft.endDate, draft.probationEnd].filter(Boolean);
    await as('hr').post(`/contracts/${draft.id}/sign`, { signedOn: draft.startDate }).expect(200);
    // filed with social insurance (its registration date)
    await as('hr').patch(`/contracts/${draft.id}`, { insuranceFiledOn: FILED_ON }).expect(200);
    // the head of their department: the departments page would say where they work
    await prisma.department.update({ where: { id: departmentId }, data: { headId: employeeId } });

    // last month's payroll, a loan, a claim, an offer, a vacancy and an asset with its cost
    runId = (await as('hr').post('/payroll/runs', { month: MONTH }).expect(201)).body.id;
    loanId = (await as('hr').post('/payroll/advances', { employeeId, kind: 'loan', amount: LOAN, givenOn: `${MONTH}-15`, reason: LOAN_REASON, plan: 'Monthly' }).expect(201)).body.id;
    claimTypeId = (await prisma.reimbursementType.create({ data: { nameEn: `Taxi ${RUN}`, nameAr: 'تاكسي' }, select: { id: true } })).id;
    claimId = (
      await prisma.reimbursementClaim.create({
        data: { employeeId, employmentId, typeId: claimTypeId, expenseDate: new Date(`${MONTH}-10`), amount: CLAIM, description: CLAIM_TEXT, status: 'with_hr' },
        select: { id: true },
      })
    ).id;
    const offer = (
      await as('hr')
        .post('/offers', { fullNameEn: OFFER_NAME, fullNameAr: 'مرشح', email: OFFER_EMAIL, employmentType: 'full_time', joinDate: `${CURRENT}-28`, jobTitleId, gradeId, shiftId, grossSalary: OFFER_GROSS })
        .expect(201)
    ).body;
    offerId = offer.id;
    offerNumber = offer.number;
    vacancyId = (
      await as('hr').post('/recruitment/vacancies', { jobTitleId: vacancyTitleId, employmentType: 'full_time', headcount: 1, salaryMin: SALARY_MIN, salaryMax: SALARY_MIN + 1000, about: '<p>Edits our videos.</p>' }).expect(201)
    ).body.id;
    // sent for approval: the CEO is told, never the developer
    await as('hr').post(`/recruitment/vacancies/${vacancyId}/submit`).expect(200);
    // a candidate (22 October 2026): HR's Add a CV makes their profile
    generalCvId = (
      await api()
        .post('/api/recruitment/general-cvs')
        .set('Cookie', sessions.hr)
        .field('fullName', CANDIDATE_NAME)
        .field('email', CANDIDATE_EMAIL)
        .field('mobile', CANDIDATE_MOBILE)
        .field('areaOther', 'Video')
        .field('source', 'email')
        .field('consent', 'true')
        .attach('cv', Buffer.from(`%PDF-1.4\n% ${RUN}\n%%EOF\n`), 'cv.pdf')
        .expect(201)
    ).body.id;
    const cv = await prisma.generalCv.findUniqueOrThrow({ where: { id: generalCvId }, select: { candidateId: true, number: true } });
    // its CV read (24 October 2026): what the rules found in it, as the readings round keeps it
    const read = { status: 'read', method: 'pdf', text: CV_TEXT, facts: cvFacts(CV_TEXT) as object, readAt: new Date() };
    await prisma.cvReading.upsert({ where: { generalCvId }, create: { generalCvId, ...read }, update: read });
    candidateId = cv.candidateId!;
    generalCvNumber = cv.number;
    candidateCode = (await prisma.candidate.findUniqueOrThrow({ where: { id: candidateId }, select: { code: true } })).code;
    // HR's screening comment on them, with a verdict, mentioning the CEO (24 October 2026)
    await as('hr').post('/recruitment/comments', { candidateId, comment: SCREENING_TEXT, verdict: 'good_fit', mentions: [users.ceo] }).expect(201);
    // the general CV suggested for the vacancy (Suggested From Earlier CVs, 24 October 2026), invited to apply at their
    // address, its reason naming their past job's title: as the API keeps it, the vacancy still waiting for the CEO
    await prisma.vacancySuggestion.create({
      data: {
        vacancyId,
        candidateId,
        sourceKind: 'general_cv',
        generalCvId,
        score: 64,
        reasons: [
          { kind: 'skills', found: ['Premiere Pro'], listed: 1, points: 35 },
          { kind: 'title', from: 'cv', matchedTitle: PAST_TITLE, points: 20 },
        ],
        status: 'invited',
        invitedAt: new Date(),
        invitedTo: CANDIDATE_EMAIL,
        decidedById: users.hr,
        decidedAt: new Date(),
      },
    });
    assetCode = (await as('superAdmin').post('/assets', { name: `Camera ${RUN}`, group: 'kit', type: 'CAM', condition: 'good', values: { purchasePrice: PURCHASE } }).expect(201)).body.code;

    // the second person (after the payroll run, so it isn't theirs): hired 15 months ago on a 1-year fixed term, signed,
    // ended three months ago while the work goes on, so open-ended by the law (Art. 88(3))
    const ended = (await as('hr').post('/employees', { fullNameEn: ENDED_EN, fullNameAr: `منتهي ${AR_TAG}`, workEmail: ENDED_EMAIL }).expect(201)).body;
    endedId = ended.id;
    endedCode = ended.employeeCode;
    endedEmploymentId = (
      await as('hr').post(`/employees/${endedId}/employments`, { employmentType: 'full_time', joinDate: JOINED_BEFORE, departmentId, shiftId, jobTitleId, gradeId: ownGradeId }).expect(201)
    ).body.employment.id;
    const endedDraft = (await as('hr').post(`/employees/${endedId}/employments/${endedEmploymentId}/contracts`, { grossSalary: GROSS }).expect(201)).body as {
      id: string;
      number: string;
      startDate: string;
      endDate: string;
      probationEnd: string | null;
    };
    endedNumber = endedDraft.number;
    endedDates = [endedDraft.startDate, endedDraft.endDate, endedDraft.probationEnd].filter((d): d is string => !!d);
    await as('hr').post(`/contracts/${endedDraft.id}/sign`, { signedOn: endedDraft.startDate }).expect(200);
    if (!(endedDraft.endDate < todayInCairo())) throw new Error(`The second person's contract hasn't ended: ${endedDraft.endDate}`);

    // the role, given by the Super Admin; a new sign-in after it
    await as('superAdmin').patch(`/users/${users.developer}`, { roles: ['employee', 'developer'] }).expect(200);
    sessions.developer = await signIn(app, devEmail);
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: runId } });
    await prisma.payrollAdvance.deleteMany({ where: { employeeId } });
    await prisma.reimbursementClaim.deleteMany({ where: { id: claimId } });
    await prisma.reimbursementType.deleteMany({ where: { id: claimTypeId } });
    await prisma.jobOffer.deleteMany({ where: { id: offerId } });
    await prisma.vacancy.deleteMany({ where: { id: vacancyId } });
    await prisma.generalCv.deleteMany({ where: { id: generalCvId } });
    await prisma.candidate.deleteMany({ where: { id: candidateId } });
    await prisma.asset.deleteMany({ where: { code: assetCode } });
    if (!(await prisma.asset.count({ where: { code: { startsWith: 'PK-CAM-' } } }))) await prisma.assetCodeCounter.deleteMany({ where: { prefix: 'PK-CAM-' } });
    await prisma.contract.deleteMany({ where: { employmentId: { in: [employmentId, endedEmploymentId].filter(Boolean) } } });
    // the second person first: the first, their department's head, is their manager
    if (endedId) await prisma.employee.deleteMany({ where: { id: endedId } });
    await prisma.employee.deleteMany({ where: { id: employeeId } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: [jobTitleId, vacancyTitleId] } } });
    await prisma.department.deleteMany({ where: { id: { in: [departmentId, otherDepartmentId] } } });
    await prisma.grade.deleteMany({ where: { id: ownGradeId } });
    await prisma.company.update({ where: { id: 1 }, data: { insuranceOffice: officeBefore } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await app.close();
  });

  it('the role: given by a Super Admin only, with nothing but Employee beside it', async () => {
    const other = await createUser(prisma, ['employee']);
    const otherId = (await prisma.user.findUniqueOrThrow({ where: { email: other } })).id;
    expect((await as('admin').patch(`/users/${otherId}`, { roles: ['employee', 'developer'] }).expect(403)).body.message).toBe('Only a Super Admin can give or take away the Developer role.');
    expect((await as('superAdmin').patch(`/users/${otherId}`, { roles: ['hr', 'developer'] }).expect(400)).body.message).toEqual([
      'A developer holds no other role but Employee: they look at everything and change nothing.',
    ]);
    // the developer's own account says what they are: a Super Admin's sight, no asset values
    const me = (await as('developer').get('/auth/me').expect(200)).body;
    expect(me).toMatchObject({ developer: true, assets: { access: 'manager', values: false } });
    expect(me.roles).toEqual(expect.arrayContaining(['super_admin', 'hr', 'ceo', 'finance']));
    // the Users page lists their roles as kept
    expect((await as('superAdmin').get(`/users/${users.developer}`).expect(200)).body.roles).toEqual(['employee', 'developer']);
  });

  it('an employee’s profile, national ID and bank: a pseudonym for the name, the numbers and personal data hidden', async () => {
    const profile = (await as('developer').get(`/employees/${employeeId}`).expect(200)).body;
    // a tag, never the code (23 October 2026: "in developer view use **** instead of IDs")
    expect(profile.fullNameEn).toMatch(TAGGED);
    expect(profile.fullNameAr).toBe(`موظف ${tagIn(profile.fullNameEn)}`);
    expect(profile.employeeCode).toBe(HIDDEN);
    expect(codeLeaks(profile, codes())).toEqual([]);
    expect(leaks(profile)).toEqual([]);
    expect(personalLeaks(profile, Object.values(emails))).toEqual([]);
    const identity = (await as('developer').get(`/employees/${employeeId}/identity`).expect(200)).body;
    expect(identity).toMatchObject({ nationalId: HIDDEN, printedNo: HIDDEN });
    const bank = (await as('developer').get(`/employees/${employeeId}/bank`).expect(200)).body;
    expect(bank).toMatchObject({ accountNo: HIDDEN });
    expect(bank.bankName).toMatch(/Commercial International Bank|CIB/);
    expect(leaks([identity, bank])).toEqual([]);
    // HR still sees them
    expect((await as('hr').get(`/employees/${employeeId}/identity`).expect(200)).body.nationalId).toBe(NATIONAL_ID);
    const real = (await as('hr').get(`/employees/${employeeId}`).expect(200)).body;
    expect(real).toMatchObject({ fullNameEn: FULL_EN, fullNameAr: FULL_AR, workEmail: WORK_EMAIL, addressAr: ADDRESS });
    expect(personalLeaks(real)).toEqual(expect.arrayContaining([FULL_EN, WORK_EMAIL, ADDRESS, EMERGENCY, UNIVERSITY]));
  });

  // 22 October 2026: "make all real employees data encrypted for developer role"
  it('no real personal data on any page: names pseudonyms, emails pseudonymous, addresses, birth, education, notes hidden', async () => {
    const paths = [
      '/auth/me',
      '/employees',
      `/employees/${employeeId}`,
      `/employees/${employeeId}/identity`,
      `/employees/${employeeId}/bank`,
      `/employees/${employeeId}/employments/${employmentId}/contracts`,
      `/employees/${employeeId}/salary-history`,
      '/employees/missing',
      '/org-chart',
      '/departments',
      '/users',
      `/users/${users.hr}`,
      '/attendance',
      '/attendance/summary',
      '/attendance/check-in-setup/people',
      '/leave/requests',
      '/change-requests',
      '/contracts',
      '/endings',
      '/raise-requests',
      '/payroll/runs',
      `/payroll/runs/${runId}`,
      '/payroll/advances',
      `/payroll/advances/${loanId}`,
      '/payroll/adjustments',
      '/payroll/unsettled',
      '/reimbursements',
      `/reimbursements/${claimId}`,
      '/offers',
      `/offers/${offerId}`,
      '/recruitment/vacancies',
      `/recruitment/vacancies/${vacancyId}`,
      '/recruitment/applications',
      '/recruitment/general-cvs',
      // candidate profiles (22 October 2026)
      `/recruitment/general-cvs/${generalCvId}`,
      '/recruitment/candidates',
      '/recruitment/candidates/matches',
      `/recruitment/candidates/${candidateId}`,
      // screening comments (24 October 2026): the text "••••", the authors and those mentioned pseudonyms
      `/recruitment/candidates/${candidateId}/comments`,
      `/recruitment/general-cvs/${generalCvId}/comments`,
      // a vacancy's Suggested From Earlier CVs (24 October 2026): their people pseudonyms, codes "••••", titles hidden
      `/recruitment/vacancies/${vacancyId}/suggestions?status=invited`,
      // interviews, their meetings' links hidden (24 October 2026: online meetings made by the system)
      '/recruitment/interviews',
      '/recruitment/my-hiring',
      '/assets',
      `/assets/${assetCode}`,
      '/assets/custody',
      '/assets/custody/people',
      '/assets/reports/holders',
      '/kpis/overview',
      '/kpis/scorecards',
      '/offboarding/cases',
      '/offboarding/former',
      '/onboarding',
      '/audit',
      `/audit?entityType=employee&entityId=${employeeId}`,
      '/me/notifications',
      // more pages about the person's job and social insurance (22 October 2026: "Hide per-person details")
      `/employees/${employeeId}/documents`,
      `/employees/${employeeId}/paperwork`,
      `/employees/${employeeId}/leave`,
      `/employees/${employeeId}/raise-requests`,
      `/employees/${employeeId}/check-in-places`,
      `/attendance/employees/${employeeId}`,
      '/contracts/expiring',
      '/contracts/law-warnings',
      '/employments/probation-ending',
      '/leave/calendar',
      '/wfh',
      '/wfh/calendar',
      '/reports/salary-raises',
      `/offboarding/employees/${employeeId}`,
      `/onboarding/employees/${employeeId}`,
      `/audit?entityType=employment&entityId=${employmentId}`,
      `/audit?entityType=contract&entityId=${contractId}`,
      // the home page's cards and Approvals (owner, 23 October 2026: "in developer view use **** instead of IDs", seen
      // on Contracts Ending Soon): the contracts ending, the probations ending, the endings and raises waiting for the
      // CEO, the raise requests and the details changes waiting, the second person's profile and contracts
      '/contracts/expiring?within=90',
      '/employments/probation-ending?within=30',
      '/endings?status=pending_ceo',
      '/raises/pending',
      '/raise-requests?status=with_hr',
      '/home-locations?status=waiting',
      '/kpis/scorecards/waiting',
      `/employees/${endedId}`,
      `/employees/${endedId}/employments/${endedEmploymentId}/contracts`,
      `/audit?entityType=employee&entityId=${endedId}`,
    ];
    // the company's setup pages: their departments and job titles are the company's (checked by the test below)
    const company = new Set(['/org-chart', '/departments', '/recruitment/vacancies', `/recruitment/vacancies/${vacancyId}`]);
    const answered: string[] = [];
    for (const path of paths) {
      const res = await as('developer').get(path);
      expect([200, 400, 403, 404], `${path}: ${res.status}`).toContain(res.status);
      if (res.status === 200) answered.push(path);
      expect(personalLeaks(res.body, Object.values(emails)), path).toEqual([]);
      expect(leaks(res.body), path).toEqual([]);
      // no person's code, the seeded people's or anyone's (23 October 2026)
      expect(codeLeaks(res.body, codes()), path).toEqual([]);
      // the person's job title, department, grade, hire and contract dates, insurance office, registration and number
      if (!company.has(path)) expect(jobLeaks(res.body, allDates()), path).toEqual([]);
    }
    expect(answered.length, answered.join(' ')).toBeGreaterThan(paths.length * 0.6);
    // the person shows by their pseudonym in the list, the same as on their page
    const tagged = (await as('developer').get(`/employees/${employeeId}`).expect(200)).body.fullNameEn as string;
    expect(JSON.stringify((await as('developer').get('/employees').expect(200)).body)).toContain(`"${tagged}"`);
    // and HR's list has them by name
    expect(JSON.stringify((await as('hr').get('/employees').expect(200)).body)).toContain(FULL_EN);
  });

  // The owner, 23 October 2026, as a developer, on the home page: "Employee EMP-0023 · EMP-0023", "Ends 11/03/2024",
  // "Passed", "Became open-ended — Art. 88"; "in developer view use **** instead of IDs"
  it('the home page’s cards: the contracts ending, the law’s warnings and the probations ending without a date or a code; HR’s with them', async () => {
    const dev = {
      expiring: (await as('developer').get('/contracts/expiring?within=90').expect(200)).body as Record<string, unknown>[],
      warnings: (await as('developer').get('/contracts/law-warnings').expect(200)).body as Record<string, unknown>[],
      probations: (await as('developer').get('/employments/probation-ending?within=30').expect(200)).body as Record<string, unknown>[],
    };
    const ending = dev.expiring.find((c) => c.employmentId === endedEmploymentId) as { number: string; endDate: unknown; nonRenewalNoticeBy: unknown; becameOpenEnded: boolean; employee: { id: string; employeeCode: string; fullNameEn: string } };
    expect(ending).toMatchObject({ number: HIDDEN, endDate: null, nonRenewalNoticeBy: null, employee: { id: endedId, employeeCode: HIDDEN } });
    expect(ending.employee.fullNameEn).toMatch(TAGGED);
    // its status stays: open-ended by the law
    expect(ending.becameOpenEnded).toBe(true);
    const warning = dev.warnings.find((w) => w.employmentId === endedEmploymentId) as { kind: string; since: unknown; contractNumber: string; message: string; employee: { fullNameEn: string } };
    expect(warning).toMatchObject({ kind: 'became_open_ended', since: null, contractNumber: HIDDEN });
    expect(warning.message).toContain('Art. 88');
    // the same person, the same tag, from card to card and on their profile
    expect(warning.employee.fullNameEn).toBe(ending.employee.fullNameEn);
    expect((await as('developer').get(`/employees/${endedId}`).expect(200)).body.fullNameEn).toBe(ending.employee.fullNameEn);
    for (const rows of Object.values(dev)) {
      expect(codeLeaks(rows, codes())).toEqual([]);
      expect(jobLeaks(rows, allDates())).toEqual([]);
    }
    // a probation ending's date (the second person's, past and not confirmed): hidden
    for (const p of dev.probations) expect(p.probationEnd).toBeNull();

    // HR: the dates and the codes
    const hrExpiring = (await as('hr').get('/contracts/expiring?within=90').expect(200)).body as { employmentId: string; number: string; endDate: string; employee: { employeeCode: string; fullNameEn: string } }[];
    expect(hrExpiring.find((c) => c.employmentId === endedEmploymentId)).toMatchObject({ number: endedNumber, endDate: endedDates[1], employee: { employeeCode: endedCode, fullNameEn: ENDED_EN } });
    const hrWarning = ((await as('hr').get('/contracts/law-warnings').expect(200)).body as { employmentId: string; since: string; message: string }[]).find((w) => w.employmentId === endedEmploymentId);
    expect(hrWarning?.since).toBe(endedDates[1]);
    expect(hrWarning?.message).toContain(endedNumber);
  });

  it('tags: the same on every page, never the code; HR sees the codes', async () => {
    const profile = (await as('developer').get(`/employees/${employeeId}`).expect(200)).body;
    const name = profile.fullNameEn as string;
    expect(name).toMatch(TAGGED);
    // never the code's own number
    expect(tagIn(name)).not.toBe(employeeCode.replace(/\D/g, ''));
    const list = (await as('developer').get('/employees').expect(200)).body as { id: string; fullNameEn: string; employeeCode: string }[];
    expect(list.find((e) => e.id === employeeId)).toMatchObject({ fullNameEn: name, employeeCode: HIDDEN });
    const run = (await as('developer').get(`/payroll/runs/${runId}`).expect(200)).body as { lines: { employeeId: string; name: string; employeeCode: string }[] };
    expect(run.lines.find((l) => l.employeeId === employeeId)).toMatchObject({ name, employeeCode: HIDDEN });
    // two people, two tags
    expect((await as('developer').get(`/employees/${endedId}`).expect(200)).body.fullNameEn).not.toBe(name);
    // the offer: "Candidate" and a tag, on its page and in the list
    const offer = (await as('developer').get(`/offers/${offerId}`).expect(200)).body;
    expect(offer.fullNameEn).toMatch(/^Candidate [2-9A-HJ-NP-Z]{4,6}$/);
    expect(offer.number).toBe(HIDDEN);
    expect(JSON.stringify((await as('developer').get('/offers').expect(200)).body)).toContain(`"${offer.fullNameEn}"`);
    // the candidate and their general CV: one person, one tag
    const candidate = (await as('developer').get(`/recruitment/candidates/${candidateId}`).expect(200)).body;
    const generalCv = (await as('developer').get(`/recruitment/general-cvs/${generalCvId}`).expect(200)).body;
    expect(candidate.fullName).toMatch(/^Candidate [2-9A-HJ-NP-Z]{4,6}$/);
    expect(generalCv.fullName).toBe(`Applicant ${tagIn(candidate.fullName)}`);
    expect(generalCv.number).toBe(HIDDEN);
    expect(codeLeaks([profile, list, run, offer, candidate, generalCv], codes())).toEqual([]);
    // HR: the real codes
    expect((await as('hr').get(`/employees/${employeeId}`).expect(200)).body.employeeCode).toBe(employeeCode);
    expect((await as('hr').get(`/offers/${offerId}`).expect(200)).body.number).toBe(offerNumber);
    expect((await as('hr').get(`/recruitment/candidates/${candidateId}`).expect(200)).body.code).toBe(candidateCode);
    expect((await as('hr').get(`/recruitment/general-cvs/${generalCvId}`).expect(200)).body.number).toBe(generalCvNumber);
  });

  // 22 October 2026: "why is the employment data can be viewed by developer access" → "Hide per-person details", "and the
  // social insurance"
  it('a profile’s employment and social insurance: "••••" or null for a developer; HR sees them', async () => {
    const dev = (await as('developer').get(`/employees/${employeeId}`).expect(200)).body;
    expect(dev.employment).toMatchObject({
      employmentType: HIDDEN,
      departmentId: null,
      jobTitleId: null,
      gradeId: null,
      joinDate: null,
      probationEnd: null,
      department: { id: null, nameEn: HIDDEN },
      jobTitle: { id: null, titleEn: HIDDEN },
      grade: { id: null, code: HIDDEN, levelEn: HIDDEN },
    });
    expect(dev.employment.contract).toMatchObject({ startDate: null, endDate: null, signedOn: null, insuranceFiledOn: null, jobTitleEn: HIDDEN, departmentName: HIDDEN, gradeCode: HIDDEN });
    expect(dev).toMatchObject({ insuranceNo: HIDDEN, occupationCode: HIDDEN, insuranceStartDate: null, socialInsured: null });
    // statuses stay, for debugging
    expect(['active', 'probation']).toContain(dev.employment.status);
    expect(jobLeaks(dev, contractDates)).toEqual([]);
    // HR sees them all
    const hr = (await as('hr').get(`/employees/${employeeId}`).expect(200)).body;
    expect(hr.employment).toMatchObject({
      employmentType: 'full_time',
      departmentId,
      jobTitleId,
      gradeId: ownGradeId,
      joinDate: JOINED,
      department: { id: departmentId, nameEn: DEPARTMENT },
      jobTitle: { id: jobTitleId, titleEn: JOB_TITLE },
      grade: { id: ownGradeId, code: GRADE_CODE, levelEn: GRADE_LEVEL },
    });
    expect(hr.employment.contract).toMatchObject({ insuranceFiledOn: FILED_ON, jobTitleEn: JOB_TITLE, gradeCode: GRADE_CODE });
    expect(hr).toMatchObject({ insuranceNo: INSURANCE_NO, occupationCode: '194200', insuranceStartDate: INSURANCE_START, socialInsured: true });
    expect(jobLeaks(hr, contractDates)).toEqual(expect.arrayContaining([DEPARTMENT, JOB_TITLE, GRADE_CODE, GRADE_LEVEL, INSURANCE_NO, JOINED, INSURANCE_START, FILED_ON]));
    expect(jobLeaks((await as('hr').get('/contracts').expect(200)).body, contractDates)).toEqual(expect.arrayContaining([JOB_TITLE, FILED_ON, ...contractDates]));
  });

  it('the company’s setup pages: departments, job titles, grades and the org chart named, their people cut off', async () => {
    const departments = (await as('developer').get('/departments').expect(200)).body as { id: string; nameEn: string; headId: string | null; head: object | null }[];
    expect(departments.find((d) => d.id === departmentId)).toMatchObject({ nameEn: DEPARTMENT, headId: null, head: { id: null, employeeCode: HIDDEN, fullNameEn: HIDDEN } });
    expect(JSON.stringify(departments)).not.toContain(employeeCode);
    expect(JSON.stringify(departments)).not.toContain(employeeId);
    expect(JSON.stringify((await as('developer').get('/job-titles').expect(200)).body)).toContain(JOB_TITLE);
    expect(JSON.stringify((await as('developer').get(`/job-titles/${jobTitleId}`).expect(200)).body)).toContain(DEPARTMENT);
    const grades = JSON.stringify((await as('developer').get('/grades').expect(200)).body);
    expect(grades).toContain(GRADE_CODE);
    expect(grades).toContain(GRADE_LEVEL);
    // the org chart: its departments and job titles with their headcount, nobody named
    const chart = (await as('developer').get('/org-chart').expect(200)).body;
    expect(chart.showsPeople).toBe(false);
    const drawn = JSON.stringify(chart);
    expect(drawn).toContain(DEPARTMENT);
    expect(drawn).toContain(JOB_TITLE);
    expect(drawn).not.toContain(employeeCode);
    expect(drawn).not.toContain(employeeId);
    // the company's own social insurance registration stays readable
    expect((await as('developer').get('/company').expect(200)).body.insuranceOffice).toBe(OFFICE);
    // HR: the head named, the people on the org chart
    const theirs = (await as('hr').get('/departments').expect(200)).body as { id: string; head: { employeeCode: string } | null }[];
    expect(theirs.find((d) => d.id === departmentId)?.head?.employeeCode).toBe(employeeCode);
    expect(JSON.stringify((await as('hr').get('/org-chart').expect(200)).body)).toContain(employeeCode);
  });

  it('a filter by department doesn’t narrow a developer’s list of people; HR’s it does', async () => {
    // by the person's id: a developer's lists carry no code (23 October 2026)
    const lists = (body: unknown) => JSON.stringify(body).includes(employeeId);
    expect(lists((await as('hr').get('/attendance').expect(200)).body)).toBe(true);
    expect(lists((await as('hr').get(`/attendance?departmentId=${otherDepartmentId}`).expect(200)).body)).toBe(false);
    const dev = (await as('developer').get(`/attendance?departmentId=${otherDepartmentId}`).expect(200)).body;
    expect(lists(dev)).toBe(true);
    // the employees list: everyone, whatever the department
    const everyone = (await as('developer').get('/employees').expect(200)).body as unknown[];
    const filtered = (await as('developer').get(`/employees?departmentId=${otherDepartmentId}`).expect(200)).body as unknown[];
    expect(filtered.length).toBe(everyone.length);
    expect(lists(filtered)).toBe(true);
  });

  it('the social insurance forms, the employee file and what was read from its papers: refused', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    for (const path of [`/documents/${unknown}/file`, `/documents/${unknown}/signed-file`, `/documents/${unknown}/esign-file`, `/paperwork/${unknown}/file`, `/paperwork/${unknown}/text`]) {
      const res = await as('developer').get(path);
      expect(res.status, path).toBe(403);
      expect(res.body.message, path).toBe(DEVELOPER_NO_FILES);
    }
    // generating Form 1 is a change, refused as every change
    const made = await as('developer').post(`/employees/${employeeId}/documents`, { slotKey: 'insurance_form_1' });
    expect(made.status).toBe(403);
    expect(made.body.message).toBe(DEVELOPER_READ_ONLY);
  });

  // candidate profiles (22 October 2026: "how to make like a profile for each candidate …")
  it('a candidate: "Candidate" and a tag, no name, code, email or mobile; found by no search; nothing merged', async () => {
    const profile = (await as('developer').get(`/recruitment/candidates/${candidateId}`).expect(200)).body;
    expect(profile.code).toBe(HIDDEN);
    expect(profile.fullName).toMatch(/^Candidate [2-9A-HJ-NP-Z]{4,6}$/);
    const answers = JSON.stringify([
      profile,
      (await as('developer').get('/recruitment/candidates').expect(200)).body,
      (await as('developer').get('/recruitment/candidates/matches').expect(200)).body,
      (await as('developer').get(`/recruitment/general-cvs/${generalCvId}`).expect(200)).body,
    ]);
    for (const v of [CANDIDATE_NAME, CANDIDATE_EMAIL, CANDIDATE_MOBILE, CANDIDATE_MOBILE.slice(3), candidateCode, generalCvNumber]) expect(answers).not.toContain(v);
    expect((await as('developer').get(`/recruitment/candidates?q=${encodeURIComponent(CANDIDATE_NAME)}`).expect(200)).body).toEqual([]);
    // nor by the code (23 October 2026: a code search would link a real code to its tag)
    expect((await as('developer').get(`/recruitment/candidates?q=${candidateCode}`).expect(200)).body).toEqual([]);
    expect(((await as('hr').get(`/recruitment/candidates?q=${candidateCode}`).expect(200)).body as { id: string }[]).map((c) => c.id)).toEqual([candidateId]);
    const merge = await as('developer').post(`/recruitment/candidates/${candidateId}/merge`, { otherId: candidateId });
    expect(merge.status).toBe(403);
    expect(merge.body.message).toBe(DEVELOPER_READ_ONLY);
    // HR sees them as they are
    expect((await as('hr').get(`/recruitment/candidates/${candidateId}`).expect(200)).body.fullName).toBe(CANDIDATE_NAME);
  });

  // screening comments (owner, 24 October 2026: "is there a way to add screening comments?")
  it('a screening comment: its text "••••", its author and those mentioned pseudonyms, its verdict as it is; HR reads it all', async () => {
    const seen = (await as('developer').get(`/recruitment/candidates/${candidateId}/comments`).expect(200)).body as ScreeningComments;
    const general = seen.comments.find((c) => c.about.kind === 'general')!;
    expect(general).toMatchObject({ comment: HIDDEN, verdict: 'good_fit', authorRole: 'hr' });
    expect(general.author?.email).not.toBe(emails.hr);
    expect(general.mentions).toHaveLength(1);
    expect(general.mentions[0].email).not.toBe(emails.ceo);
    expect(personalLeaks(seen, Object.values(emails))).toEqual([]);
    expect(codeLeaks(seen, codes())).toEqual([]);
    const hr = (await as('hr').get(`/recruitment/candidates/${candidateId}/comments`).expect(200)).body as ScreeningComments;
    expect(hr.comments.find((c) => c.about.kind === 'general')).toMatchObject({ comment: SCREENING_TEXT, author: { email: emails.hr } });
    // and writes none
    const res = await as('developer').post('/recruitment/comments', { candidateId, comment: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(DEVELOPER_READ_ONLY);
  });

  // Suggested From Earlier CVs (owner, 24 October 2026: "Suggest; HR adds"; "Yes, HR presses 'Invite to apply'")
  it('a suggested CV: its person a pseudonym, its codes "••••", the title its reason found and the invitation’s address hidden; HR reads them', async () => {
    const seen = (await as('developer').get(`/recruitment/vacancies/${vacancyId}/suggestions?status=invited`).expect(200)).body as VacancySuggestions;
    const row = seen.rows.find((r) => r.source?.id === generalCvId)!;
    expect(row.candidate.fullName).toMatch(TAGGED);
    expect(row.candidate.code).toBe(HIDDEN);
    expect(row.source).toMatchObject({ kind: 'general_cv', number: HIDDEN });
    expect(row.reasons).toEqual([
      { kind: 'skills', found: ['Premiere Pro'], listed: 1, points: 35 },
      { kind: 'title', from: 'cv', matchedTitle: HIDDEN, points: 20 },
    ]);
    expect(row.email).toMatch(/@hidden\.invalid$/);
    expect(row.sentTo).toMatch(/@hidden\.invalid$/);
    expect(row.cv?.cvFileName).toBe(HIDDEN);
    const text = JSON.stringify(seen);
    for (const real of [CANDIDATE_NAME, CANDIDATE_EMAIL, PAST_TITLE]) expect(text).not.toContain(real);
    expect(codeLeaks(seen, codes())).toEqual([]);
    expect(personalLeaks(seen, Object.values(emails))).toEqual([]);
    const hr = (await as('hr').get(`/recruitment/vacancies/${vacancyId}/suggestions?status=invited`).expect(200)).body as VacancySuggestions;
    expect(hr.rows.find((r) => r.source?.id === generalCvId)).toMatchObject({ candidate: { fullName: CANDIDATE_NAME, code: candidateCode }, sentTo: CANDIDATE_EMAIL });
    // and decides on none
    const res = await as('developer').post(`/recruitment/suggestions/${row.id}/dismiss`, {});
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(DEVELOPER_READ_ONLY);
  });

  // more read from a CV (owner, 24 October 2026: "CV years in list + more rules")
  it('what a CV says: the past jobs, school, certifications and city "••••"; the years and the dictionary’s skills as they are', async () => {
    const hr = (await as('hr').get(`/recruitment/general-cvs/${generalCvId}`).expect(200)).body;
    expect(hr.cvReading).toMatchObject({
      latestTitle: PAST_TITLE,
      latestCompany: PAST_COMPANY,
      educationDetails: [{ institution: CV_SCHOOL, degree: 'Bachelor of Film', graduationYear: 2018 }],
      certifications: [CV_CERTIFICATION],
      cvSkills: ['Premiere Pro'],
      city: CV_CITY,
    });
    const seen = (await as('developer').get(`/recruitment/general-cvs/${generalCvId}`).expect(200)).body;
    expect(seen.cvReading).toMatchObject({
      experience: hr.cvReading.experience,
      latestTitle: HIDDEN,
      latestCompany: HIDDEN,
      workHistory: [{ pastTitle: HIDDEN, pastCompany: HIDDEN, from: '2022-01', to: null, current: true }],
      educationDetails: [{ institution: HIDDEN, degree: null, graduationYear: null }],
      certifications: [HIDDEN],
      cvSkills: ['Premiere Pro'],
      city: HIDDEN,
    });
    const lists = [(await as('developer').get('/recruitment/general-cvs').expect(200)).body, (await as('developer').get('/recruitment/candidates').expect(200)).body] as {
      id: string;
      fromCv?: { latestTitle: string | null; experienceMonths: number | null } | null;
    }[][];
    for (const rows of lists) expect(rows.find((r) => r.id === generalCvId || r.id === candidateId)?.fromCv).toMatchObject({ latestTitle: HIDDEN, experienceMonths: expect.any(Number) });
    expect(personalLeaks([seen, lists], [])).toEqual([]);
  });

  // 23 October 2026: "people search is off for developers"; assets are still found by their codes
  it('a search for people finds nothing for a developer, by a name or a code; an asset’s code finds; HR finds by both', async () => {
    const searches: [string, string][] = [
      ['/offers', OFFER_NAME],
      ['/offers', offerNumber],
      ['/contracts', FULL_EN],
      ['/contracts', employeeCode],
      ['/contracts', contractNumber],
      ['/recruitment/general-cvs', generalCvNumber],
      ['/recruitment/general-cvs', CANDIDATE_NAME],
      ['/assets', employeeCode],
      ['/assets/custody/people', employeeCode],
    ];
    for (const [path, q] of searches) {
      const res = await as('developer').get(`${path}?q=${encodeURIComponent(q)}`);
      expect([200, 403], `${path}?q=${q}: ${res.status}`).toContain(res.status);
      const text = JSON.stringify(res.body);
      for (const id of [offerId, contractId, generalCvId, employeeId, assetCode]) expect(text, `${path}?q=${q}`).not.toContain(id);
    }
    // an asset by its code, as before
    expect(JSON.stringify((await as('developer').get(`/assets?q=${encodeURIComponent(assetCode)}`).expect(200)).body)).toContain(assetCode);
    // HR: by a name and by a code
    expect(JSON.stringify((await as('hr').get(`/offers?q=${encodeURIComponent(OFFER_NAME)}`).expect(200)).body)).toContain(offerNumber);
    expect(JSON.stringify((await as('hr').get(`/offers?q=${encodeURIComponent(offerNumber)}`).expect(200)).body)).toContain(offerNumber);
    expect(JSON.stringify((await as('hr').get(`/contracts?q=${encodeURIComponent(employeeCode)}`).expect(200)).body)).toContain(contractNumber);
  });

  it('an employee’s photo: refused to a developer', async () => {
    const res = await as('developer').get('/paperwork/00000000-0000-4000-8000-000000000000/photo');
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(DEVELOPER_NO_FILES);
  });

  it('a payroll run and its lines: every amount 0, the days and hours as they are', async () => {
    const run = (await as('developer').get(`/payroll/runs/${runId}`).expect(200)).body;
    const line = run.lines.find((l: { employeeId: string }) => l.employeeId === employeeId);
    expect(line).toBeDefined();
    expect(line.terms.gross).toBe(0);
    expect(line.result.net).toBe(0);
    expect(line.terms.paidDays).toBeGreaterThan(0);
    expect(run.totals.net).toBe(0);
    expect(leaks(run)).toEqual([]);
    expect(leaks((await as('developer').get('/payroll/runs').expect(200)).body)).toEqual([]);
    // HR sees the real gross
    expect((await as('hr').get(`/payroll/runs/${runId}`).expect(200)).body.lines.find((l: { employeeId: string }) => l.employeeId === employeeId).terms.gross).toBe(GROSS);
  });

  it('a loan, a claim, an offer, a vacancy and an asset: no amount anywhere', async () => {
    const loan = (await as('developer').get(`/payroll/advances/${loanId}`).expect(200)).body;
    expect(loan.amount).toBe(0);
    const claim = (await as('developer').get(`/reimbursements/${claimId}`).expect(200)).body;
    expect(claim.amount).toBe(0);
    const offer = (await as('developer').get(`/offers/${offerId}`).expect(200)).body;
    const vacancy = (await as('developer').get(`/recruitment/vacancies/${vacancyId}`).expect(200)).body;
    expect(vacancy.salaryMin).toBe(0);
    const asset = (await as('developer').get(`/assets/${assetCode}`).expect(200)).body;
    expect(leaks([loan, claim, offer, vacancy, asset])).toEqual([]);
    // the lists too
    for (const path of ['/payroll/advances', '/reimbursements', '/offers', '/recruitment/vacancies', '/assets', `/employees/${employeeId}/deduction-plans`]) {
      const res = await as('developer').get(path);
      expect([200, 403], path).toContain(res.status);
      expect(leaks(res.body), path).toEqual([]);
    }
  });

  it('every other page with pay on it: none of the amounts or IDs in any answer', async () => {
    const paths = [
      '/employees',
      `/employees/${employeeId}/employments/${employmentId}/contracts`,
      '/contracts',
      '/contracts/expiring',
      '/contracts/law-warnings',
      '/endings',
      '/raises/pending',
      `/employees/${employeeId}/salary-history`,
      `/employees/${employeeId}/raise-requests`,
      '/raise-requests',
      '/reports/salary-raises',
      '/payroll/adjustments',
      '/payroll/adjustments/choices',
      `/payroll/advances/limit?employeeId=${employeeId}`,
      '/payroll/recurring-deductions',
      `/payroll/statistics?year=${MONTH.slice(0, 4)}`,
      '/payroll/unsettled',
      `/payroll/final-settlements/${employmentId}`,
      `/employees/${employeeId}/payslips`,
      '/me/payslips',
      '/payroll/settings',
      '/kpis/overview',
      '/offboarding/turnover',
      `/offboarding/employees/${employeeId}`,
    ];
    const answered: string[] = [];
    for (const path of paths) {
      const res = await as('developer').get(path);
      expect([200, 400, 403, 404], `${path}: ${res.status}`).toContain(res.status);
      if (res.status === 200) answered.push(path);
      expect(leaks(res.body), path).toEqual([]);
    }
    // most of them open for a developer, as for the owner
    expect(answered.length).toBeGreaterThan(paths.length / 2);
    // the same pages carry them for HR: hidden for the developer, not missing
    for (const path of ['/contracts', `/employees/${employeeId}/salary-history`, `/employees/${employeeId}/employments/${employmentId}/contracts`]) {
      expect(leaks((await as('hr').get(path).expect(200)).body), path).toContain(String(GROSS));
    }
  });

  it('the audit log: the money and IDs changed shown hidden', async () => {
    const log = (await as('developer').get(`/audit?entityType=employee&entityId=${employeeId}`).expect(200)).body;
    expect(leaks(log)).toEqual([]);
    const all = (await as('developer').get('/audit').expect(200)).body;
    expect(leaks(all)).toEqual([]);
  });

  it('changes nothing: every kind of write refused, but signing out, ending a session and the own password', async () => {
    for (const res of [
      await as('developer').post('/employees', { fullNameEn: `Nope ${RUN}`, fullNameAr: 'لا' }),
      await as('developer').patch(`/employees/${employeeId}`, { notes: 'x' }),
      await as('developer').put('/kpis/framework', { appliesFrom: CURRENT, attendancePillar: 'x', pillars: [] }),
      await as('developer').del(`/assets/${assetCode}`),
      await as('developer').post(`/payroll/runs/${runId}/submit`),
      await as('developer').post('/auth/view-as', { userId: users.hr }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(DEVELOPER_READ_ONLY);
    }
    // their own password: asked, and checked (a wrong one is a 400, not a refusal)
    expect((await as('developer').post('/auth/change-password', { currentPassword: 'wrong-password-1', newPassword: `${PASSWORD}-new` })).status).toBe(400);
  });

  it('files with pay or IDs refused before they are made; a picture without them given', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    for (const path of [
      `/payroll/runs/${runId}/files/register`,
      `/payroll/runs/${runId}/files/cib`,
      `/payroll/lines/${unknown}/payslip/en`,
      `/payroll/runs/${runId}/payslips`,
      `/documents/${unknown}/file`,
      `/paperwork/${unknown}/file`,
      '/payroll/statistics/workbook',
      '/audit/export',
      // the meetings' apps, connections and choices (24 October 2026: "make it both"): their credentials and accounts
      '/meetings/settings',
      '/meetings/mine',
      '/meetings/choices',
      `/recruitment/applications/${unknown}/cv`,
      // the CV window's PDF (24 October 2026: "open it in a popup window")
      `/recruitment/applications/${unknown}/cv/preview`,
      `/recruitment/general-cvs/${generalCvId}/cv/preview`,
    ]) {
      const res = await as('developer').get(path);
      expect(res.status, path).toBe(403);
      expect(res.body.message, path).toBe(DEVELOPER_NO_FILES);
    }
    // the company's logo is no secret: answered as for anyone (none set: 404)
    expect([200, 404]).toContain((await as('developer').get('/company/logo')).status);
  });

  it('never told of what waits for HR or the CEO; what they opened is logged with the values hidden', async () => {
    expect(await prisma.notification.count({ where: { userId: users.developer } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: users.ceo, kind: 'vacancy_waiting' } })).toBeGreaterThan(0);
    const seen = await prisma.auditLog.findMany({ where: { userId: users.developer, entityType: 'employee', entityId: employeeId }, select: { action: true, diff: true } });
    expect(seen.map((s) => s.action)).toEqual(expect.arrayContaining(['view_hidden']));
    expect(seen.map((s) => s.action)).not.toContain('view_restricted');
    expect(seen.find((s) => s.action === 'view_hidden')?.diff).toMatchObject({ hidden: true });
  });
});
