import {
  homeStage,
  keepsHomePoint,
  removesHome,
  waitsForHome,
  withdrawsHome,
  type HomeDecision,
  type HomeParties,
  type HomeStage,
  type HomeStatus,
  type HomeStepKind,
} from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { placeOf } from '../leave/views.js';
import type { UserRef } from '../payroll/adjustments/people.js';

// Home locations as the API sends them (owner, 20 October 2026: "allow other users to request to add their home
// locations when working from home"): shaped as a correction is (its employee, status, stage, who decides it, the
// steps), with `kind: 'home'`, the point and the label only while it is being decided or in force (the columns are
// emptied once it isn't), the radius, and what the caller may do with it. Only ever sent to the employee, HR (not a
// C-level person's), the CEO and the Super Admin: the service checks who asks before shaping it.

export const HOME_ENTITY = 'home_location';

/** What a request is shown with: its employee (and where they work now), who sent it (a CEO's own CEO step is a Super Admin's), the steps. */
export const HOME_INCLUDE = {
  employee: {
    select: {
      id: true,
      employeeCode: true,
      fullNameEn: true,
      fullNameAr: true,
      employments: {
        where: { endDate: null },
        orderBy: { joinDate: 'desc' },
        take: 1,
        select: { workArrangement: true, checkInAnywhere: true, department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } },
      },
    },
  },
  createdBy: { select: { id: true, roles: { select: { role: { select: { key: true } } } } } },
  steps: { orderBy: { id: 'asc' }, include: { actor: { select: { id: true, email: true } } } },
} satisfies Prisma.HomeLocationRequestInclude;

export type HomeRow = Prisma.HomeLocationRequestGetPayload<{ include: typeof HOME_INCLUDE }>;

/** Whether a request was sent by someone holding the CEO role (their own CEO step is then a Super Admin's). */
export const sentByCeo = (r: Pick<HomeRow, 'createdBy'>) => r.createdBy?.roles.some((x) => x.role.key === 'ceo') ?? false;

/** The caller as the views and the rules take them: who they are, their own profile, and the C-level people. */
export interface HomeCaller {
  user: SessionUser;
  employeeId: string | null;
  confidential: ReadonlySet<string>;
}

/** A request's parties for the shared rules (home-locations.ts), as `caller` sees it. */
export const homeParties = (r: Pick<HomeRow, 'employeeId' | 'createdBy'>, caller: HomeCaller): HomeParties => ({
  own: caller.employeeId !== null && caller.employeeId === r.employeeId,
  confidential: caller.confidential.has(r.employeeId),
  byCeo: sentByCeo(r),
});

/** A request as `caller` sees it. `names`: who took each step, by user id. */
export function homeView(r: HomeRow, caller: HomeCaller, names: ReadonlyMap<string, UserRef>) {
  const status = r.status as HomeStatus;
  const parties = homeParties(r, caller);
  const kept = keepsHomePoint(status);
  const job = r.employee.employments[0];
  return {
    id: r.id,
    kind: 'home' as const,
    employee: {
      id: r.employee.id,
      employeeCode: r.employee.employeeCode,
      fullNameEn: r.employee.fullNameEn,
      fullNameAr: r.employee.fullNameAr,
      ...placeOf(job?.department ?? null),
      // what their check-ins are held to: an Office person locked to the office network is still refused off it at home
      workArrangement: job?.workArrangement ?? null,
      checkInAnywhere: job?.checkInAnywhere ?? false,
    },
    // the point and the label, only while it is being decided or in force (deleted otherwise)
    latitude: kept && r.latitude ? r.latitude.toNumber() : null,
    longitude: kept && r.longitude ? r.longitude.toNumber() : null,
    label: kept ? r.label : null,
    radiusMetres: r.radiusMetres,
    accuracyMetres: r.accuracyMetres,
    status,
    stage: homeStage(status),
    waitingForYou: waitsForHome(caller.user, { ...parties, status }),
    // a C-level person's (owner's brief, 20 October 2026): the CEO takes both steps, HR doesn't see it
    confidential: parties.confidential,
    canWithdraw: withdrawsHome({ ...parties, status }),
    canRemove: removesHome(caller.user, { ...parties, status }),
    rejectedStage: r.rejectedStage as HomeStage | null,
    rejectReason: r.rejectReason,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
    steps: r.steps.map((s) => ({
      id: s.id.toString(),
      kind: s.kind as HomeStepKind,
      decision: s.decision as HomeDecision | null,
      radiusMetres: s.radiusMetres,
      comment: s.comment,
      actor: s.actor ? (names.get(s.actor.id)?.name ?? s.actor.email) : null,
      at: s.at.toISOString(),
    })),
    createdAt: r.createdAt.toISOString(),
  };
}

export type HomeLocationView = ReturnType<typeof homeView>;
