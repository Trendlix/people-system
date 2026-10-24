import {
  countsForEveryone,
  homeStage,
  keepsHomePoint,
  locationStanding,
  removesHome,
  setsLocationValidity,
  waitsForHome,
  withdrawsHome,
  type HomeDecision,
  type HomeParties,
  type HomeStage,
  type HomeStatus,
  type HomeStepKind,
  type HomeType,
  type LocationContract,
  type LocationValidity,
  type OverlapCandidate,
} from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { placeOf } from '../leave/views.js';
import type { UserRef } from '../payroll/adjustments/people.js';

// Home locations as the API sends them (owner, 20 October 2026: "allow other users to request to add their home
// locations when working from home"): shaped as a correction is (its employee, status, stage, who decides it, the
// steps), with `kind: 'home'`, the point and the label only while it is being decided or in force (the columns are
// emptied once it isn't), the radius, and what the caller may do with it. Only ever sent to the employee, HR (not a
// C-level person's), the CEO and the Super Admin: the service checks who asks before shaping it. Since 24 October 2026
// (owner: "(Home Location - Remote Site - Client Location)"): its type, the reason, the end date wished, its validity and
// where it stands today (its last day, whether it counts), the client location it became, and (for HR, the CEO and the
// Super Admin) the check-in places it overlaps, a warning only.

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
  // the client location it became (24 October 2026), as Check-in Setup keeps it
  location: { select: { id: true, name: true, validUntil: true, endedAt: true } },
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

/** A place a request's circle overlaps, as HR and the CEO are warned of it: its name (none: a home), kind, radius and how far. */
export type OverlapView = Omit<OverlapCandidate, 'latitude' | 'longitude'> & { distanceMetres: number };

/** What a view needs besides the row: the day, the person's contract (for "until the contract ends"), and the overlaps (null: not shown to the caller). */
export interface HomeViewFacts {
  today: string;
  contract: LocationContract | null;
  overlaps: OverlapView[] | null;
}

/**
 * Where an approved request stands today: a client location by the company location it became (its date, or HR's end; none
 * left once a Super Admin removed it), anything else by its own validity.
 */
export function standingOf(r: Pick<HomeRow, 'status' | 'type' | 'validity' | 'validUntil' | 'location' | 'locationId'>, facts: Pick<HomeViewFacts, 'today' | 'contract'>) {
  if (r.type === 'client' && r.status === 'approved') {
    const end = r.location?.validUntil ? fromDateOnly(r.location.validUntil) : null;
    return { end, inForce: !!r.location && !r.location.endedAt && (end === null || end >= facts.today) };
  }
  return locationStanding({ status: r.status, validity: r.validity, validUntil: r.validUntil ? fromDateOnly(r.validUntil) : null }, facts.contract, facts.today);
}

/** A request as `caller` sees it. `names`: who took each step, by user id. */
export function homeView(r: HomeRow, caller: HomeCaller, names: ReadonlyMap<string, UserRef>, facts: HomeViewFacts) {
  const status = r.status as HomeStatus;
  const parties = homeParties(r, caller);
  const kept = keepsHomePoint(status);
  const job = r.employee.employments[0];
  const type = r.type as HomeType;
  const standing = standingOf(r, facts);
  return {
    id: r.id,
    kind: 'home' as const,
    // Home Location, Remote Site or Client Location (24 October 2026); a client location counts for everyone once approved
    type,
    forEveryone: countsForEveryone(type),
    reason: r.reason,
    wishedEndDate: r.wishedEndDate ? fromDateOnly(r.wishedEndDate) : null,
    validity: (r.validity as LocationValidity | null) ?? null,
    validUntil: r.validUntil ? fromDateOnly(r.validUntil) : null,
    // its last day (null: no end known) and whether it counts today
    endsOn: standing.end,
    inForce: standing.inForce,
    // the client location it became, as Check-in Setup keeps it (ended there by HR)
    location: r.location ? { id: r.location.id, name: r.location.name, endedAt: r.location.endedAt?.toISOString() ?? null } : null,
    overlaps: facts.overlaps,
    canSetValidity: setsLocationValidity(caller.user, { ...parties, status, type }),
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
    canRemove: removesHome(caller.user, { ...parties, status, type }),
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
