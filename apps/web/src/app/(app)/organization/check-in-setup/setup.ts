import {
  checkInLocationProblems,
  GPS_ACCURACY_ALLOWANCE_MAX,
  GPS_ROUGH_DEFAULT,
  gpsRoughProblems,
  HOME_STATUSES,
  HOME_TYPE_LABELS,
  HOME_TYPES,
  homeStatusLabel,
  isHomeStatus,
  isHomeType,
  LINKED_PEOPLE_SHOWN,
  locationKindLabel,
  NO_WEB_KEY_TEXT,
  OFFICE_RADIUS_DEFAULT,
  officeAddressesProblems,
  officeNetworksFrom,
  SIGNED_IP_PROBLEM_TEXT,
  SMALL_RADIUS_HINT,
  SMALL_RADIUS_METRES,
  subLocationLabel,
  validityText,
  type HomeStatus,
  type HomeType,
  type OfficeNetwork,
  type Role,
  type SignedIpProblem,
} from '@trendlix/shared';
import { formatDate, parseDate } from '../../../../lib/format';
import { latin, roundCoordinate, type MapCircle } from '../../../../lib/map-point';
import { canDelete, hasRole } from '../../../../lib/roles';
import type { ViewAs } from '../../../../lib/view-as';
import { joinShown } from '../../../../lib/hidden';

// Attendance → Check-in Setup (owner, 20 October 2026: "i cant find in the system where to add the eligable check in
// locations", then "Own page, several locations"): where a check-in on the system counts as the office. Check-in
// Locations, each a name, a point and a radius (the office's point and radius were in Payroll Setup → Your Rules until
// then); Office Networks, the office's public addresses, with the switch locking check-ins to them (owner, the same day:
// "allow me to lock checkin's to wifi name or ip, whatever is right"); and Zoho People's check-in addresses, moved here
// from Your Rules. HR and Admin (a Super Admin as an Admin); a Super Admin removes a location. Pure code, tested: who
// sees it, each form read into what the API takes, and what the page says. Relative imports: the tests run without the
// "@/" alias. The main office and its sub-locations (owner, 20 October 2026: "main office location is the hero and other
// locations are like sub locations. shown with their name and linked users"): the page laid out by them, the hero's
// words, the people's chips, the picker's choices, and what Make main and Remove ask first. The GPS lock (owner, 24 October
// 2026: "Yes, add a GPS lock too"): its form read as the API takes it and what the page says of it. The client locations
// (the same day: "all employees if a customer location"), laid out apart, their end said and changed; and HR's list of
// the requested check-in locations, filtered by type and status.

type WithRoles = { roles: readonly Role[]; viewAs?: ViewAs | null };

/** HR and Admin (a Super Admin as an Admin) keep the check-in setup. */
export const seesCheckInSetup = (user: WithRoles): boolean => hasRole(user, 'hr', 'admin');

/** A Super Admin removes a location, as every deletion (owner's decision, 15 October 2026). */
export const removesLocations = (user: WithRoles): boolean => canDelete(user);

/** The page's sections, for links into it. */
export const LOCATIONS_ID = 'check-in-locations';
export const NETWORKS_ID = 'office-networks';
/** The switch refusing presses without a location (owner, 20 October 2026: "Company switch + exceptions"). */
export const LOCATION_RULE_ID = 'without-location';
export const ZOHO_ID = 'zoho-addresses';
/**
 * The requested check-in locations (owner, 20 October 2026: "allow other users to request to add their home locations when
 * working from home"; since 24 October 2026 a remote site or a client location too).
 */
export const HOMES_ID = 'home-locations';
/** Office staff's check-ins locked to the check-in locations by GPS (owner, 24 October 2026: "Yes, add a GPS lock too"). */
export const GPS_LOCK_ID = 'gps-lock';
/** The client locations, everyone's (owner, 24 October 2026: "all employees if a customer location"). */
export const CLIENTS_ID = 'client-locations';

// ---------- the locations ----------

/** A coordinate as typed: a decimal number, a minus allowed, kept to 6 decimals; empty: none (null); else NaN. */
export function coordinateFrom(raw: string): number | null {
  const s = latin(raw).trim().replace(/[−–]/g, '-');
  if (s === '') return null;
  if (!/^[-+]?\d{1,3}(\.\d+)?$/.test(s)) return NaN;
  return roundCoordinate(Number(s));
}

