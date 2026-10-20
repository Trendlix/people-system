import {
  checkInLocationProblems,
  NO_WEB_KEY_TEXT,
  OFFICE_RADIUS_DEFAULT,
  officeAddressesProblems,
  officeNetworksFrom,
  SIGNED_IP_PROBLEM_TEXT,
  type OfficeNetwork,
  type Role,
  type SignedIpProblem,
} from '@trendlix/shared';
import { latin, roundCoordinate } from '../../../../lib/map-point';
import { canDelete, hasRole } from '../../../../lib/roles';
import type { ViewAs } from '../../../../lib/view-as';

// Attendance → Check-in Setup (owner, 20 October 2026: "i cant find in the system where to add the eligable check in
// locations", then "Own page, several locations"): where a check-in on the system counts as the office. Check-in
// Locations, each a name, a point and a radius (the office's point and radius were in Payroll Setup → Your Rules until
// then); Office Networks, the office's public addresses, with the switch locking check-ins to them (owner, the same day:
// "allow me to lock checkin's to wifi name or ip, whatever is right"); and Zoho People's check-in addresses, moved here
// from Your Rules. HR and Admin (a Super Admin as an Admin); a Super Admin removes a location. Pure code, tested: who
// sees it, each form read into what the API takes, and what the page says. Relative imports: the tests run without the
// "@/" alias.

type WithRoles = { roles: readonly Role[]; viewAs?: ViewAs | null };

/** HR and Admin (a Super Admin as an Admin) keep the check-in setup. */
export const seesCheckInSetup = (user: WithRoles): boolean => hasRole(user, 'hr', 'admin');

/** A Super Admin removes a location, as every deletion (owner's decision, 15 October 2026). */
export const removesLocations = (user: WithRoles): boolean => canDelete(user);

/** The page's sections, for links into it. */
export const LOCATIONS_ID = 'check-in-locations';
export const NETWORKS_ID = 'office-networks';
export const ZOHO_ID = 'zoho-addresses';
/** The approved home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from home"). */
export const HOMES_ID = 'home-locations';

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

/** The lock as it stands, in a sentence. */
export function lockText(state: Pick<NetworksState, 'lock' | 'inForce' | 'serverKey' | 'networks'>): string {
  if (state.inForce) return 'On: Office staff check in and out on the office network only, unless HR lets them check in from anywhere.';
  if (state.lock && !state.serverKey) return 'Switched on, but not in force: the server has no key, so no one is refused.';
  if (state.lock && !state.networks.length) return 'Switched on, but not in force: there is no office network.';
  return 'Off: everyone checks in from anywhere; a check-in on an office network still counts as at the office.';
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
