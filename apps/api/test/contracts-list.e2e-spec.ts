import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The company-wide contracts list (GET /contracts) behind the Contracts page: HR, Finance and the CEO. Other test files
// add contracts to the same database, so most checks search for this run's people (their names end with RUN) and the
// rest only check what holds for every contract listed. Dates that matter to "ending within" are counted from today.

const RUN = Date.now().toString(36).toLowerCase();

/** A contract in the list, as the API sends it. */
interface Item {
  id: string;
  number: string;
  version: number;
  form: string;
  status: string;
  startDate: string;
  endDate: string | null;
  grossSalary: number | null;
  insuredSalary: number | null;
  salaryHidden: boolean;
  employee: { id: string; employeeCode: string; fullNameEn: string; fullNameAr: string };
  employmentId: string;
  employmentType: string;
  employmentCurrent: boolean;
  jobTitleEn: string | null;
  departmentName: string | null;
  [key: string]: unknown;
}

/** A contract version as the employment's own list sends it. */
interface Contract {
  id: string;
  number: string;
  version: number;
  startDate: string;
  endDate: string | null;
  nonRenewalNoticeBy: string | null;
  [key: string]: unknown;
}

/** Someone hired: the employee and their current employment. */
interface Hire {
  id: string;
  employmentId: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameAr: string;
}