/** "30.0596, 31.3462" pasted from a map into the latitude field: the two of them. */
const PAIR = /^\s*([-+]?\d{1,3}(?:\.\d+)?)\s*[,،]\s*([-+]?\d{1,3}(?:\.\d+)?)\s*$/;

/** A location as the API takes it (POST and PATCH /attendance/check-in-setup/locations). */
export interface LocationBody {
  name: string;
  latitude: number | null;
  longitude: number | null;
  radiusMetres: number;
}

/**
 * A location as typed: its name, the latitude and longitude (both pasted into Latitude from a map, "30.0596, 31.3462",
 * are split), each to 6 decimals and both needed, and the radius in whole metres (150 to start with). What is wrong is
 * the shared checks' (checkInLocationProblems), the API's own.
 */
export function locationFrom(typed: { name: string; latitude: string; longitude: string; radius: string }): { body: LocationBody; problems: string[] } {
  let latitude = latin(typed.latitude);
  let longitude = latin(typed.longitude);
  const pair = longitude.trim() === '' ? PAIR.exec(latitude) : null;
  if (pair) [latitude, longitude] = [pair[1], pair[2]];
  const radiusText = latin(typed.radius).trim();
  const radiusMetres = radiusText === '' ? OFFICE_RADIUS_DEFAULT : /^\d+$/.test(radiusText) ? Number(radiusText) : NaN;
  const body = { name: typed.name.trim().replace(/\s+/g, ' '), latitude: coordinateFrom(latitude), longitude: coordinateFrom(longitude), radiusMetres };
  return { body, problems: checkInLocationProblems(body) };
}

/** A location's form as sent: its fields by name. */
export const locationBody = (fd: FormData) =>
  locationFrom({ name: String(fd.get('name') ?? ''), latitude: String(fd.get('latitude') ?? ''), longitude: String(fd.get('longitude') ?? ''), radius: String(fd.get('radiusMetres') ?? '') });

/** A location's point and radius as the list says them: "30.059600, 31.346200 · within 150 m". */
export const locationText = (l: { latitude: number; longitude: number; radiusMetres: number }): string =>
  `${l.latitude.toFixed(6)}, ${l.longitude.toFixed(6)} · within ${l.radiusMetres.toLocaleString('en-US')} m`;

// ---------- the main office and its sub-locations (owner, 20 October 2026: "for this part, it looks unarranged to me,
// it needs to be more handsome. main office location is the hero and other locations are like sub locations. shown with
// their name and linked users") ----------

/**
 * What of a location the page lays out by: whether it is the main office (left out by an API from before sub-locations),
 * and whether it is a client location (24 October 2026; left out by an API from before them).
 */
interface Located {
  isMain?: boolean;
  kind?: 'office' | 'client';
}

const isClient = (l: Located) => l.kind === 'client';

/**
 * The main office (none yet) and the sub-locations, in the API's order. From an API from before sub-locations (no
 * `isMain`), every location was the office: the first is shown as the main. The client locations (24 October 2026) are
 * neither: clientLocationsOf lays them out apart.
 */
export function mainAndSubs<L extends Located>(locations: readonly L[]): { main: L | null; subs: L[] } {
  const office = locations.filter((l) => !isClient(l));
  const known = office.some((l) => typeof l.isMain === 'boolean');
  const main = known ? (office.find((l) => l.isMain === true) ?? null) : (office[0] ?? null);
  return { main, subs: office.filter((l) => l !== main) };
}

/** The client locations (owner, 24 October 2026: "all employees if a customer location"), in the API's order. */
export const clientLocationsOf = <L extends Located>(locations: readonly L[]): L[] => locations.filter(isClient);

/** A radius in words: "Within 20 m". */
export const withinText = (metres: number): string => `Within ${metres.toLocaleString('en-US')} m`;

/** The gentle hint on a main office of a small radius (under 50 m): phones are often that far off. None otherwise. */
export const radiusHint = (metres: number): string | null => (metres < SMALL_RADIUS_METRES ? SMALL_RADIUS_HINT : null);

