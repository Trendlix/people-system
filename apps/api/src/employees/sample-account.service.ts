import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { accountEmail, dayFromPunches, expectedPlace, leaveDecisionStepKind, PROFILE_DISCLAIMER, punchFlags, zonedMoment, type CheckInPlace } from '@trendlix/shared';
import { keptDayData } from '../attendance/check-in.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../common/date-only.js';
import { fromTimeOfDay, toTimeOfDay } from '../common/time-of-day.js';
import { snapshotOf } from '../confirmations/views.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { managesTestAccounts } from './confidential.service.js';
import { samplePlan } from './sample-account.js';

// A sample account for the app stores' reviewers (owner, 7 November 2026: "the test account shows nothing after the
// login, allow apple testers to see some dummy data"). HR or a Super Admin gives the email of an account made on the
// Users page (testing@trendlix.com); People makes it a test profile of its own, invented throughout ("Nour Hassan"):
// - the profile (code TEST-n, so the employees' own codes keep no gap), its details confirmed by the account (the app's
//   review at sign-in doesn't stop the reviewer), and a test account (ConfidentialService: in no list, count, report or
//   payroll run; its requests tell nobody);
// - a current employment since 1 January last year (so annual leave is usable), full time, working from home on the
//   shift most people work, checking in from anywhere; no department, job title or manager, so nothing it asks for
//   reaches anyone but HR, under Employees → Test accounts;
// - an open-ended contract signed from that day (contract TEST-CON-n), so its access is Active;
// - the account linked to it, an Employee only (a developer can change nothing: the reviewer couldn't check in);
// - its history (sample-account.ts): check-ins and check-outs, leave, permission, a leave request waiting.
// Again for a test profile already linked (or POST …/:id/test-account/sample): its history is made afresh as of today,
// the records it made itself (check-ins, requests, corrections) replaced. Audit-logged.

/** The sample person's details: invented. */
const PERSON = {
  fullNameEn: 'Nour Hassan',
  fullNameAr: 'نور حسن',
  gender: 'female',
  dateOfBirth: toDateOnly('1997-03-14'),
  nationality: 'Egyptian',
  maritalStatus: 'single',
  militaryStatus: 'not_applicable',
  governorate: 'Cairo',
  city: 'Nasr City',
  university: 'Cairo University',
  faculty: 'Commerce',
  degree: 'bachelor',
  major: 'Business Administration',
  graduationYear: 2019,
} as const;

/** What setting up or refreshing answers. */
export interface SampleAccountResult {
  employeeId: string;
  created: boolean;
  /** The days worked, the requests made. */
  days: number;
  requests: number;
}

const ENTITY = 'employee';
const NO_SHIFT = 'Add a shift first (Organization → Shifts): the sample account’s days are worked on one.';

