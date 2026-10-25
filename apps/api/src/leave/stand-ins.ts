import { seesConfidential, type Role, type StandInInForce } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// Stand-ins (owner, 25 October 2026: "if there are leaves applied by an employee and another employee in the same
// department is on a leave, how can we manage it without affecting the workflow?"; asked, "To a stand-in"): someone who
// approves names a stand-in when asking for leave, a person or HR; once the leave is approved, during its days, what waits
// at the approver's step (leave, permission, working from home, official duty, attendance corrections, a reimbursement's
// manager step) shows to and is decided by the stand-in instead, and new requests go to them; after its last day, what
// still waits is the approver's again. Nothing is moved in the database: who decides is worked out from the leave in force
// today (Cairo), so it moves back by itself. The rules: packages/shared leave-coverage.ts (movesToStandIn). These read
// it for a caller (access.ts) and for the notices (NoticesService).

type Db = PrismaService | Prisma.TransactionClient;

/** An approver away today whose step the caller takes: their name, their leave's last day, and whether as HR. */
export interface StandingFor {
  fullNameEn: string;
  until: string;
  /** The caller stands in as HR (anyone holding HR), not by name. */
  viaHr: boolean;
}

/** Who the caller stands in for today, and whether they are away themselves with a stand-in. */
export interface StandInView {
  /** The approvers away today whose step the caller takes, by employee id. */
  for: ReadonlyMap<string, StandingFor>;
  /** The caller is away today: their step's requests are their stand-in's (movesToStandIn), with the stand-in's name (null: HR). */
  away: (StandInInForce & { until: string; name: string | null }) | null;
}

export const NO_STAND_IN: StandInView = { for: new Map(), away: null };

/** The approved leave with a stand-in whose days include `day`. */
const inForceOn = (day: string) =>
  ({
    status: 'approved',
    startDate: { lte: toDateOnly(day) },
    endDate: { gte: toDateOnly(day) },
    OR: [{ standInId: { not: null } }, { standInHr: true }],
  }) satisfies Prisma.LeaveRequestWhereInput;

const STAND_IN_ROW = {
  employeeId: true,
  endDate: true,
  standInId: true,
  standInHr: true,
  employee: { select: { fullNameEn: true } },
  standIn: { select: { fullNameEn: true, account: { select: { isActive: true, roles: { select: { role: { select: { key: true } } } } } } } },
} satisfies Prisma.LeaveRequestSelect;

type StandInRow = Prisma.LeaveRequestGetPayload<{ select: typeof STAND_IN_ROW }>;

/** The stand-in of a row as it decides: a person (whether they see C-level people, the CEO or a Super Admin) or HR. */
function inForce(r: StandInRow): StandInInForce {
  if (r.standInHr || !r.standInId) return { employeeId: null, seesConfidential: false };
  const roles = (r.standIn?.account?.isActive ? r.standIn.account.roles.map((x) => x.role.key) : []) as Role[];
  return { employeeId: r.standInId, seesConfidential: seesConfidential({ roles }) };
}

/**
 * The caller's stand-ins today: those they stand in for (named, or as HR when they hold HR; never their own leave), and
 * their own leave's stand-in when they are away. `employeeId`: their own employee profile (none: HR's part only).
 */
export async function standInViewOf(db: Db, employeeId: string | null, user: Pick<SessionUser, 'roles'>, today = todayInCairo()): Promise<StandInView> {
  const hr = actsAs(user.roles, ['hr']);
  if (!employeeId && !hr) return NO_STAND_IN;
  const or: Prisma.LeaveRequestWhereInput[] = [];
  if (employeeId) or.push({ standInId: employeeId }, { employeeId });
  if (hr) or.push({ standInHr: true });
  const rows = await db.leaveRequest.findMany({ where: { AND: [inForceOn(today), { OR: or }] }, select: STAND_IN_ROW });
  if (!rows.length) return NO_STAND_IN;
  const forMap = new Map<string, StandingFor>();
  let away: StandInView['away'] = null;
  for (const r of rows) {
    const until = fromDateOnly(r.endDate);
    if (employeeId && r.employeeId === employeeId) {
      away = { ...inForce(r), until, name: r.standInHr ? null : (r.standIn?.fullNameEn ?? null) };
      continue;
    }
    if (employeeId && r.standInId === employeeId) forMap.set(r.employeeId, { fullNameEn: r.employee.fullNameEn, until, viaHr: false });
    else if (hr && r.standInHr) forMap.set(r.employeeId, { fullNameEn: r.employee.fullNameEn, until, viaHr: true });
  }
  return { for: forMap, away };
}

/** An approver's stand-in in force today (null: none, they decide themselves), with their leave's last day. */
export async function standInOfApprover(db: Db, approverId: string, today = todayInCairo()): Promise<(StandInInForce & { until: string }) | null> {
  const row = await db.leaveRequest.findFirst({ where: { AND: [inForceOn(today), { employeeId: approverId }] }, select: STAND_IN_ROW });
  return row ? { ...inForce(row), until: fromDateOnly(row.endDate) } : null;
}

/**
 * The leave whose stand-in hasn't been told it started, and whose days include today: what StandInSchedulerService tells
 * (once each, claimed by stand_in_told_at).
 */
export const standInsToTell = (db: Db, today = todayInCairo()) =>
  db.leaveRequest.findMany({ where: { AND: [inForceOn(today), { standInToldAt: null }] }, select: { id: true } });

/**
 * Whether someone approves for others, so names a stand-in for their leave: the direct manager of someone employed now,
 * or the head or lead of a department or team with someone else employed in it now (a department's teams too).
 */
export async function approvesForOthers(db: Db, employeeId: string): Promise<boolean> {
  const reports = await db.employment.count({ where: { managerId: employeeId, endDate: null, employeeId: { not: employeeId } } });
  if (reports > 0) return true;
  const led = await db.department.findMany({ where: { headId: employeeId }, select: { id: true } });
  if (!led.length) return false;
  const ids = led.map((d) => d.id);
  const members = await db.employment.count({
    where: { endDate: null, employeeId: { not: employeeId }, OR: [{ departmentId: { in: ids } }, { department: { parentId: { in: ids } } }] },
  });
  return members > 0;
}