/** How a check-in within a sub-location shows on the attendance pages: "Remote - Studio". */
export const shownAsText = (name: string): string => subLocationLabel(name);

/** The sub-locations (and the client locations) as the main office's map draws them faintly: each its point, radius and name. */
export const faintCircles = (subs: readonly { name: string; latitude: number; longitude: number; radiusMetres: number; kind?: 'office' | 'client' }[]): MapCircle[] =>
  subs.map((l) => ({ latitude: l.latitude, longitude: l.longitude, radiusMetres: l.radiusMetres, name: `${l.name} (${l.kind === 'client' ? 'client location' : 'sub-location'})` }));

/** A sub-location's linked people as its card shows them: the first five as chips, and how many more ("+N more"). */
export function chipsOf<P>(people: readonly P[], shown = LINKED_PEOPLE_SHOWN): { shown: P[]; more: number } {
  return { shown: people.slice(0, shown), more: Math.max(0, people.length - shown) };
}

/** "+3 more". */
export const moreText = (count: number): string => `+${count} more`;

/** Someone "Link people" offers, as the API sends them. */
export interface LinkCandidate {
  id: string;
  fullNameEn: string;
  employeeCode: string;
  department: string | null;
}

/** Whom "Link people" offers: everyone not linked yet nor chosen already, by name: "Lina Hassan · EMP-0012 · Design". */
export function linkOptions(candidates: readonly LinkCandidate[], taken: readonly string[]): { value: string; label: string }[] {
  const out = new Set(taken);
  return candidates
    .filter((c) => !out.has(c.id))
    .map((c) => ({ value: c.id, label: joinShown([c.fullNameEn, c.employeeCode, c.department]) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

/** The people chosen in the picker, in the order chosen, each once. */
export const withChosen = (chosen: readonly string[], id: string): string[] => (id && !chosen.includes(id) ? [...chosen, id] : [...chosen]);

/** The picker's button: "Link 1 person", "Link 3 people". */
export const linkButtonText = (count: number): string => (count === 1 ? 'Link 1 person' : `Link ${count} people`);

/** What Make main asks first. */
export const makeMainConfirm = (name: string, main: string | null): string =>
  `Make ${name} the main office? Check-ins within it will count as Office for everyone${
    main ? `, and ${main} becomes a sub-location: check-ins there will show as ${subLocationLabel(main)}` : ''
  }.`;

/** What removing a location asks first: the main office (only once it is the last), or a sub-location with its people. */
export const removeConfirm = (name: string, isMain: boolean): string =>
  isMain
    ? `Remove the main office ${name}? With no check-in location left, every check-in on the system is kept as location unknown.`
    : `Remove the sub-location ${name}? Its people are unlinked, and check-ins within it will be plain Remote.`;

/** What a location added says: the first is the main office, every later one a sub-location. */
export const addedText = (name: string, isMain: boolean): string =>
  isMain ? `Added ${name}, the main office: check-ins within it count as Office.` : `Added ${name}: check-ins within it show as ${subLocationLabel(name)}.`;

// ---------- the office networks ----------

/** The networks' form: the switch (a hidden "false", then the checkbox's "true"), and each row's name and address (a row with both empty is left out). */
export function networksBody(fd: FormData): { body: { lock: boolean; networks: OfficeNetwork[] }; problems: string[] } {
  const labels = fd.getAll('networkLabel').map(String);
  const ranges = fd.getAll('networkRange').map(String);
  const rows = labels.map((label, i) => ({ label, range: ranges[i] ?? '' })).filter((r) => r.label.trim() || r.range.trim());
  const { networks, problems } = officeNetworksFrom(rows);
  return { body: { lock: fd.getAll('lock').includes('true'), networks }, problems };
}

/** The networks as the API sends them (GET /attendance/check-in-setup/networks). */
export interface NetworksState {
  lock: boolean;
  networks: readonly OfficeNetwork[];
  serverKey: boolean;
  inForce: boolean;
  here: { signed: true; ip: string; network: string | null } | { signed: false; problem: SignedIpProblem };
}

/**
 * Whether the lock can be switched on from this page, and what the page says of it: Ready (the website and the server
 * share the key, and this page's address was signed: which address, and whether it is an office network), or what is
 * missing: the server's key (deploy/web-key.sh), the website's (WEB_KEY in Vercel), or a key that doesn't match.
 */
export function networkStatus(state: NetworksState, webKey: boolean): { ready: boolean; text: string } {
  if (!state.serverKey) return { ready: false, text: SIGNED_IP_PROBLEM_TEXT.no_server_key };
  if (!state.here.signed) {
    const { problem } = state.here;
    if (problem === 'unsigned') {
      return { ready: false, text: webKey ? 'Your address couldn’t be read on this page, so the lock can’t be checked from here: open the page on the website itself.' : NO_WEB_KEY_TEXT };
    }
    return { ready: false, text: SIGNED_IP_PROBLEM_TEXT[problem] };
  }
  const { ip, network } = state.here;
  return { ready: true, text: `Ready: the website and the server share the key. You are on ${ip}${network ? `, the office network ${network}` : ', which isn’t one of the office networks'}.` };
}

/**
 * The lock as it stands, in a sentence; `gpsInForce`: the GPS lock is in force too (24 October 2026), when a press passing
 * either lock is enough.
 */
export function lockText(state: Pick<NetworksState, 'lock' | 'inForce' | 'serverKey' | 'networks'>, gpsInForce = false): string {
  if (state.inForce) {
    const either = gpsInForce ? ' With the GPS lock on too (below), a press passes when either does: on the office network, or inside a check-in location.' : '';
    return `On: Office staff check in and out on the office network only, or at a sub-location they are linked to, unless HR lets them check in from anywhere.${either}`;
  }
  if (state.lock && !state.serverKey) return 'Switched on, but not in force: the server has no key, so no one is refused.';
  if (state.lock && !state.networks.length) return 'Switched on, but not in force: there is no office network.';
  return 'Off: everyone checks in from anywhere; a check-in on an office network still counts as at the office.';
}

// ---------- presses without a location (owner, 20 October 2026: "i want a flag to restrict checkin and out from
// unknown locations"; asked, "Company switch + exceptions", "Allow as Office") ----------

/** The switch's form, as PUT /attendance/check-in-setup/location-rule takes it (a hidden "false", then the checkbox's "true"). */
export const locationRuleBody = (fd: FormData): { refuseWithoutLocation: boolean } => ({ refuseWithoutLocation: fd.getAll('refuseWithoutLocation').includes('true') });

/**
 * The switch as it stands, in a sentence; `networkReady`: an office network counts without a location (the key in place
 * and a network); `gpsInForce`: the GPS lock (24 October 2026) refuses Office staff's presses without a location whatever
 * this switch says.
 */
export function locationRuleText(rule: { refuseWithoutLocation: boolean }, networkReady: boolean | null, gpsInForce = false): string {
  const gps = gpsInForce ? ` ${GPS_NO_LOCATION_TEXT}` : '';
  if (!rule.refuseWithoutLocation) return `Off: on the website a check-in without a location is kept as location unknown. In the app a location is always needed.${gps}`;
  const office = networkReady
    ? ' A press from an office network without one counts as at the office.'
    : networkReady === false
      ? ' Without the key or an office network (above), a press from the office without a location is refused too.'
      : '';
  return `On: on the website a check-in or check-out without a location is refused, unless HR lets the person check in without one on their profile.${office} In the app a location is always needed.${gps}`;
}

/** What the location rule's section says of the GPS lock's own rule for presses without a location (24 October 2026). */
export const GPS_NO_LOCATION_TEXT =
  'With the GPS lock on (below), an Office person’s check-in or check-out without a location is refused on the website too, whatever this switch says, unless HR lets them check in without one.';

/** What the saved switch says. */
export const locationRuleSaved = (on: boolean): string =>
  on ? 'Saved. Check-ins and check-outs without a location are refused from now on.' : 'Saved. Check-ins without a location are kept as location unknown again.';

// ---------- the GPS lock (owner, 24 October 2026: "while these aare not checked, people can still check in and out from
// anywhere"; asked, "Yes, add a GPS lock too") ----------

/** The GPS lock as GET /attendance/check-in-setup/gps-lock sends it. */
export interface GpsLockState {
  lock: boolean;
  roughMetres: number;
  inForce: boolean;
}

/**
 * The GPS lock's form, as PUT /attendance/check-in-setup/gps-lock takes it: the switch (a hidden "false", then the
 * checkbox's "true") and the accuracy past which a reading is too rough, whole metres (empty: 200), checked as the API does.
 */
export function gpsLockBody(fd: FormData): { body: { lock: boolean; roughMetres: number }; problems: string[] } {
  const typed = latin(String(fd.get('roughMetres') ?? '')).trim();
  const roughMetres = typed === '' ? GPS_ROUGH_DEFAULT : /^\d+$/.test(typed) ? Number(typed) : Number.NaN;
  return { body: { lock: fd.getAll('lock').includes('true'), roughMetres }, problems: gpsRoughProblems(roughMetres) };
}

/**
 * The GPS lock as it stands, in a sentence; `networkInForce`: the office network's lock is in force too, when a press
 * passing either lock is enough.
 */
export function gpsLockText(state: GpsLockState, networkInForce = false): string {
  if (state.inForce) {
    const either = networkInForce ? ' With the office network’s lock on too, a press passes when either does: on the office network, or inside a check-in location.' : '';
    return `On: Office staff check in and out only inside a check-in location or one of their own approved places, unless HR lets them check in from anywhere; a reading less accurate than ${state.roughMetres.toLocaleString('en-US')} m is refused as too rough.${either}`;
  }
  if (state.lock) return 'Switched on, but not in force: there is no main office yet, so no one is refused.';
  return 'Off: a check-in outside every check-in location is kept as remote and flagged for HR on an office day, never refused.';
}

/** How the accuracy is allowed for, in words, for the form's hint. */
export const GPS_ALLOWANCE_TEXT = `A reading counts as inside a location when its distance from the location’s point, less its accuracy (at most ${GPS_ACCURACY_ALLOWANCE_MAX} m), is within the radius.`;

/** What the saved GPS lock says. */
export const gpsLockSaved = (on: boolean): string =>
  on ? 'Saved. Office staff now check in and out inside the check-in locations only.' : 'Saved. Check-ins outside the check-in locations are kept as remote again, never refused.';

// ---------- the client locations (owner, 24 October 2026: "all employees if a customer location") ----------

/** How a check-in within a client location shows on the attendance pages: "Client · Acme". */
export const clientShownAsText = (name: string): string => locationKindLabel('client', name);

/** A client location's end in words: "Ended 25/10/2026", "Until 31/12/2026", "No end". */
export function clientEndText(l: { validUntil?: string | null; endedAt?: string | null }): string {
  if (l.endedAt) return `Ended ${formatDate(l.endedAt)}`;
  return l.validUntil ? `Until ${formatDate(l.validUntil)}` : 'No end';
}

/**
 * A client location's end as typed (PATCH /attendance/check-in-setup/locations/:id { validUntil }): "No end" (null) or a
 * date, DD/MM/YYYY, today or later (`today`: YYYY-MM-DD, Cairo).
 */
export function clientEndBody(fd: FormData, today: string): { body: { validUntil: string | null } | null; problems: string[] } {
  if (String(fd.get('ends') ?? '') === 'no_end') return { body: { validUntil: null }, problems: [] };
  const typed = String(fd.get('validUntil') ?? '');
  const date = parseDate(typed);
  if (!date) return { body: null, problems: ['Enter the date it lasts until as DD/MM/YYYY, e.g. 31/12/2026, or choose No end.'] };
  if (date < today) return { body: null, problems: ['Choose an end date of today or later.'] };
  return { body: { validUntil: date }, problems: [] };
}

/** What ending a client location asks first. */
export const endClientConfirm = (name: string): string =>
  `End ${name} now? Check-ins within it stop counting for everyone from now on; it stays listed as ended, with its request.`;

// ---------- the requested check-in locations (owner, 24 October 2026: "Home Location - Remote Site - Client Location") ----------

/** The types the list filters by, all of them first. */
export const REQUEST_TYPE_FILTERS = ['all', ...HOME_TYPES] as const;
export type RequestTypeFilter = (typeof REQUEST_TYPE_FILTERS)[number];

/** The statuses the list filters by: approved first (the places in force or ended), then being decided, waiting for you, every status, all. */
export const REQUEST_STATUS_FILTERS = ['approved', 'open', 'waiting', ...HOME_STATUSES.filter((s) => s !== 'approved' && s !== 'with_hr' && s !== 'with_ceo'), 'all'] as const;
export type RequestStatusFilter = 'approved' | 'open' | 'waiting' | 'all' | HomeStatus;

export const REQUEST_STATUS_FILTER_LABELS: Record<string, string> = { approved: 'Approved', open: 'Being decided', waiting: 'Waiting for you', all: 'All' };

/** A filter's label: "Home Location", "Being decided", "Rejected". */
export const requestFilterLabel = (f: string): string =>
  f === 'all' ? 'All' : isHomeType(f) ? HOME_TYPE_LABELS[f] : (REQUEST_STATUS_FILTER_LABELS[f] ?? (isHomeStatus(f) ? homeStatusLabel(f) : f));

type Query = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

/** The list's filters from the page's address (?type=&status=): all types and the approved ones unless chosen. */
export function readRequestFilters(query: Query): { type: RequestTypeFilter; status: RequestStatusFilter } {
  const type = one(query.type);
  const status = one(query.status);
  return {
    type: isHomeType(type) ? type : 'all',
    status: (REQUEST_STATUS_FILTERS as readonly string[]).includes(status) ? (status as RequestStatusFilter) : 'approved',
  };
}

/** The API's list for the filters (GET /home-locations?status=&type=): "all" left out. */
export function requestsApi(f: { type: RequestTypeFilter; status: RequestStatusFilter }): string {
  const q = new URLSearchParams();
  if (f.status !== 'all') q.set('status', f.status);
  if (f.type !== 'all') q.set('type', f.type);
  const s = q.toString();
  return s ? `/home-locations?${s}` : '/home-locations';
}

/** This page with other filters, at the list: "?type=client&status=approved#home-locations". */
export function requestFilterHref(f: { type: RequestTypeFilter; status: RequestStatusFilter }, change: Partial<{ type: RequestTypeFilter; status: RequestStatusFilter }>): string {
  const next = { ...f, ...change };
  const q = new URLSearchParams();
  if (next.type !== 'all') q.set('type', next.type);
  if (next.status !== 'approved') q.set('status', next.status);
  const s = q.toString();
  return `${s ? `?${s}` : '?'}#${HOMES_ID}`;
}

/** A request as a row of the list says it: its type, its name (a home's label, or none), where it stands, and how long it lasts. */
export function requestRowText(r: {
  type?: HomeType;
  label: string | null;
  latitude: number | null;
  status: HomeStatus;
  confidential?: boolean;
  validity?: string | null;
  endsOn?: string | null;
  inForce?: boolean;
  location?: { name: string; endedAt: string | null } | null;
}): { type: string; name: string; status: string; lasts: string | null; ended: boolean } {
  const type = HOME_TYPE_LABELS[r.type ?? 'home'];
  const name = r.location?.name ?? r.label ?? (r.latitude === null ? 'Point deleted' : r.type && r.type !== 'home' ? 'No name' : 'No label');
  const approved = r.status === 'approved';
  const lasts = approved
    ? r.location?.endedAt
      ? `Ended ${formatDate(r.location.endedAt)}`
      : validityText(r.validity ?? (r.type === 'client' ? 'no_end' : null), r.endsOn ?? null, formatDate)
    : null;
  return { type, name, status: homeStatusLabel(r.status, r.confidential), lasts, ended: approved && r.inForce === false };
}

// ---------- Zoho People's check-in addresses ----------

/**
 * The office's addresses as typed (owner, 19 October 2026: attendance from Zoho People, "13 and 17 al mahrouki is also in
 * office"): one a line, each trimmed, the empty lines dropped.
 */
export const officeAddressesFrom = (typed: string): string[] =>
  typed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/** Zoho People's addresses' form, as PATCH /payroll/settings takes them, and what is wrong (the API's checks). */
export function addressesBody(fd: FormData): { body: { officeAddresses: string[] }; problems: string[] } {
  const officeAddresses = officeAddressesFrom(String(fd.get('officeAddresses') ?? ''));
  return { body: { officeAddresses }, problems: officeAddressesProblems(officeAddresses) };
}
