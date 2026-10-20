import type { HomeDecision, HomeStage, HomeStatus, HomeStepKind } from '@trendlix/shared';

// Home locations as the API sends them (owner, 20 October 2026: "allow other users to request to add their home
// locations when working from home"; apps/api/src/attendance/home-location-views.ts): the point and the label only while
// the request is being decided or in force (null once rejected, withdrawn, replaced or removed), the radius, where it
// stands, what the caller may do with it, and every step (never with the point).

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

export interface HomeLocationView {
  id: string;
  kind: 'home';
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
