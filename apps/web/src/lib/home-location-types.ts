import type { HomeDecision, HomeStage, HomeStatus, HomeStepKind, HomeType, LocationValidity } from '@trendlix/shared';

// Home locations as the API sends them (owner, 20 October 2026: "allow other users to request to add their home
// locations when working from home"; apps/api/src/attendance/home-location-views.ts): the point and the label only while
// the request is being decided or in force (null once rejected, withdrawn, replaced or removed), the radius, where it
// stands, what the caller may do with it, and every step (never with the point). Since 24 October 2026 (owner: "(Home
// Location - Remote Site - Client Location) with a comment reason"; "allow the HR to add an end date or lik it to the
// contract date"): its type, the reason, the end date wished, its validity and where it stands today, the client location
// it became, and (HR, the CEO, the Super Admin) the check-in places it overlaps. Each left out by an API from before it.

export interface HomeLocationStep {
  id: string;
  kind: HomeStepKind;
  decision: HomeDecision | null;
  /** Submitted: as asked; HR's approval: as HR set it. */
  radiusMetres: number | null;
  comment: string | null;
  actor: string | null;
  at: string;
}

/** A check-in place a request's circle overlaps (a warning, never a block): its name (none: a home, or hidden), kind, radius and how far. */
export interface HomeOverlapView {
  label: string | null;
  kind: 'office' | 'sub_location' | 'client' | HomeType;
  radiusMetres: number;
  distanceMetres: number | null;
}

export interface HomeLocationView {
  id: string;
  kind: 'home';
  /** Home Location, Remote Site or Client Location; a client location counts for everyone once approved (`forEveryone`). */
  type?: HomeType;
  forEveryone?: boolean;
  /** Why the employee needs it (required since 24 October 2026; none on those of before). */
  reason?: string | null;
  /** A remote site's or a client location's end date the employee wished (YYYY-MM-DD). */
  wishedEndDate?: string | null;
  /** How long it lasts, set at HR's step: until a date (`validUntil`), until the contract ends, or no end. */
  validity?: LocationValidity | null;
  validUntil?: string | null;
  /** Its last day today (the contract's read now; null: no end known), and whether it counts today. */
  endsOn?: string | null;
  inForce?: boolean;
  /** The client location it became on Check-in Setup (ended there by HR). */
  location?: { id: string; name: string; endedAt: string | null } | null;
  /** For HR, the CEO and the Super Admin: the check-in places it overlaps; null for anyone else. */
  overlaps?: HomeOverlapView[] | null;
  /** HR (a C-level person's: the CEO) may change an approved home's or remote site's validity. */
  canSetValidity?: boolean;
  employee: {
    id: string;
    employeeCode: string;
    fullNameEn: string;
    fullNameAr: string;
    department: string | null;
    team: string | null;
    /** Their current employment's work arrangement (none: no current employment), and HR's exception to the office network's lock. */
    workArrangement: string | null;
    checkInAnywhere: boolean;
  };
  latitude: number | null;
  longitude: number | null;
  label: string | null;
  radiusMetres: number;
  /** The reading's accuracy when the point was read on the device; null when put on the map. */
  accuracyMetres: number | null;
  status: HomeStatus;
  stage: HomeStage | null;
  waitingForYou: boolean;
  /** A C-level person's: the CEO takes both steps, HR doesn't see it. */
  confidential: boolean;
  canWithdraw: boolean;
  canRemove: boolean;
  rejectedStage: HomeStage | null;
  rejectReason: string | null;
  approvedAt: string | null;
  endedAt: string | null;
  steps: HomeLocationStep[];
  createdAt: string;
}

/** GET /home-locations/counts. */
export interface HomeLocationCounts {
  waiting: number;
}
