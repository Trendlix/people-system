import type { INestApplication } from '@nestjs/common';
import type { ClearanceDefaultView, FormerEmployeeRow, MyExitInterviewView, OffboardingCaseSummary, OffboardingCaseView, RehireMatch, Role, TurnoverReport } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, toDateOnly, todayInCairo } from '../src/common/date-only.js';
import { OffboardingSchedulerService } from '../src/offboarding/offboarding-scheduler.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Offboarding (owner, 21 October 2026: "when an employee resigns or contract ends with no renewal, where will the data be
// stored? will it be another tab?"; 22 October 2026, the full module: "Former Employees tab, clearance checklist (assets
// returned, laptop, access), exit interview, rehire eligibility, turnover numbers"). Leo's ending, approved by the CEO,
// opens his case with the two items the system ticks and HR's defaults; his manager, an Admin and HR clear theirs (each
// only their own), "Assets returned" follows his custody and "Final settlement paid" payroll's Unsettled; he sends his
// exit interview (once), which his manager never sees; rehire eligibility; the ending completed ends his sign-in; HR
// completes the case once every item is cleared, a Super Admin anyway with a reason; a withdrawn ending cancels a case
// and the next opens it again; a C-level person's case only for the CEO and a Super Admin; End employment opens one too,
// an Admin's account kept on; the round disables a sign-in once the last day has passed; Former Employees, the
// turnover and its Excel, the rehire warning; the default checklist; the audit log. Every name is invented; the test
// database is emptied at the start of each run, and this file deletes what it made.