@Injectable()
export class SampleAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Makes the account with this email a sample test profile, or refreshes the one it already has. */
  async setUp(email: string, user: SessionUser): Promise<SampleAccountResult> {
    this.assertManages(user);
    const wanted = accountEmail(email) ?? '';
    const account = await this.prisma.user.findUnique({
      where: { email: wanted },
      select: { id: true, isActive: true, roles: { select: { role: { select: { key: true } } } }, employee: { select: { id: true, testAccount: true, fullNameEn: true } } },
    });
    if (!account) throw new NotFoundException(`No account signs in with ${wanted}. Add it on the Users page first, with a password, then set it up here.`);
    if (account.id === user.id) throw new ForbiddenException('Your own account can’t be a sample account.');
    if (!account.isActive) throw new ConflictException(`${wanted} is switched off. Switch it on on the Users page first.`);
    if (account.employee) {
      if (!account.employee.testAccount) throw new ConflictException(`${wanted} is ${account.employee.fullNameEn}’s account, a real profile. Choose an account that isn’t anyone’s.`);
      return this.refresh(account.employee.id, user);
    }
    const others = account.roles.map((r) => r.role.key).filter((k) => k !== 'employee' && k !== 'developer');
    if (others.length) throw new ConflictException(`${wanted} has the ${others.join(', ')} role. A sample account signs in as an Employee only: use an account with no other role.`);
    const taken = await this.prisma.employee.findFirst({ where: { workEmail: { equals: wanted, mode: 'insensitive' } }, select: { employeeCode: true, fullNameEn: true } });
    if (taken) throw new ConflictException(`${wanted} is the work email of ${taken.fullNameEn} (${taken.employeeCode}). Choose another account.`);
    const shift = await this.usualShift();
    if (!shift) throw new ConflictException(NO_SHIFT);

    const today = todayInCairo();
    const joinDate = `${Number(today.slice(0, 4)) - 1}-01-01`;
    const made = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('people-system sample account'))`;
        const n = await nextNumber(tx);
        const employee = await tx.employee.create({ data: { ...PERSON, employeeCode: `TEST-${n}`, workEmail: wanted, signInEmail: 'work', testAccount: true } });
        const employment = await tx.employment.create({
          data: { employeeId: employee.id, employmentType: 'full_time', status: 'active', joinDate: toDateOnly(joinDate), workArrangement: 'wfh', shiftId: shift.id, checkInAnywhere: true },
          select: { id: true },
        });
        await tx.contract.create({
          data: {
            number: `TEST-CON-${n}`,
            employmentId: employment.id,
            version: 1,
            form: 'open_ended',
            startDate: toDateOnly(joinDate),
            grossSalary: 18000,
            insuredSalary: 9000,
            shiftCode: shift.code,
            status: 'active',
            signedOn: toDateOnly(joinDate),
            note: 'The sample contract of a test account (app reviewers).',
          },
        });
        await linkAccount(tx, account.id, employee.id);
        await tx.profileConfirmation.create({ data: { employeeId: employee.id, userId: account.id, disclaimerVersion: PROFILE_DISCLAIMER.version, snapshot: snapshotOf(employee) } });
        const counts = await writeHistory(tx, employee.id, account.id, today);
        return { employeeId: employee.id, code: employee.employeeCode, ...counts };
      },
      { timeout: 60_000 },
    );
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: ENTITY,
      entityId: made.employeeId,
      diff: { sampleAccount: { email: wanted, code: made.code, days: made.days, requests: made.requests } },
    });
    return { employeeId: made.employeeId, created: true, days: made.days, requests: made.requests };
  }

  /** A test profile's history made afresh as of today: what it did itself replaced. */
  async refresh(employeeId: string, user: SessionUser): Promise<SampleAccountResult> {
    this.assertManages(user);
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, testAccount: true, account: { select: { id: true } } } });
    if (!e) throw new NotFoundException('Employee not found.');
    if (!e.testAccount) throw new ConflictException('Only a test account gets sample data: a real profile’s records are kept as they are.');
    if (user.employeeId === employeeId) throw new ForbiddenException('Your own profile can’t get sample data.');
    const today = todayInCairo();
    const counts = await this.prisma.$transaction(
      async (tx) => {
        await clearHistory(tx, employeeId);
        return writeHistory(tx, employeeId, e.account?.id ?? null, today);
      },
      { timeout: 60_000 },
    );
    await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, entityId: employeeId, diff: { sampleData: { asOf: today, ...counts } } });
    return { employeeId, created: false, ...counts };
  }

  private assertManages(user: SessionUser): void {
    if (!managesTestAccounts(user)) throw new ForbiddenException('Only HR or a Super Admin sets up a sample account.');
  }

  /** The shift most current employments work, else the first; null when there is none. */
  private async usualShift(): Promise<{ id: string; code: string } | null> {
    const [top] = await this.prisma.employment.groupBy({
      by: ['shiftId'],
      where: { endDate: null, shiftId: { not: null }, employee: { testAccount: false } },
      _count: { _all: true },
      orderBy: { _count: { shiftId: 'desc' } },
      take: 1,
    });
    const where = top?.shiftId ? { id: top.shiftId } : {};
    return this.prisma.shift.findFirst({ where, orderBy: { code: 'asc' }, select: { id: true, code: true } });
  }
}

type Tx = Prisma.TransactionClient;

/** The next TEST-n: test profiles and their contracts numbered apart from the real ones. */
async function nextNumber(tx: Tx): Promise<number> {
  const [{ max }] = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT max(substring(employee_code from 6)::int) AS max FROM employees WHERE employee_code ~ '^TEST-[0-9]+$'`;
  let n = (max ?? 0) + 1;
  while (await tx.contract.findUnique({ where: { number: `TEST-CON-${n}` }, select: { id: true } })) n++;
  return n;
}

/** The account linked to the profile, an Employee only. */
async function linkAccount(tx: Tx, accountId: string, employeeId: string): Promise<void> {
  const role = await tx.role.findUniqueOrThrow({ where: { key: 'employee' }, select: { id: true } });
  await tx.user.update({ where: { id: accountId }, data: { employeeId } });
  await tx.userRole.deleteMany({ where: { userId: accountId } });
  await tx.userRole.create({ data: { userId: accountId, roleId: role.id } });
}

/** What a refresh replaces: the days, check-ins and requests of the kinds the sample makes, and corrections. */
async function clearHistory(tx: Tx, employeeId: string): Promise<void> {
  const where = { employeeId };
  await tx.attendancePing.deleteMany({ where });
  await tx.attendanceDay.deleteMany({ where });
  await tx.attendancePunch.deleteMany({ where });
  await tx.attendanceDaySource.deleteMany({ where });
  await tx.attendanceCorrection.deleteMany({ where });
  await tx.leaveRequest.deleteMany({ where });
  await tx.permissionRequest.deleteMany({ where });
  await tx.wfhRequest.deleteMany({ where });
}

/** A moment of a Cairo day. */
const at = (date: string, time: string): Date => new Date(zonedMoment(date, time));