describe('Contracts list (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  const today = todayInCairo();
  const api = () => request(app.getHttpServer());

  // this run's people and contracts (see beforeAll)
  let soon: Hire; // signed, ends in about 10 days; an Arabic name to search for
  let soonC: Contract;
  let overdue: Hire; // signed, ended about 6 days ago, the employment still current
  let overdueC: Contract;
  let later: Hire; // part time, paid by the hour with an allowance, signed, ends in about 9 months
  let laterC: Contract;
  let moved: Hire; // signed in the Desk team 9 months ago, then moved to the Field team; a renewal drafted since
  let movedV1: Contract;
  let movedV2: Contract;
  let drafted: Hire; // a trainee (Sales before 18 October 2026: now Full-time paid by commission), only a draft, in the department itself
  let draftedC: Contract;
  let renewed: Hire; // freelance, hired 30 months ago: three versions, two superseded, the third ends in about 6 months
  let renewedV1: Contract;
  let renewedV2: Contract;
  let renewedV3: Contract;
  let leaver: Hire; // the employment ended, so did its contract
  let leaverC: Contract;
  let deptName: string;

  async function hire(name: string, employment: Record<string, unknown> = {}, fullNameAr = 'موظف قائمة العقود'): Promise<Hire> {
    const added = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr }).expect(201);
    const res = await api()
      .post(`/api/employees/${added.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: '2026-01-15', ...employment })
      .expect(201);
    return { id: res.body.id, employmentId: res.body.employment.id, employeeCode: res.body.employeeCode, fullNameEn: res.body.fullNameEn, fullNameAr: res.body.fullNameAr };
  }

  async function draft(e: Hire, body: object = {}): Promise<Contract> {
    const res = await api()
      .post(`/api/employees/${e.id}/employments/${e.employmentId}/contracts`)
      .set('Cookie', hr)
      .send({ grossSalary: 12000, ...body })
      .expect(201);
    return res.body as Contract;
  }

  /** Signed on its start date (today if it starts later). */
  async function sign(c: Contract): Promise<Contract> {
    const res = await api()
      .post(`/api/contracts/${c.id}/sign`)
      .set('Cookie', hr)
      .send({ signedOn: c.startDate <= today ? c.startDate : today })
      .expect(200);
    return res.body as Contract;
  }

  async function list(query: Record<string, string | number> = {}, session = hr): Promise<Item[]> {
    return (await api().get('/api/contracts').query(query).set('Cookie', session).expect(200)).body as Item[];
  }

  const ids = (items: Item[]) => items.map((i) => i.id);
  /** This run's contracts only, with these filters. */
  const mine = (query: Record<string, string | number> = {}, session = hr) => list({ q: RUN, ...query }, session);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));

    deptName = `Ops ${RUN}`;
    const dept = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: deptName }).expect(201);
    const desk = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Desk', parentId: dept.body.id }).expect(201);
    const field = await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Field', parentId: dept.body.id }).expect(201);
    const title = async (departmentId: string, titleEn: string) =>
      (await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId, titleEn, titleAr: 'مسمى وظيفي' }).expect(201)).body.id as string;
    const deskOfficer = await title(desk.body.id, 'Desk Officer');
    const fieldLead = await title(field.body.id, 'Field Lead');
    const opsHead = await title(dept.body.id, 'Ops Head');

    soon = await hire('Soon Ending', { joinDate: addDays(addMonths(today, -12), 11) }, 'شيماء عبد الستار');
    soonC = await sign(await draft(soon));
    overdue = await hire('Overdue Contract', { joinDate: addDays(addMonths(today, -12), -5) });
    overdueC = await sign(await draft(overdue));
    // by the hour, 3 days a week, with a transport allowance (owner's requests, 15 October 2026)
    const transport = await api().post('/api/allowance-types').set('Cookie', hr).send({ nameEn: `List Transport ${RUN}`, nameAr: 'بدل انتقال' }).expect(201);
    later = await hire('Later Ending', { employmentType: 'part_time', joinDate: addDays(today, -100) });
    laterC = await sign(
      await draft(later, { payBasis: 'hourly', hourlyRate: 150, hoursPerWeek: 24, daysPerWeek: 3, allowances: [{ allowanceTypeId: transport.body.id, amount: 400 }] }),
    );

    // signed in the Desk team, then moved to the Field team: the signed version keeps what was signed, the renewal
    // drafted after the move shows where the person is now
    moved = await hire('Moved Team', { jobTitleId: deskOfficer, joinDate: addMonths(today, -9) });
    movedV1 = await sign(await draft(moved, { grossSalary: 15000 }));
    await api().patch(`/api/employees/${moved.id}/employments/${moved.employmentId}`).set('Cookie', hr).send({ jobTitleId: fieldLead }).expect(200);
    // new pay: a reason, for the CEO to approve before it is signed (owner's decisions, 16 October 2026)
    movedV2 = await draft(moved, { grossSalary: 14000, raiseReason: 'adjustment' });

    drafted = await hire('Draft Only', { employmentType: 'trainee', jobTitleId: opsHead });
    // the newest draft: a training agreement, with its stages (Labour Law Art. 29; owner, 18 October 2026)
    draftedC = await draft(drafted, { traineeStages: [{ name: 'Basics', months: 12, pay: 12000 }] });

    renewed = await hire('Renewed Twice', { employmentType: 'freelance', joinDate: addMonths(today, -30) });
    renewedV1 = await sign(await draft(renewed));
    renewedV2 = await sign(await draft(renewed));
    renewedV3 = await sign(await draft(renewed));

    leaver = await hire('Leaver', { joinDate: '2026-02-01' });
    leaverC = await sign(await draft(leaver));
    await api()
      .post(`/api/employees/${leaver.id}/employments/${leaver.employmentId}/end`)
      .set('Cookie', hr)
      .send({ endDate: '2026-08-31', endReason: 'resigned' })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('HR, the CEO and Finance get it, with the salary; an employee, a manager, an Admin and a Super Admin do not', async () => {
    for (const session of [hr, ceo, finance]) {
      const item = (await mine({}, session)).find((i) => i.id === soonC.id);
      expect(item).toMatchObject({ grossSalary: 12000, insuredSalary: 12000, salaryHidden: false });
    }
    for (const roles of [['employee'], ['manager', 'employee'], ['admin'], ['super_admin']] as const) {
      const session = await signIn(app, await createUser(prisma, [...roles]));
      await api().get('/api/contracts').set('Cookie', session).expect(403);
    }
    // an Admin who is also HR does
    const adminHr = await signIn(app, await createUser(prisma, ['admin', 'hr']));
    expect(ids(await mine({}, adminHr))).toContain(soonC.id);
  });

  it('shows drafts and signed contracts unless a status is asked for, in order: signed by end date, then drafts, newest first', async () => {
    const everyone = await list();
    expect(everyone.length).toBeGreaterThan(0);
    expect(everyone.every((i) => i.status === 'draft' || i.status === 'active')).toBe(true);

    const items = await mine();
    // signed: the end date soonest first (past it first); then the drafts, the newest first
    expect(items.map((i) => [i.number, i.status, i.endDate])).toEqual(
      [overdueC, soonC, movedV1, renewedV3, laterC, draftedC, movedV2].map((c) => [c.number, c.status, c.endDate]),
    );
    // the same order for every contract listed
    const everyActive = everyone.filter((i) => i.status === 'active');
    const lastActive = everyone.findLastIndex((i) => i.status === 'active');
    expect(everyone.slice(0, lastActive + 1).every((i) => i.status === 'active')).toBe(true);
    const ends = everyActive.map((i) => i.endDate ?? '9999-12-31');
    expect(ends).toEqual(ends.toSorted());
    // superseded and ended ones are left out
    for (const c of [renewedV1, renewedV2, leaverC]) expect(ids(items)).not.toContain(c.id);

    // a filter sent empty (e.g. "All") counts as not sent
    expect(ids(await mine({ status: '', form: '', type: '', endingWithin: '' }))).toEqual(ids(items));
  });

  it('filters by status; ended and superseded ones are ordered by start date, newest first', async () => {
    expect(ids(await mine({ status: 'draft' }))).toEqual([draftedC.id, movedV2.id]);
    expect((await mine({ status: 'active' })).every((i) => i.status === 'active')).toBe(true);
    expect(ids(await mine({ status: 'active' }))).toEqual(ids((await mine()).filter((i) => i.status === 'active')));

    const superseded = await mine({ status: 'superseded' });
    expect(superseded.map((i) => [i.id, i.startDate])).toEqual([
      [renewedV2.id, renewedV2.startDate],
      [renewedV1.id, addMonths(today, -30)],
    ]);
    expect(renewedV2.startDate).toBe(addDays(renewedV1.endDate!, 1));
    const ended = await mine({ status: 'ended' });
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ id: leaverC.id, status: 'ended', employmentId: leaver.employmentId, employmentCurrent: false });
    expect((await list({ status: 'ended' })).every((i) => i.status === 'ended')).toBe(true);
  });

  it('filters by form (every contract here is fixed-term) and by employment type', async () => {
    const fixed = await mine({ form: 'fixed' });
    expect(fixed.every((i) => i.form === 'fixed')).toBe(true);
    expect(ids(fixed)).toEqual(ids(await mine()));

    expect(ids(await mine({ type: 'part_time' }))).toEqual([laterC.id]);
    expect(ids(await mine({ type: 'trainee' }))).toEqual([draftedC.id]);
    // open-ended and specific-job contracts came back on 18 October 2026: none here
    expect(ids(await mine({ type: 'trainee', form: 'open_ended' }))).toEqual([]);
    expect(ids(await mine({ form: 'specific_job' }))).toEqual([]);
    expect(ids(await mine({ type: 'freelance', status: 'superseded' }))).toEqual([renewedV2.id, renewedV1.id]);
    expect((await list({ type: 'part_time' })).every((i) => i.employmentType === 'part_time')).toBe(true);
  });

  it('endingWithin: signed contracts ending within that many days, those already past their end included', async () => {
    const until = addDays(today, 30);
    const within30 = await mine({ endingWithin: 30 });
    expect(ids(within30)).toEqual([overdueC.id, soonC.id]);
    expect(overdueC.endDate! < today && soonC.endDate! > today && soonC.endDate! <= until).toBe(true);

    const everyone = await list({ endingWithin: 30 });
    expect(everyone.every((i) => i.status === 'active' && i.endDate !== null && i.endDate <= until)).toBe(true);
    const ends = everyone.map((i) => i.endDate ?? '');
    expect(ends).toEqual(ends.toSorted());

    // 0 days: ending today or already past the end
    const now = await mine({ endingWithin: 0 });
    expect(ids(now)).toContain(overdueC.id);
    expect(ids(now)).not.toContain(soonC.id);
    expect(ids(await mine({ endingWithin: 366 }))).toEqual([overdueC, soonC, movedV1, renewedV3, laterC].map((c) => c.id));
    // only signed contracts end: with another status, nothing
    expect(await mine({ endingWithin: 30, status: 'draft' })).toEqual([]);
    expect(ids(await mine({ endingWithin: 30, status: 'active' }))).toEqual(ids(within30));
  });

  it('searches the name in English or Arabic, the employee code and the contract number, whatever the case', async () => {
    expect(ids(await list({ q: `overdue CONTRACT ${RUN.toUpperCase()}` }))).toEqual([overdueC.id]);
    expect(ids(await list({ q: `  ${RUN.toUpperCase()}  ` }))).toEqual(ids(await mine()));

    const arabic = await list({ q: 'عبد الستار' });
    expect(ids(arabic)).toContain(soonC.id);
    expect(arabic.every((i) => i.employee.fullNameAr.includes('عبد الستار'))).toBe(true);

    const byCode = await list({ q: moved.employeeCode.toLowerCase() });
    expect(ids(byCode)).toEqual([movedV1.id, movedV2.id]);
    expect(ids(await list({ q: renewed.employeeCode, status: 'superseded' }))).toEqual([renewedV2.id, renewedV1.id]);

    expect(ids(await list({ q: laterC.number.toLowerCase() }))).toEqual([laterC.id]);
    // a superseded contract's number: found when its status is asked for
    expect(await list({ q: renewedV1.number })).toEqual([]);
    expect(ids(await list({ q: renewedV1.number, status: 'superseded' }))).toEqual([renewedV1.id]);
    expect(await list({ q: `nobody-${RUN}` })).toEqual([]);
  });

  it('shows the signed job title and department, and a draft’s current ones', async () => {
    const items = await mine();
    const join = addMonths(today, -9);
    const signed = items.find((i) => i.id === movedV1.id);
    expect(signed).toEqual({
      id: movedV1.id,
      number: movedV1.number,
      version: 1,
      form: 'fixed',
      status: 'active',
      startDate: join,
      endDate: addDays(addMonths(join, 12), -1),
      probationMonths: 3,
      probationEnd: addDays(addMonths(join, 3), -1),
      signedOn: join,
      insuranceFiledOn: null,
      labourOfficeFiledOn: null,
      nonRenewalNoticeBy: movedV1.nonRenewalNoticeBy,
      payBasis: 'monthly',
      hoursPerWeek: null,
      daysPerWeek: null,
      grossSalary: 15000,
      hourlyRate: null,
      allowances: [],
      allowancesTotal: 0,
      totalSalary: 15000,
      insuredSalary: 15000,
      salaryHidden: false,
      // a whole contract, signed (owner's decisions, 16 October 2026: raises are amendments or contracts)
      kind: 'contract',
      stage: 'signed',
      employee: { id: moved.id, employeeCode: moved.employeeCode, fullNameEn: moved.fullNameEn, fullNameAr: moved.fullNameAr },
      employmentId: moved.employmentId,
      employmentType: 'full_time',
      // by the labour law (owner, 18 October 2026): its length's job (none), and the employment's commission, nature
      // of the work and remote work; neither warning
      jobToDo: null,
      traineeMonths: null,
      paidByCommission: false,
      workNature: 'regular',
      workPattern: 'on_site',
      casualTooLong: false,
      becameOpenEnded: false,
      employmentCurrent: true,
      jobTitleEn: 'Desk Officer',
      departmentName: `${deptName} › Desk`,
    });
    expect(movedV1.nonRenewalNoticeBy).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));

    // the renewal drafted after the move: where the person is now, no signing yet, no notice day
    expect(items.find((i) => i.id === movedV2.id)).toMatchObject({
      version: 2,
      status: 'draft',
      startDate: addMonths(join, 12),
      probationMonths: 0,
      probationEnd: null,
      signedOn: null,
      nonRenewalNoticeBy: null,
      grossSalary: 14000,
      insuredSalary: 14000,
      // new pay: a draft for HR to send to the CEO
      stage: 'draft',
      jobTitleEn: 'Field Lead',
      departmentName: `${deptName} › Field`,
      employmentCurrent: true,
    });
    // a job title of the department itself
    expect(items.find((i) => i.id === draftedC.id)).toMatchObject({ jobTitleEn: 'Ops Head', departmentName: deptName, employmentType: 'trainee', traineeMonths: 12 });
    // signed without a job title: none, even though the snapshot is what counts
    expect(items.find((i) => i.id === soonC.id)).toMatchObject({ jobTitleEn: null, departmentName: null, nonRenewalNoticeBy: soonC.nonRenewalNoticeBy });
    // by the hour: the monthly estimate (150 × 24 × 52 ÷ 12) and the allowance on top
    expect(items.find((i) => i.id === laterC.id)).toMatchObject({
      payBasis: 'hourly',
      hourlyRate: 150,
      hoursPerWeek: 24,
      daysPerWeek: 3,
      grossSalary: 15600,
      allowances: [{ nameEn: `List Transport ${RUN}`, nameAr: 'بدل انتقال', taxable: true, insured: false, amount: 400 }],
      allowancesTotal: 400,
      totalSalary: 16000,
      insuredSalary: 15600,
      employmentType: 'part_time',
    });
  });

  it('refuses an unknown status, an unknown contract length, an unknown type, and endingWithin that is not a number of days', async () => {
    const bad = async (query: Record<string, string>) => (await api().get('/api/contracts').query(query).set('Cookie', hr).expect(400)).body.message as string[];
    expect(await bad({ status: 'signed' })).toEqual(['Choose a status: draft, active, ended or superseded.']);
    expect(await bad({ form: 'temporary' })).toEqual(['Choose the contract’s length: fixed (fixed-term), open_ended or specific_job.']);
    expect(await bad({ type: 'contractor' })).toEqual(['Choose an employment type: full_time, part_time, trainee or freelance (outside the labour law).']);
    // the types before 18 October 2026 are gone
    expect(await bad({ type: 'sales' })).toEqual(['Choose an employment type: full_time, part_time, trainee or freelance (outside the labour law).']);
    for (const endingWithin of ['soon', '1.5', '-1', '1831']) {
      expect(await bad({ endingWithin })).toEqual(['Enter endingWithin as a whole number of days, 0 to 1830 (e.g. 30).']);
    }
    expect(await bad({ q: 'x'.repeat(101) })).toEqual(['Search with at most 100 characters.']);
    await api().get('/api/contracts?status=draft&status=active').set('Cookie', hr).expect(400);
    await api().get('/api/contracts?sort=endDate').set('Cookie', hr).expect(400);
  });
});