const RUN = `ob${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const YESTERDAY = addDays(TODAY, -1);
const YEAR = TODAY.slice(0, 4);
/** Codes of this run's own (asset and custody codes are digits), far from those the counters give. */
const SERIAL = String(Date.now()).slice(-8);

describe('Offboarding (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const people: Record<string, { id: string; employmentId: string }> = {};
  const assetIds: string[] = [];
  const custodyIds: string[] = [];
  let g9: string;

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const put = (as: string, path: string, body: object) => api().put(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const patch = (as: string, path: string, body: object) => api().patch(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const notices = (key: string, kind: string) => prisma.notification.findMany({ where: { userId: users[key], kind }, orderBy: { createdAt: 'asc' }, select: { title: true, body: true, link: true } });

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    sessions[key] = await signIn(app, email);
    return email;
  }

  /** A current employee, signing in with `email` when given. */
  async function employee(key: string, name: string, options: { email?: string; managerId?: string; gradeId?: string; joinDate?: string; personalEmail?: string } = {}) {
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'موظف تجريبي',
        workEmail: options.email?.toLowerCase() ?? null,
        personalEmail: options.personalEmail ?? null,
        employments: {
          create: { employmentType: 'full_time', status: 'active', joinDate: new Date(options.joinDate ?? '2024-01-01'), gradeId: options.gradeId ?? null, managerId: options.managerId ?? null },
        },
      },
      select: { id: true, employments: { select: { id: true } } },
    });
    people[key] = { id: e.id, employmentId: e.employments[0].id };
    return people[key];
  }

  /** Something the person holds in custody, made straight in the database (custody's own tests cover handing over). */
  async function holding(key: string, name: string) {
    const asset = await prisma.asset.create({
      data: { code: `PK-CAM-9${SERIAL}`, name: `${name} ${RUN}`, group: 'kit', type: 'CAM', assetClass: 'fixed' },
    });
    assetIds.push(asset.id);
    const record = await prisma.custodyRecord.create({
      data: { code: `CUS-9${SERIAL}`, kind: 'assignment', employeeId: people[key].id, terms: [], items: { create: { assetId: asset.id } } },
      select: { id: true, code: true },
    });
    custodyIds.push(record.id);
    await prisma.asset.update({ where: { id: asset.id }, data: { status: 'custody', holderId: people[key].id, custodyId: record.id } });
    return { assetId: asset.id, record };
  }

  const ending = async (as: string, key: string, body: object) =>
    (await post(as, `/employees/${people[key].id}/employments/${people[key].employmentId}/endings`, body).expect(201)).body as { id: string; lastWorkingDay: string };
  const caseOf = async (key: string) => prisma.offboardingCase.findUnique({ where: { employmentId: people[key].employmentId }, include: { items: { orderBy: { position: 'asc' } } } });
  const view = async (as: string, id: string) => (await get(as, `/offboarding/cases/${id}`).expect(200)).body as OffboardingCaseView;
  const itemId = (v: OffboardingCaseView, label: string) => v.items.find((i) => i.label === label)!.id;

  const ANSWERS = { reason: 'better_offer', ratings: { role: 4, manager: 5, pay: 2, growth: 3, culture: 4 }, recommend: 'yes', comments: `Thanks ${RUN}` };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    await account('admin', ['admin']);
    await account('finance', ['finance']);
    await account('outsider', ['employee']);
    const hrCeo = await account('hrCeo', ['hr', 'ceo']);
    await account('boss', ['manager', 'employee']);
    await account('leo', ['employee']);
    await account('nina', ['employee']);
    await account('clara', ['employee']);
    await account('adam', ['admin', 'employee']);
    await account('gone', ['employee']);
    g9 = (await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true } })).id;
    const boss = await employee('boss', 'Bassem Boss', { email: emails.boss });
    await employee('leo', 'Leo Leaver', { email: emails.leo, managerId: boss.id, personalEmail: `leo.${RUN}@personal.test`, joinDate: '2025-03-01' });
    await employee('nina', 'Nina Notice', { email: emails.nina, managerId: boss.id });
    await employee('clara', 'Clara Chief', { email: emails.clara, gradeId: g9 });
    await employee('adam', 'Adam Admin', { email: emails.adam });
    await employee('gone', 'Gina Gone', { email: emails.gone });
    void hrCeo;
  });

  afterAll(async () => {
    const employeeIds = Object.values(people).map((p) => p.id);
    await prisma.custodyItem.deleteMany({ where: { custodyId: { in: custodyIds } } });
    await prisma.custodyRecord.deleteMany({ where: { id: { in: custodyIds } } });
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    // their direct manager last: Bassem manages Leo and Nina
    await prisma.employment.updateMany({ where: { employeeId: { in: employeeIds } }, data: { managerId: null } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await app.close();
  });

  // ---------- the default checklist ----------

  it('starts every case from HR’s default checklist, which only HR, the CEO and a Super Admin read and change', async () => {
    const list = (await get('hr', '/offboarding/checklist').expect(200)).body as ClearanceDefaultView[];
    expect(list.map((i) => [i.label, i.owner])).toEqual([
      ['Work handed over to the manager', 'manager'],
      ['Access cards and keys returned', 'admin'],
      ['Email and system accounts disabled', 'admin'],
      ['Social insurance Form 6 filed', 'hr'],
      ['Experience certificate issued', 'hr'],
    ]);
    await get('outsider', '/offboarding/checklist').expect(403);
    await get('admin', '/offboarding/checklist').expect(403);
    const refused = await put('hr', '/offboarding/checklist', { items: [{ label: '', owner: 'hr' }, { label: 'Keys', owner: 'it' }] }).expect(400);
    expect(refused.body.message).toEqual(['Item 1: give it a name.', 'Item 2: choose who clears it.']);
    // a laptop item added for Finance, the rest kept
    const saved = (await put('hr', '/offboarding/checklist', { items: [...list, { label: `Company laptop returned ${RUN}`, owner: 'finance' }] }).expect(200)).body as ClearanceDefaultView[];
    expect(saved).toHaveLength(6);
    expect(saved.slice(0, 5).map((i) => i.id)).toEqual(list.map((i) => i.id));
    await put('outsider', '/offboarding/checklist', { items: list }).expect(403);
  });

  // ---------- a case from the CEO's approval ----------

  let leoCase: string;

  it('opens Leo’s case when the CEO approves his ending, with the two items the system ticks and the defaults', async () => {
    const e = await ending('hr', 'leo', { ruleKey: 'misconduct', noticeGivenOn: YESTERDAY, reason: `Investigation ${RUN}` });
    expect(e.lastWorkingDay).toBe(YESTERDAY);
    expect(await caseOf('leo')).toBeNull(); // HR's recording alone opens nothing
    await post('ceo', `/endings/${e.id}/approve`, { note: 'Agreed' }).expect(200);
    const row = (await caseOf('leo'))!;
    expect(row).toMatchObject({ status: 'open', endingId: e.id });
    leoCase = row.id;
    expect(row.items.map((i) => [i.kind, i.label, i.owner, i.status])).toEqual([
      ['assets', 'Assets returned', 'assets', 'pending'],
      ['final_settlement', 'Final settlement paid', 'hr', 'pending'],
      ['manual', 'Work handed over to the manager', 'manager', 'pending'],
      ['manual', 'Access cards and keys returned', 'admin', 'pending'],
      ['manual', 'Email and system accounts disabled', 'admin', 'pending'],
      ['manual', 'Social insurance Form 6 filed', 'hr', 'pending'],
      ['manual', 'Experience certificate issued', 'hr', 'pending'],
      ['manual', `Company laptop returned ${RUN}`, 'finance', 'pending'],
    ]);

    // each owner told how many items wait for them; Leo asked for his exit interview
    expect(await notices('boss', 'offboarding_items')).toEqual([{ title: `Clearance for Leo Leaver ${RUN}`, body: `1 item for you · last working day ${YESTERDAY.split('-').reverse().join('/')}`, link: `/offboarding/${leoCase}` }]);
    expect((await notices('admin', 'offboarding_items'))[0]?.body).toMatch(/^2 items for you/);
    expect((await notices('finance', 'offboarding_items'))[0]?.body).toMatch(/^1 item for you/);
    // HR: the final settlement and two of the defaults
    expect((await notices('hr', 'offboarding_items'))[0]?.body).toMatch(/^3 items for you/);
    expect(await notices('leo', 'exit_interview')).toEqual([expect.objectContaining({ title: 'Your exit interview', link: '/my-requests/exit-interview' })]);
    expect(await notices('outsider', 'offboarding_items')).toEqual([]);
  });

  it('shows the case in full to HR, the checklist alone to those who clear an item, and nothing to anyone else', async () => {
    const full = await view('hr', leoCase);
    expect(full).toMatchObject({
      status: 'open',
      employee: { id: people.leo.id, fullNameEn: `Leo Leaver ${RUN}` },
      lastWorkingDay: YESTERDAY,
      ended: false,
      progress: { cleared: 1, total: 8 }, // nothing held: Assets returned is done already
      exitInterview: 'pending',
      ending: { rule: 'Dismissal for serious misconduct (Labour Court)', reason: `Investigation ${RUN}` },
      finalSettlement: { status: 'not_yet', settledOn: null },
      interview: { status: 'pending' },
      signIn: { state: 'active', email: emails.leo },
      can: { manage: true, complete: true, override: false, addItem: true, interview: true, rehire: true },
    });
    expect(full.items[0]).toMatchObject({ label: 'Assets returned', status: 'done', doneBy: 'The system', canMark: false });

    const boss = await view('boss', leoCase);
    expect(boss).toMatchObject({ ending: { reason: null }, interview: null, finalSettlement: null, signIn: null, rehire: null, exitInterview: null, can: { manage: false, complete: false } });
    expect(boss.items.filter((i) => i.canMark).map((i) => i.label)).toEqual(['Work handed over to the manager']);
    expect(boss.mine).toBe(1);
    await get('outsider', `/offboarding/cases/${leoCase}`).expect(404);
    await get('nina', `/offboarding/cases/${leoCase}`).expect(404);

    const forBoss = (await get('boss', '/offboarding/cases').expect(200)).body as OffboardingCaseSummary[];
    expect(forBoss.map((c) => c.id)).toEqual([leoCase]);
    expect((await get('outsider', '/offboarding/cases').expect(200)).body).toEqual([]);
    expect(((await get('hr', '/offboarding/cases').expect(200)).body as OffboardingCaseSummary[]).map((c) => c.id)).toContain(leoCase);
    // his profile's banner: his latest case, for those who handle cases
    expect(((await get('hr', `/offboarding/employees/${people.leo.id}`).expect(200)).body as { case: OffboardingCaseSummary }).case).toMatchObject({ id: leoCase, status: 'open' });
    expect((await get('hr', `/offboarding/employees/${people.boss.id}`).expect(200)).body).toEqual({ case: null });
    await get('boss', `/offboarding/employees/${people.leo.id}`).expect(403);
  });

  it('follows his custody: Assets returned is pending while he holds something, done once it is all back', async () => {
    const { record } = await holding('leo', 'Camera');
    let v = await view('hr', leoCase);
    expect(v.items[0]).toMatchObject({ status: 'pending', doneBy: null });
    expect(v.holdings).toEqual([expect.objectContaining({ assetName: `Camera ${RUN}`, custodyCode: record.code, custodyKind: 'assignment' })]);
    // the custodians see the case for its Assets item, which they never tick by hand
    await patch('hr', `/offboarding/cases/${leoCase}/items/${itemId(v, 'Assets returned')}`, { status: 'done' }).expect(400);
    await prisma.custodyItem.updateMany({ where: { custodyId: record.id }, data: { returnedAt: new Date(), returnCondition: 'good' } });
    await prisma.asset.updateMany({ where: { custodyId: record.id }, data: { status: 'available', holderId: null, custodyId: null } });
    v = await view('hr', leoCase);
    expect(v.items[0].status).toBe('done');
    expect(v.holdings).toEqual([]);
  });

  it('lets each owner clear their own items only; HR any; never the two the system ticks', async () => {
    const v = await view('hr', leoCase);
    await patch('boss', `/offboarding/cases/${leoCase}/items/${itemId(v, 'Access cards and keys returned')}`, { status: 'done' }).expect(403);
    const byBoss = (await patch('boss', `/offboarding/cases/${leoCase}/items/${itemId(v, 'Work handed over to the manager')}`, { status: 'done', note: 'Shared drive handed over' }).expect(200))
      .body as OffboardingCaseView;
    expect(byBoss.items.find((i) => i.label === 'Work handed over to the manager')).toMatchObject({ status: 'done', doneBy: `Bassem Boss ${RUN}`, note: 'Shared drive handed over' });
    await patch('admin', `/offboarding/cases/${leoCase}/items/${itemId(v, 'Access cards and keys returned')}`, { status: 'done' }).expect(200);
    await patch('admin', `/offboarding/cases/${leoCase}/items/${itemId(v, 'Email and system accounts disabled')}`, { status: 'not_applicable', note: 'No email' }).expect(200);
    await patch('finance', `/offboarding/cases/${leoCase}/items/${itemId(v, `Company laptop returned ${RUN}`)}`, { status: 'done' }).expect(200);
    await patch('finance', `/offboarding/cases/${leoCase}/items/${itemId(v, 'Social insurance Form 6 filed')}`, { status: 'done' }).expect(403);
    await patch('hr', `/offboarding/cases/${leoCase}/items/${itemId(v, 'Final settlement paid')}`, { status: 'done' }).expect(400);
    await patch('hr', `/offboarding/cases/${leoCase}/items/${itemId(v, 'Social insurance Form 6 filed')}`, { status: 'sometimes' }).expect(400);
    // put back to pending, then done
    await patch('hr', `/offboarding/cases/${leoCase}/items/${itemId(v, 'Social insurance Form 6 filed')}`, { status: 'done' }).expect(200);
    const back = (await patch('hr', `/offboarding/cases/${leoCase}/items/${itemId(v, 'Social insurance Form 6 filed')}`, { status: 'pending' }).expect(200)).body as OffboardingCaseView;
    expect(back.items.find((i) => i.label === 'Social insurance Form 6 filed')).toMatchObject({ status: 'pending', doneBy: null, doneAt: null });
    // HR adds a one-off item
    await post('boss', `/offboarding/cases/${leoCase}/items`, { label: 'Car parking card', owner: 'admin' }).expect(403);
    const added = (await post('hr', `/offboarding/cases/${leoCase}/items`, { label: `Studio key ${RUN}`, owner: 'hr' }).expect(201)).body as OffboardingCaseView;
    expect(added.items.at(-1)).toMatchObject({ label: `Studio key ${RUN}`, owner: 'hr', status: 'pending', canMark: true });
    await post('hr', `/offboarding/cases/${leoCase}/items`, { label: `studio key ${RUN}`, owner: 'hr' }).expect(400);
  });

  it('can’t be completed with items pending, except by a Super Admin with a reason', async () => {
    const refused = await post('hr', `/offboarding/cases/${leoCase}/complete`, {}).expect(400);
    expect(refused.body.message[0]).toMatch(/^Still pending: Final settlement paid, Social insurance Form 6 filed, Experience certificate issued, Studio key/);
    // a Super Admin without the reason is refused too (the override comes in the next test, on Nina's case)
    expect((await post('superAdmin', `/offboarding/cases/${leoCase}/complete`, {}).expect(400)).body.message).toEqual(['Say why the case is completed with items still pending.']);
    await post('boss', `/offboarding/cases/${leoCase}/complete`, {}).expect(403);
  });

  // ---------- the exit interview ----------

  it('takes Leo’s exit interview once, from him; HR reads it, his manager never', async () => {
    const mine = (await get('leo', '/offboarding/my/exit-interview').expect(200)).body as { interview: MyExitInterviewView };
    expect(mine.interview).toEqual({ caseId: leoCase, lastWorkingDay: YESTERDAY, status: 'pending', answers: null });
    expect(((await get('outsider', '/offboarding/my/exit-interview').expect(200)).body as { interview: null }).interview).toBeNull();
    const bad = await put('leo', '/offboarding/my/exit-interview', { ...ANSWERS, ratings: { role: 9 } }).expect(400);
    expect(bad.body.message).toContain('The role itself: choose a rating from 1 to 5.');
    const sent = (await put('leo', '/offboarding/my/exit-interview', ANSWERS).expect(200)).body as { interview: MyExitInterviewView };
    expect(sent.interview).toMatchObject({ status: 'submitted', answers: ANSWERS });
    await put('leo', '/offboarding/my/exit-interview', ANSWERS).expect(409);
    await put('outsider', '/offboarding/my/exit-interview', ANSWERS).expect(404);

    expect((await view('hr', leoCase)).interview).toMatchObject({ status: 'submitted', filledBy: 'employee', answers: ANSWERS, recordedBy: `Leo Leaver ${RUN}` });
    expect((await view('boss', leoCase)).interview).toBeNull();
    // HR doesn't write over his own answers
    await put('hr', `/offboarding/cases/${leoCase}/exit-interview`, ANSWERS).expect(409);
    await put('boss', `/offboarding/cases/${leoCase}/exit-interview`, ANSWERS).expect(403);
    // the answers stay out of the audit log
    const logged = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'offboarding_case', entityId: leoCase, action: 'exit_interview' } });
    expect(JSON.stringify(logged.diff)).not.toContain(RUN);
  });

  it('keeps his rehire eligibility, with a reason unless simply eligible', async () => {
    expect((await put('hr', `/offboarding/cases/${leoCase}/rehire`, { eligibility: 'not_eligible' }).expect(400)).body.message).toEqual(['Say why they shouldn’t be hired again.']);
    await put('boss', `/offboarding/cases/${leoCase}/rehire`, { eligibility: 'eligible' }).expect(403);
    const v = (await put('hr', `/offboarding/cases/${leoCase}/rehire`, { eligibility: 'not_eligible', reason: `Misconduct ${RUN}` }).expect(200)).body as OffboardingCaseView;
    expect(v).toMatchObject({ rehire: 'not_eligible', rehireReason: `Misconduct ${RUN}`, rehireSetBy: emails.hr });
  });

  // ---------- the ending completed ----------

  it('ends his sign-in once the ending is completed after his last working day, the case kept open', async () => {
    const e = await prisma.employmentEnding.findFirstOrThrow({ where: { employmentId: people.leo.employmentId, status: 'approved' } });
    await post('hr', `/endings/${e.id}/complete`).expect(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: users.leo }, select: { isActive: true } })).toEqual({ isActive: false });
    expect(await prisma.session.count({ where: { userId: users.leo, endedAt: null } })).toBe(0);
    await get('leo', '/offboarding/my/exit-interview').expect(401);
    const v = await view('hr', leoCase);
    expect(v).toMatchObject({ id: leoCase, status: 'open', ended: true, endReason: 'terminated', finalSettlement: { status: 'open' }, signIn: { state: 'disabled' } });
    const disabled = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'user', entityId: users.leo, action: 'update' }, orderBy: { id: 'desc' } });
    expect(disabled).toMatchObject({ userId: null, diff: expect.objectContaining({ isActive: { from: true, to: false }, reason: 'Their employment ended' }) });
  });

  it('ticks Final settlement paid from payroll, tells HR once every item is cleared, and completes', async () => {
    await post('hr', `/payroll/final-settlements/${people.leo.employmentId}/settle`, { settledOn: TODAY, amountPaid: 0 }).expect(200);
    let v = await view('hr', leoCase);
    expect(v.items.find((i) => i.label === 'Final settlement paid')).toMatchObject({ status: 'done', doneBy: 'The system' });
    expect(v.finalSettlement).toEqual({ status: 'settled', settledOn: TODAY });
    for (const label of ['Social insurance Form 6 filed', 'Experience certificate issued']) await patch('hr', `/offboarding/cases/${leoCase}/items/${itemId(v, label)}`, { status: 'done' }).expect(200);
    expect(await notices('hr', 'offboarding_cleared')).toEqual([]);
    await patch('hr', `/offboarding/cases/${leoCase}/items/${itemId(v, `Studio key ${RUN}`)}`, { status: 'done' }).expect(200);
    expect(await notices('hr', 'offboarding_cleared')).toEqual([{ title: `Clearance done: Leo Leaver ${RUN}`, body: 'Every item is cleared. Complete the case.', link: `/offboarding/${leoCase}` }]);
    v = (await post('hr', `/offboarding/cases/${leoCase}/complete`, {}).expect(200)).body as OffboardingCaseView;
    expect(v).toMatchObject({ status: 'completed', completedBy: emails.hr, overrideReason: null, progress: { cleared: 9, total: 9 }, can: { complete: false } });
    // the two the system ticked are kept as they stood
    const kept = (await caseOf('leo'))!.items.filter((i) => i.kind !== 'manual');
    expect(kept.map((i) => [i.label, i.status, i.doneAt !== null])).toEqual([
      ['Assets returned', 'done', true],
      ['Final settlement paid', 'done', true],
    ]);
    await post('hr', `/offboarding/cases/${leoCase}/complete`, {}).expect(409);
    await patch('hr', `/offboarding/cases/${leoCase}/items/${itemId(v, 'Social insurance Form 6 filed')}`, { status: 'pending' }).expect(409);
  });

  // ---------- a withdrawn ending, a Super Admin's override ----------

  it('cancels a case when its ending is withdrawn, opens it again with the next; a Super Admin completes one anyway', async () => {
    const first = await ending('hr', 'nina', { ruleKey: 'company_notice', noticeGivenOn: TODAY });
    await post('ceo', `/endings/${first.id}/approve`).expect(200);
    const opened = (await caseOf('nina'))!;
    await post('hr', `/endings/${first.id}/withdraw`, { note: 'Stays' }).expect(200);
    expect((await caseOf('nina'))!).toMatchObject({ id: opened.id, status: 'cancelled' });
    expect(((await get('hr', '/offboarding/cases?status=cancelled').expect(200)).body as OffboardingCaseSummary[]).map((c) => c.id)).toContain(opened.id);
    const next = await ending('hr', 'nina', { ruleKey: 'company_notice', noticeGivenOn: TODAY, payInLieu: true });
    await post('ceo', `/endings/${next.id}/approve`).expect(200);
    expect((await caseOf('nina'))!).toMatchObject({ id: opened.id, status: 'open', endingId: next.id });
    expect((await prisma.auditLog.findMany({ where: { entityType: 'offboarding_case', entityId: opened.id }, orderBy: { id: 'asc' } })).map((a) => a.action)).toEqual([
      'open_case',
      'cancel',
      'reopen_case',
    ]);

    await post('hr', `/offboarding/cases/${opened.id}/complete`, { overrideReason: 'Moving on' }).expect(400);
    const done = (await post('superAdmin', `/offboarding/cases/${opened.id}/complete`, { overrideReason: 'Left the country; settled by the CEO' }).expect(200)).body as OffboardingCaseView;
    expect(done).toMatchObject({ status: 'completed', overrideReason: 'Left the country; settled by the CEO' });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'offboarding_case', entityId: opened.id, action: 'complete' } });
    expect(audit.diff).toMatchObject({ overrideReason: 'Left the country; settled by the CEO', pending: expect.arrayContaining(['Final settlement paid']) });
  });

  // ---------- C-level ----------

  it('keeps a C-level person’s case from HR: the CEO and a Super Admin handle it, and only they are told', async () => {
    await post('hrCeo', `/employees/${people.clara.id}/employments/${people.clara.employmentId}/end`, { endDate: YESTERDAY, endReason: 'resigned' }).expect(200);
    const row = (await caseOf('clara'))!;
    expect(row.status).toBe('open');
    await get('hr', `/offboarding/cases/${row.id}`).expect(404);
    expect(((await get('hr', '/offboarding/cases').expect(200)).body as OffboardingCaseSummary[]).map((c) => c.id)).not.toContain(row.id);
    await get('admin', `/offboarding/cases/${row.id}`).expect(404);
    expect((await view('ceo', row.id)).employee.id).toBe(people.clara.id);
    expect((await view('superAdmin', row.id)).can.override).toBe(true);
    expect((await notices('ceo', 'offboarding_items')).some((n) => n.link === `/offboarding/${row.id}`)).toBe(true);
    expect((await notices('hr', 'offboarding_items')).some((n) => n.link === `/offboarding/${row.id}`)).toBe(false);
    expect((await notices('admin', 'offboarding_items')).some((n) => n.link === `/offboarding/${row.id}`)).toBe(false);
    await put('hr', `/offboarding/cases/${row.id}/rehire`, { eligibility: 'eligible' }).expect(404);
    expect((await get('hr', `/offboarding/employees/${people.clara.id}`).expect(200)).body).toEqual({ case: null });
  });

  // ---------- End employment, the sign-in ----------

  it('opens a case from End employment too, and leaves an Admin’s account on', async () => {
    await post('hr', `/employees/${people.adam.id}/employments/${people.adam.employmentId}/end`, { endDate: YESTERDAY, endReason: 'mutual_agreement' }).expect(200);
    const row = (await caseOf('adam'))!;
    expect(row).toMatchObject({ status: 'open', endingId: null, openedById: users.hr });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: users.adam }, select: { isActive: true } })).toEqual({ isActive: true });
    expect((await view('hr', row.id)).signIn).toMatchObject({ state: 'kept', note: 'An Admin account, so the system left it on. Deactivate it on Users if it should stop.' });
    // opening by hand: refused while it has one
    await post('hr', '/offboarding/cases', { employmentId: people.adam.employmentId }).expect(409);
    await post('boss', '/offboarding/cases', { employmentId: people.adam.employmentId }).expect(403);
  });

  it('disables a sign-in from the round once the last working day has passed, once', async () => {
    // Gina's employment ended yesterday without the flows (an import, a fix by hand): the round finds it
    await prisma.employment.update({ where: { id: people.gone.employmentId }, data: { endDate: toDateOnly(YESTERDAY), endReason: 'resigned', status: 'resigned' } });
    const round = await app.get(OffboardingSchedulerService).runOnce();
    expect(round?.signInsClosed).toBeGreaterThanOrEqual(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: users.gone }, select: { isActive: true } })).toEqual({ isActive: false });
    // turned back on by an Admin: the next round leaves it alone
    await patch('admin', `/users/${users.gone}`, { isActive: true }).expect(200);
    await app.get(OffboardingSchedulerService).runOnce();
    expect(await prisma.user.findUniqueOrThrow({ where: { id: users.gone }, select: { isActive: true } })).toEqual({ isActive: true });
    // and HR opens her case by hand
    const opened = (await post('hr', '/offboarding/cases', { employmentId: people.gone.employmentId }).expect(201)).body as OffboardingCaseView;
    expect(opened).toMatchObject({ status: 'open', employee: { id: people.gone.id }, signIn: { state: 'kept', note: 'Turned back on after the system disabled it.' } });
  });

  // ---------- Former Employees, the turnover, the rehire warning ----------

  it('lists former employees with when and why they left, their clearance and rehire eligibility; C-level by name only for HR', async () => {
    const rows = (await get('hr', '/offboarding/former').expect(200)).body as FormerEmployeeRow[];
    const leo = rows.find((r) => r.employee.id === people.leo.id)!;
    expect(leo).toMatchObject({ endDate: YESTERDAY, endReason: 'terminated', leaverKind: 'involuntary', clearance: 'completed', rehire: 'not_eligible', caseId: leoCase, restricted: false });
    expect(rows.find((r) => r.employee.id === people.clara.id)).toMatchObject({ restricted: true, endReason: null, rehire: null, caseId: null });
    expect(((await get('ceo', '/offboarding/former').expect(200)).body as FormerEmployeeRow[]).find((r) => r.employee.id === people.clara.id)).toMatchObject({ restricted: false, endReason: 'resigned' });
    expect(rows.some((r) => r.employee.id === people.boss.id)).toBe(false); // current
    const filtered = (await get('hr', `/offboarding/former?year=${YEAR}&reason=terminated`).expect(200)).body as FormerEmployeeRow[];
    expect(filtered.every((r) => r.endReason === 'terminated')).toBe(true);
    expect(filtered.map((r) => r.employee.id)).toContain(people.leo.id);
    await get('outsider', '/offboarding/former').expect(403);
    await get('admin', '/offboarding/former').expect(403);
  });

  it('works out the turnover of the year, with its Excel; who left by name, a C-level person not for HR', async () => {
    const t = (await get('hr', `/offboarding/turnover?year=${YEAR}`).expect(200)).body as TurnoverReport;
    expect(t.year).toBe(Number(YEAR));
    expect(t.leavers).toBeGreaterThanOrEqual(4);
    expect(t.years[0]).toBeGreaterThanOrEqual(Number(YEAR));
    const leo = t.leaversList.find((l) => l.employee?.id === people.leo.id);
    expect(leo).toMatchObject({ endDate: YESTERDAY, leaverKind: 'involuntary' });
    expect(t.leaversList.some((l) => l.employee?.id === people.clara.id)).toBe(false);
    expect(t.leaversList.some((l) => l.employee === null)).toBe(true);
    const file = await get('hr', `/offboarding/turnover/export?year=${YEAR}`).buffer(true).expect(200);
    expect(file.headers['content-type']).toContain('spreadsheetml');
    expect(file.headers['content-disposition']).toContain(`Turnover ${YEAR}.xlsx`);
    await get('outsider', '/offboarding/turnover').expect(403);
    await get('hr', '/offboarding/turnover?year=19').expect(400);
  });

  it('warns of a former employee an offer or a new employment is for, with their rehire eligibility', async () => {
    const byPerson = (await get('hr', `/offboarding/rehire-check?employeeId=${people.leo.id}`).expect(200)).body as RehireMatch[];
    expect(byPerson).toEqual([
      { employeeId: people.leo.id, fullNameEn: `Leo Leaver ${RUN}`, leftOn: YESTERDAY, endReason: 'terminated', eligibility: 'not_eligible', reason: `Misconduct ${RUN}`, matchedBy: 'employee' },
    ]);
    const byEmail = (await get('hr', `/offboarding/rehire-check?email=LEO.${RUN}@personal.test`).expect(200)).body as RehireMatch[];
    expect(byEmail.map((m) => [m.employeeId, m.matchedBy])).toEqual([[people.leo.id, 'email']]);
    expect((await get('hr', `/offboarding/rehire-check?employeeId=${people.boss.id}`).expect(200)).body).toEqual([]); // current
    expect((await get('hr', `/offboarding/rehire-check?employeeId=${people.clara.id}`).expect(200)).body).toEqual([]); // C-level, for HR
    expect(((await get('ceo', `/offboarding/rehire-check?employeeId=${people.clara.id}`).expect(200)).body as RehireMatch[]).map((m) => m.employeeId)).toEqual([people.clara.id]);
    await get('outsider', `/offboarding/rehire-check?employeeId=${people.leo.id}`).expect(403);
    await get('hr', '/offboarding/rehire-check?email=not-an-email').expect(400);
  });

  it('audits each step', async () => {
    const actions = (await prisma.auditLog.findMany({ where: { entityType: 'offboarding_case', entityId: leoCase }, orderBy: { id: 'asc' } })).map((a) => a.action);
    expect(actions[0]).toBe('open_case');
    expect(actions).toEqual(expect.arrayContaining(['clear_item', 'add_item', 'exit_interview', 'rehire', 'complete']));
    expect(await prisma.auditLog.count({ where: { entityType: 'clearance_checklist' } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.auditLog.count({ where: { entityType: 'turnover_report', action: 'turnover_file' } })).toBeGreaterThanOrEqual(1);
  });

  it('puts the default checklist back as it was', async () => {
    const list = (await get('hr', '/offboarding/checklist').expect(200)).body as ClearanceDefaultView[];
    await put('hr', '/offboarding/checklist', { items: list.filter((i) => !i.label.includes(RUN)) }).expect(200);
    expect(((await get('hr', '/offboarding/checklist').expect(200)).body as ClearanceDefaultView[]).map((i) => i.label)).not.toContain(`Company laptop returned ${RUN}`);
  });
});