/** The sample history (sample-account.ts) written for the profile's current employment, as of `today`. */
async function writeHistory(tx: Tx, employeeId: string, accountId: string | null, today: string): Promise<{ days: number; requests: number }> {
  const employment = await tx.employment.findFirst({
    where: { employeeId, endDate: null },
    orderBy: { joinDate: 'desc' },
    select: {
      id: true,
      workArrangement: true,
      officeDays: true,
      shift: { select: { startTime: true, endTime: true, hoursPerDay: true, graceMinutes: true, countUntil: true, workingDays: true } },
    },
  });
  if (!employment) throw new ConflictException('Give the test profile a current employment first: its sample days are worked on it.');
  const s = employment.shift;
  if (!s) throw new ConflictException('Give the test profile’s employment a shift first: its sample days are worked on it.');
  const shift = {
    startTime: fromTimeOfDay(s.startTime),
    endTime: fromTimeOfDay(s.endTime),
    hoursPerDay: s.hoursPerDay?.toNumber() ?? null,
    graceMinutes: s.graceMinutes,
    countUntil: s.countUntil ? fromTimeOfDay(s.countUntil) : null,
  };
  const holidays = await tx.holiday.findMany({ where: { date: { gte: toDateOnly(addDays(today, -100)), lte: toDateOnly(addDays(today, 60)) } }, select: { date: true } });
  const plan = samplePlan(today, { ...shift, workingDays: s.workingDays }, new Set(holidays.map((h) => fromDateOnly(h.date))));

  // the check-ins and check-outs, and the days they make (as a press keeps them: check-in.service.ts)
  const punches: Prisma.AttendancePunchCreateManyInput[] = [];
  const days: Prisma.AttendanceDayCreateManyInput[] = [];
  for (const d of plan.days) {
    const expected = expectedPlace(employment.workArrangement, employment.officeDays, weekday(d.date));
    const place: CheckInPlace = expected === 'office' ? 'office' : 'remote';
    const inAt = at(d.date, d.in);
    const outAt = at(d.out <= d.in ? addDays(d.date, 1) : d.date, d.out);
    const presses = [
      { kind: 'in' as const, at: inAt, flags: punchFlags('in', expected, place) },
      { kind: 'out' as const, at: outAt, flags: punchFlags('out', expected, place) },
    ];
    for (const p of presses) punches.push({ employeeId, date: toDateOnly(d.date), kind: p.kind, at: p.at, place, expected, flags: p.flags, source: 'system', userId: accountId });
    const day = dayFromPunches(
      d.date,
      presses.map((p) => ({ kind: p.kind, at: p.at.toISOString(), place, flags: p.flags })),
      shift,
    );
    days.push({ employeeId, date: toDateOnly(d.date), source: 'system', zohoStatus: null, permissionHours: null, importId: null, ...keptDayData(day), importedById: accountId, importedAt: outAt });
  }
  await tx.attendancePunch.createMany({ data: punches });
  await tx.attendanceDay.createMany({ data: days });

  // the requests: asked by the account (no manager, so straight to HR), the approved ones approved by HR the day after
  const types = await tx.leaveType.findMany({ where: { key: { in: ['annual', 'casual'] }, active: true }, select: { id: true, key: true } });
  const typeOf = new Map(types.map((t) => [t.key, t.id]));
  let requests = 0;
  for (const l of plan.leave) {
    const typeId = typeOf.get(l.key);
    if (!typeId) continue;
    const asked = at(l.askedOn, '10:15');
    const made = await tx.leaveRequest.create({
      data: { employeeId, employmentId: employment.id, typeId, startDate: toDateOnly(l.startDate), endDate: toDateOnly(l.endDate), days: l.days, reason: l.reason, status: l.status, createdById: accountId, createdAt: asked },
      select: { id: true },
    });
    await tx.leaveRequestStep.createMany({ data: steps(made.id, accountId, l.status === 'approved', l.askedOn) });
    requests++;
  }
  for (const p of plan.permissions) {
    const made = await tx.permissionRequest.create({
      data: {
        employeeId,
        employmentId: employment.id,
        date: toDateOnly(p.date),
        hours: p.hours,
        fromTime: toTimeOfDay(p.fromTime),
        toTime: toTimeOfDay(p.toTime),
        reason: p.reason,
        status: p.status,
        createdById: accountId,
        createdAt: at(p.askedOn, '16:40'),
      },
      select: { id: true },
    });
    await tx.permissionRequestStep.createMany({ data: steps(made.id, accountId, true, p.askedOn, '16:40') });
    requests++;
  }
  return { days: days.length, requests };
}

/** A request's steps: asked (no manager: on to HR), and HR's approval the next morning when approved. */
function steps(requestId: string, accountId: string | null, approved: boolean, askedOn: string, time = '10:15') {
  const asked = at(askedOn, time);
  return [
    { requestId, actorId: accountId, kind: 'submitted', at: asked },
    { requestId, actorId: null, kind: 'no_manager', at: asked },
    ...(approved ? [{ requestId, actorId: null, kind: leaveDecisionStepKind('hr'), decision: 'approve', at: at(addDays(askedOn, 1), '11:30') }] : []),
  ];
}
