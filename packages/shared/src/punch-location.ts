// Where each press of Check in and Check out was (owner, 20 October 2026, sending a Daily Attendance row that listed a
// dozen presses: "simplify this, i want to view if it is remote or office, and location link"). Until then a press kept
// only office, remote or unknown, never the coordinates (19 October 2026). Asked, the owner chose:
// - "Yes, keep the spot": each check-in and check-out on the system keeps the point where it was pressed, read at that
//   moment only, never tracked, and "Map" opens it. The check-in panel tells the employee so. A press on a location the
//   phone said is a mock one keeps its point too (still flagged "Fake GPS suspected"), so HR can see it. Presses from
//   before 20 October 2026 have none: their map falls back to the check-in location they were matched to, by its name,
//   when they were at the office; any other has no map. The audit log never holds a point.
// - Who sees the spot: "HR, CEO, Super Admin", and the employee their own; never managers, nor Finance. A C-level
//   person's is hidden from HR as the rest of their attendance is (confidential.ts). Everyone else gets the place only.
// Refusing presses without a location (owner, the same day: "i want a flag to restrict checkin and out from unknown
// locations"; asked, "Company switch + exceptions" and "Allow as Office"): one switch on Attendance → Check-in Setup,
// "Refuse check-ins and check-outs without a location", off to start with. On, a press on the website without a usable
// reading is refused (409, with how to allow the location in the browser), unless HR exempts the person on their
// employment ("Can check in without a location") or the press comes from an office network the website signed (it
// counts as Office; only once the key the website signs with is set). Inside the app a press without a location is
// refused whatever the switch says (the app rule, 20 October 2026: "App only"), and the office network doesn't waive
// it there. HR's own recording of a day (a correction) is never refused. Pure: the API decides with these and the web
// shows the same words.

import { seesConfidential } from './confidential.js';
import type { CheckInPlace, OfficeLocation } from './check-in.js';
import type { Role } from './index.js';
import type { SessionKind } from './sessions.js';

type Roles = { roles: readonly Role[] };

// ---------- who sees the spot ----------

/** Who sees where others pressed (owner, 20 October 2026: "HR, CEO, Super Admin"); everyone sees their own. */
export const PUNCH_POINT_ROLES: readonly Role[] = ['hr', 'ceo', 'super_admin'];

/**
 * Whether the caller gets the point of a person's presses: their own always; anyone else's only HR, the CEO and the
 * Super Admin, and a C-level person's only those who see C-level people (the CEO, the Super Admin). Managers and Finance
 * get the place only.
 */
export function seesPunchPoints(viewer: Roles, person: { self: boolean; confidential: boolean }): boolean {
  if (person.self) return true;
  if (!viewer.roles.some((r) => PUNCH_POINT_ROLES.includes(r))) return false;
  return !person.confidential || seesConfidential(viewer);
}

// ---------- the spot of a press ----------

/** Where the point shown comes from: the press itself, or (a press from before the spot was kept) the location it was matched to. */
export type PunchPointFrom = 'press' | 'location';

/** A press's point as a map opens it, with the reading's accuracy in metres (none: not known). */
export interface PunchPoint {
  latitude: number;
  longitude: number;
  accuracyMetres: number | null;
  pointFrom: PunchPointFrom;
}

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * The point a press is shown at: its own, kept since 20 October 2026 ("Yes, keep the spot"); for one without (pressed
 * before, or the location refused or unavailable), the check-in location it was matched to, by its name then, when it
 * was at the office and that location is still there; else none.
 */
export function punchPoint(
  press: { latitude: number | null; longitude: number | null; accuracyMetres: number | null; place: CheckInPlace | string; locationName: string | null },
  locations: readonly Pick<OfficeLocation, 'name' | 'latitude' | 'longitude'>[],
): PunchPoint | null {
  const accuracyMetres = isNumber(press.accuracyMetres) && press.accuracyMetres >= 0 ? press.accuracyMetres : null;
  if (isNumber(press.latitude) && isNumber(press.longitude)) return { latitude: press.latitude, longitude: press.longitude, accuracyMetres, pointFrom: 'press' };
  if (press.place !== 'office' || !press.locationName) return null;
  const name = press.locationName.trim().toLowerCase();
  const matched = locations.find((l) => (l.name ?? '').trim().toLowerCase() === name && isNumber(l.latitude) && isNumber(l.longitude));
  return matched ? { latitude: matched.latitude!, longitude: matched.longitude!, accuracyMetres, pointFrom: 'location' } : null;
}

// ---------- refusing a press without a location ----------

/** The switch on Attendance → Check-in Setup, and its words. */
export const REFUSE_WITHOUT_LOCATION_LABEL = 'Refuse check-ins and check-outs without a location';

/** HR's exemption on an employment, beside "Can check in from anywhere". */
export const CHECK_IN_WITHOUT_LOCATION_LABEL = 'Can check in without a location';

/** The company's rule: whether a website press without a location is refused. */
export interface LocationRule {
  refuseWithoutLocation: boolean;
}

/** What of an employment the rule reads: HR's "Can check in without a location". */
export interface LocationRulePerson {
  checkInWithoutLocation?: boolean | null;
}

/** Whether a person's presses on the website need a location: the switch on, and HR hasn't exempted them. */
export const needsLocation = (rule: LocationRule, person: LocationRulePerson): boolean => rule.refuseWithoutLocation && !person.checkInWithoutLocation;

/** Why a press without a location is refused: inside the app (always), or the company's switch (the website). */
export type LocationRefusal = 'app' | 'no_location';

/**
 * Whether a press is refused for having no usable location reading (null: it is taken). With a reading, never. Inside
 * the app, always (owner, 20 October 2026: "App only"; the office network doesn't waive it there). On the website, only
 * with the switch on for the person (needsLocation), and not from an office network the website signed and the server
 * trusts (`officeNetwork`: "Allow as Office", it counts as at the office).
 */
export function locationRefusal(press: { session: SessionKind; reading: boolean; rule: LocationRule; person: LocationRulePerson; officeNetwork: boolean }): LocationRefusal | null {
  if (press.reading) return null;
  if (press.session === 'app') return 'app';
  if (!needsLocation(press.rule, press.person)) return null;
  return press.officeNetwork ? null : 'no_location';
}

/** The answer to a website press refused without a location: 409 Conflict, with how to allow it in the browser. */
export const NO_LOCATION_STATUS = 409;
export const NO_LOCATION_MESSAGE =
  'Check-ins need your location. Allow this site to use it in your browser (the icon beside the address → Location → Allow), then press again, or ask for an attendance correction.';

/** What the check-in panel says before a press, when the switch applies to the person (the website). */
export const LOCATION_NEEDED_TEXT = 'Check-ins need your location: allow it when the browser asks.';

/** What the panels say of the spot kept (owner, 20 October 2026: "Yes, keep the spot"). */
export const SPOT_KEPT_TEXT = 'Each check-in keeps the spot where you pressed, read only then; HR can see it.';
