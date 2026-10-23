import { punchPoint, type CheckInFlag, type CheckInPlace, type OfficeLocation, type PunchKind, type PunchPointFrom } from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';

// Presses of Check in and Check out as the API sends them (owner, 20 October 2026: "simplify this, i want to view if it
// is remote or office, and location link"; asked, "Yes, keep the spot", seen by "HR, CEO, Super Admin"): the day each
// counts on, in or out, the server's moment, the place (office, home, remote, unknown), the flags, the check-in location
// and the office network by their names. Only to those who see the spot (packages/shared seesPunchPoints: HR, the CEO,
// the Super Admin, the employee themself; a C-level person's not HR), also its point (latitude, longitude), the
// reading's accuracy in metres and where the point comes from: the press itself, or for a press from before the spot was
// kept, the check-in location it was matched to by its name. Everyone else (managers, Finance) gets no such keys at
// all. Every response that carries presses shapes them here: Daily Attendance and the team view, a person's month, My
// Attendance and the phone pages, and today's check-in panel.

/** What a press is read with. */
export const PUNCH_SELECT = {
  date: true,
  kind: true,
  at: true,
  place: true,
  accuracyMetres: true,
  flags: true,
  locationName: true,
  officeNetwork: true,
  latitude: true,
  longitude: true,
  odRequestId: true,
} satisfies Prisma.AttendancePunchSelect;

export type PunchRow = Prisma.AttendancePunchGetPayload<{ select: typeof PUNCH_SELECT }>;

/** A press as everyone who sees the day gets it: the place, never the spot. */
export interface PunchPlaceView {
  /** The working day it counts on (YYYY-MM-DD). */
  date: string;
  kind: PunchKind;
  at: string;
  place: CheckInPlace;
  flags: CheckInFlag[];
  /** The check-in location it was within, by its name then; the office network it came from, by its name. */
  locationName: string | null;
  officeNetwork: string | null;
  /**
   * Pressed within an approved official duty (owner, 23 October 2026: "Check in from anywhere"): its request, marked OD;
   * left out of a press without one.
   */
  odRequestId?: string;
}

/** The spot, for those who see it: none (null) when the press has no point and none can stand in for it. */
export interface PunchSpotView {
  latitude: number | null;
  longitude: number | null;
  accuracyMetres: number | null;
  pointFrom: PunchPointFrom | null;
}

export type PunchView = PunchPlaceView & Partial<PunchSpotView>;

/** The locations a press from before the spot was kept falls back to, by their names. */
export type FallbackLocations = readonly Pick<OfficeLocation, 'name' | 'latitude' | 'longitude'>[];

/** A press as the caller gets it: the spot only when `seesSpot` (seesPunchPoints). */
export function punchView(p: PunchRow, seesSpot: boolean, locations: FallbackLocations): PunchView {
  const view: PunchPlaceView = {
    date: fromDateOnly(p.date),
    kind: p.kind as PunchKind,
    at: p.at.toISOString(),
    place: p.place as CheckInPlace,
    flags: p.flags as CheckInFlag[],
    locationName: p.locationName,
    officeNetwork: p.officeNetwork,
    ...(p.odRequestId && { odRequestId: p.odRequestId }),
  };
  if (!seesSpot) return view;
  const point = punchPoint(
    { latitude: p.latitude?.toNumber() ?? null, longitude: p.longitude?.toNumber() ?? null, accuracyMetres: p.accuracyMetres, place: p.place, locationName: p.locationName },
    locations,
  );
  return {
    ...view,
    latitude: point?.latitude ?? null,
    longitude: point?.longitude ?? null,
    accuracyMetres: p.accuracyMetres,
    pointFrom: point?.pointFrom ?? null,
  };
}

/** A coordinate kept to 6 decimals (about 10 cm), as the columns keep it. */
export const coordinate = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
