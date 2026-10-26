import type { ExemptionState, SuggestedExemptionStart } from '@trendlix/shared';

// People exempt from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for attendance
// checkins and outs, trat them as if they achived their full working hours"; asked, "Optional check-in" and "Profile + a
// list in Check-in Setup"), as the API sends them (apps/api/src/attendance). Dates YYYY-MM-DD, moments ISO. A developer
// gets the reason hidden ("••••") by the API.

/** A period exempt from check-in: whose, why, from and until (null: no end), where it stands, who added and ended it. */
export interface CheckInExemptionView {
  id: string;
  employee: {
    id: string;
    employeeCode: string;
    fullNameEn: string;
    /** "Department › Team"; null without one. */
    department: string | null;
  };
  reason: string;
  startDate: string;
  endDate: string | null;
  state: ExemptionState;
  createdAt: string;
  createdBy: string | null;
  endedAt: string | null;
  endedBy: string | null;
  /** Whether the caller ends it (HR, Admin, Super Admin; a C-level person's only the CEO or a Super Admin). */
  canEnd: boolean;
}

/** GET /attendance/check-in-exemptions: the current and upcoming periods, by name, and whether the caller adds any. */
export interface CheckInExemptionsList {
  exemptions: CheckInExemptionView[];
  canAdd: boolean;
}

/**
 * GET /employees/:employeeId/check-in-exemptions: a person's periods, newest first, the current one, whether the caller
 * manages them, and the first day a new one starts with (owner, 26 October 2026: "auto fill his contract start date in
 * the exempt from date"): their contract's start, else their join date, else today; null for those who don't add one
 * and for a developer, left out by an API from before it.
 */
export interface EmployeeExemptionsView {
  periods: CheckInExemptionView[];
  current: CheckInExemptionView | null;
  canManage: boolean;
  suggestedFrom?: SuggestedExemptionStart | null;
}

/** POST /attendance/check-in-exemptions/:id/end: the period ended today, or removed when it hadn't started. */
export interface EndedExemptionView {
  exemption: CheckInExemptionView | null;
  removed: boolean;
}

/** POST /attendance/check-in-exemptions { employeeIds, reason, startDate?, endDate?, ownStart? }. */
export interface ExemptionBody {
  employeeIds: string[];
  reason: string;
  /** YYYY-MM-DD, for everyone; null: each their own with `ownStart`, else today. */
  startDate: string | null;
  /** YYYY-MM-DD; null: no end. */
  endDate: string | null;
  /** With no startDate: each person from their own first day, their contract's start, else their join date (26 October 2026). */
  ownStart?: true;
}
