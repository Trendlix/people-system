import {
  defaultValidity,
  HOME_DECISIONS,
  HOME_RADIUS_DEFAULT,
  HOME_STAGES,
  HOME_TYPES,
  homeLabelOf,
  homeRadiusProblems,
  homeRequestProblems,
  homeStageName,
  isHomeType,
  isLocationValidity,
  isOpenHome,
  locationKindLabel,
  seesHomeLocations,
  validitiesFor,
  validityProblems,
  validityText,
  type HomeDecision,
  type HomeStage,
  type HomeType,
  type LocationValidity,
  type Role,
} from '@trendlix/shared';
import { MY_REQUESTS } from '../../../components/nav';
import { todayInCairo } from '../../../lib/date-picker';
import { formatDate, parseDate } from '../../../lib/format';
import type { HomeLocationStep, HomeLocationView, HomeOverlapView } from '../../../lib/home-location-types';
import { latin, pointOf, roundCoordinate, type MapCircle, type Point } from '../../../lib/map-point';

// Home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"; then "Label Home, flag elsewhere", "then approved by the HR and CEO", everyone may ask; packages/shared
// home-locations.ts). The employee asks from My Requests → Home location (or the phone pages' New Request): the point on
// a map, or their current location read on the device, with its accuracy; a label if they want; the radius shown as 100
// m, which HR sets. HR approves it (with another radius if it wants) or rejects it with a comment, then the CEO, on
// Approvals (and the phone's To Approve); a C-level person's both by the CEO. Approved, a check-in within it is Home. The
// employee withdraws theirs while it is being decided and removes their approved home at any time; HR removes one from
// Attendance → Check-in Setup → Home Locations. A home is personal data: only the employee, HR (not a C-level person's),
// the CEO and the Super Admin see it. The rules are @trendlix/shared's, which the API enforces; these helpers word what
// it sent and read the forms. Pure code, tested; relative imports, as vitest doesn't know the "@/" paths.
// Requested check-in locations (owner, 24 October 2026: "allow the employee to request adding this location to his
// profile, taking the approval cycle for sure, with a reason behind requesting to add this location (Home Location -
// Remote Site - Client Location) with a comment reason"; "allow the HR to add an end date or lik it to the contract
// date"; "location to be allowed only to the requested employee not all of them if home or remote, all employees if a
// customer location"): the same request with a type, a name, the radius asked, the reason and the end date wished; HR's
// step with how long it lasts, changed later for a home or a remote site; a client location, once approved, the company's
// on Check-in Setup for everyone; the overlaps HR and the CEO are warned of. A request from before them is a home.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const text = (fd: Pick<FormData, 'get'>, name: string) => String(fd.get(name) ?? '').trim();

// ---------- the addresses ----------

/** A request's page: the employee's, and HR's and the CEO's to decide it. */
export const HOME_LOCATIONS_PATH = '/home-locations';
export const homeLocationHref = (id: string) => `${HOME_LOCATIONS_PATH}/${encodeURIComponent(id)}`;

/** The employee's form, from My Requests. */
export const NEW_HOME_PATH = `${HOME_LOCATIONS_PATH}/new`;

/** What was just done on a request, said on its page by `?done=`; `validity`: HR changed how long it lasts (24 October 2026). */
export type HomeDone = 'sent' | 'withdrawn' | 'removed' | 'moved' | 'validity' | `${HomeStage}_${HomeDecision}`;
export const homeDoneHref = (id: string, done: HomeDone) => `${homeLocationHref(id)}?done=${done}`;

/** Their part of My Requests. */
export const MY_HOME_ID = 'my-home-location';
export const MY_HOMES_HREF = `${MY_REQUESTS}#${MY_HOME_ID}`;

/** Approvals' section, and where a decision taken there comes back to. */
export const APPROVALS_HOME_ID = 'home-locations';

// ---------- the API's ----------

export const MY_HOMES_API = '/me/home-locations';
export const HOME_COUNTS = '/home-locations/counts';
export const WAITING_HOMES = '/home-locations?status=waiting';
export const APPROVED_HOMES = '/home-locations?status=approved';
export const homeApi = (id: string) => `${HOME_LOCATIONS_PATH}/${encodeURIComponent(id)}`;
/** A person's approved home, for their profile. */
export const employeeHomeApi = (employeeId: string) => `/home-locations?employeeId=${encodeURIComponent(employeeId)}&status=approved`;
/** Every request of a person's (24 October 2026): their profile lists the places being decided and approved. */
export const employeePlacesApi = (employeeId: string) => `/home-locations?employeeId=${encodeURIComponent(employeeId)}`;
/** HR's list (Check-in Setup): the requests of a status (all unless given) and of a type (all unless given). */
export const homesApi = (q: { status?: string; type?: HomeType } = {}) => {
  const params = new URLSearchParams();
  if (q.status) params.set('status', q.status);
  if (q.type) params.set('type', q.type);
  const qs = params.toString();
  return `/home-locations${qs ? `?${qs}` : ''}`;
};

/** Where HR finds the client locations a request became (Check-in Setup's Check-in Locations). */
export const CLIENT_LOCATIONS_HREF = '/organization/check-in-setup#check-in-locations';

/** `?from=refusal` on the form: opened from a press refused for its location (the check-in panel's "Request this place"). */
export const fromRefusal = (query: Query) => one(query.from) === 'refusal';

// ---------- who ----------

/** HR, the CEO and the Super Admin see home locations (besides each person their own); never managers or Finance. */
export const seesHomes = (user: WithRoles): boolean => seesHomeLocations(user);

// ---------- the types (24 October 2026: "Home Location - Remote Site - Client Location") ----------

/** A request's type: a home for one from an API from before them. */
export const homeTypeOf = (r: Partial<Pick<HomeLocationView, 'type'>>): HomeType => (isHomeType(r.type) ? r.type : 'home');

/** Each type in a sentence's start or a line: "Home location", "Remote site", "Client location". */
export const HOME_TYPE_LINES: Record<HomeType, string> = { home: 'Home location', remote_site: 'Remote site', client: 'Client location' };

/** What the form says of each type. */
export const HOME_TYPE_HINTS: Record<HomeType, string> = {
  home: 'Where you live, for the days you work from home. Only for you.',
  remote_site: 'Somewhere you work from often, e.g. a studio or a shoot’s place. Only for you.',
  client: 'A client’s place staff work at. Once approved it counts for every employee, not only you.',
};

/** How a check-in within it shows on the attendance pages: "Home", "Remote site · Studio", "Client · Acme". */
export function homeShownAs(r: Partial<Pick<HomeLocationView, 'type' | 'label'>>): string {
  const type = homeTypeOf(r);
  if (type === 'home') return 'Home';
  return locationKindLabel(type, r.label ?? HOME_TYPE_LINES[type]);
}

/** "home location", "remote site", "client location", inside a sentence. */
const typeWords = (r: Partial<Pick<HomeLocationView, 'type'>>) => HOME_TYPE_LINES[homeTypeOf(r)].toLowerCase();

/** The types being decided now (one at a time of each). */
export const openTypes = (list: readonly HomeLocationView[]): HomeType[] => HOME_TYPES.filter((t) => list.some((r) => homeTypeOf(r) === t && isOpenHome(r.status)));

// ---------- words ----------

/** "100 m", "1,200 m". */
export const radiusText = (metres: number) => `${metres.toLocaleString('en-US')} m`;

/** The request is still being decided. */
export const isOpenHomeRequest = (r: Pick<HomeLocationView, 'status'>) => isOpenHome(r.status);

/** How long an approved one lasts, in words: "Until 31/12/2026", "Until the contract ends (30/06/2027)", "No end"; none before HR set it. */
export function homeValidityText(r: Pick<HomeLocationView, 'validity' | 'endsOn' | 'validUntil'>): string | null {
  if (!r.validity) return null;
  return validityText(r.validity, r.endsOn ?? r.validUntil ?? null, formatDate);
}

/** An approved place no longer counting: past its end, ended on Check-in Setup, or its employment over (24 October 2026). */
export const homeEnded = (r: Pick<HomeLocationView, 'status' | 'inForce'>) => r.status === 'approved' && r.inForce === false;

/** Where it stands, in a sentence, and the comment of a rejection. */
export function homeProgressText(
  r: Pick<HomeLocationView, 'status' | 'confidential' | 'radiusMetres' | 'approvedAt' | 'rejectedStage' | 'rejectReason'> &
    Partial<Pick<HomeLocationView, 'type' | 'label' | 'inForce' | 'endsOn' | 'location'>>,
): {
  text: string;
  reason?: string | null;
} {
  switch (r.status) {
    case 'with_hr':
      return { text: r.confidential ? 'With the CEO, who takes HR’s step and then decides it' : 'With HR, who decides it first; then the CEO' };
    case 'with_ceo':
      return { text: r.confidential ? 'Approved at HR’s step: with the CEO to decide it' : 'HR approved it: with the CEO now' };
    case 'approved': {
      const shown = homeShownAs(r);
      const everyone = homeTypeOf(r) === 'client' ? ', for every employee' : '';
      if (r.inForce === false) {
        if (homeTypeOf(r) === 'client' && r.location?.endedAt) return { text: `Ended on Check-in Setup: a check-in there no longer shows as ${shown}` };
        return { text: `Ended${r.endsOn ? ` ${formatDate(r.endsOn)}` : ' with the employment'}: a check-in there no longer shows as ${shown}` };
      }
      return { text: `Approved ${formatDate(r.approvedAt)}: a check-in within ${radiusText(r.radiusMetres)} of it shows as ${shown}${everyone}` };
    }
    case 'rejected':
      return { text: `Rejected by ${homeStageName(r.rejectedStage ?? 'hr', r.confidential)}`, reason: r.rejectReason };
    case 'withdrawn':
      return { text: 'Withdrawn while it was being decided: its point is deleted' };
    case 'replaced':
      return { text: 'Replaced by a newer home location: its point is deleted' };
    case 'removed':
      return { text: 'Removed: its point is deleted' };
    default:
      return { text: String(r.status) };
  }
}

/**
 * A request in a line of a list: "Home, Nasr City · 100 m", "Point on the map · 150 m"; "Point deleted" once it isn't
 * kept. A remote site or a client location with its type first: "Remote site: Studio · 100 m".
 */
export function homeWhatText(r: Pick<HomeLocationView, 'label' | 'latitude' | 'radiusMetres'> & Partial<Pick<HomeLocationView, 'type'>>): string {
  const type = homeTypeOf(r);
  const lead = type === 'home' ? '' : `${HOME_TYPE_LINES[type]}: `;
  if (r.latitude === null) return `${lead}Point deleted`;
  return `${lead}${r.label ?? 'Point on the map'} · ${radiusText(r.radiusMetres)}`;
}

/** The profile's line: "Home location: approved 20/10/2026 · 100 m". */
export const profileHomeText = (r: Pick<HomeLocationView, 'approvedAt' | 'radiusMetres'> & Partial<Pick<HomeLocationView, 'type'>>) =>
  `${HOME_TYPE_LINES[homeTypeOf(r)]}: approved ${formatDate(r.approvedAt)} · ${radiusText(r.radiusMetres)}`;

/** A place on the profile, where it stands: "Being decided", "In force", "Ended". */
export function placeStandingText(r: Pick<HomeLocationView, 'status' | 'inForce'>): 'Being decided' | 'In force' | 'Ended' | null {
  if (isOpenHome(r.status)) return 'Being decided';
  if (r.status !== 'approved') return null;
  return r.inForce === false ? 'Ended' : 'In force';
}

/** What the profile lists: the places being decided and approved (in force or ended), not those rejected, withdrawn, replaced or removed. */
export const profilePlaces = (list: readonly HomeLocationView[]) => list.filter((r) => placeStandingText(r) !== null);

const OVERLAP_KINDS: Record<HomeOverlapView['kind'], string> = {
  office: 'main office',
  sub_location: 'sub-location',
  client: 'client location',
  home: 'home location',
  remote_site: 'remote site',
};

/** An overlap as HR and the CEO are warned of it: "Overlaps Head office (main office) · 120 m apart". */
export function overlapText(o: HomeOverlapView): string {
  const name = o.label ?? (o.kind === 'home' ? 'their approved home' : o.kind === 'remote_site' ? 'one of their remote sites' : `a ${OVERLAP_KINDS[o.kind]}`);
  const kind = o.label ? ` (${OVERLAP_KINDS[o.kind]})` : '';
  return `Overlaps ${name}${kind}${o.distanceMetres === null ? '' : ` · ${radiusText(o.distanceMetres)} apart`}`;
}

/** Where the point came from: read on the device (within ±12 m), or put on the map. */
export const homeSourceText = (accuracyMetres: number | null) =>
  accuracyMetres === null ? 'Put on the map by the employee' : `Read on the employee’s device, within ±${accuracyMetres.toLocaleString('en-US')} m`;

/** A step as the timeline shows it. A C-level person's HR step is the CEO's: "Approved at HR’s step". */
export function homeStepText(s: Pick<HomeLocationStep, 'kind' | 'decision' | 'radiusMetres'>, confidential?: boolean | null): string {
  switch (s.kind) {
    case 'submitted':
      return `Asked for by the employee, ${radiusText(s.radiusMetres ?? HOME_RADIUS_DEFAULT)} to start with`;
    case 'hr_decision': {
      const who = confidential === true ? 'Approved at HR’s step' : 'HR approved it';
      if (s.decision === 'reject') return confidential === true ? 'Rejected at HR’s step' : 'HR rejected it';
      return s.radiusMetres ? `${who}, within ${radiusText(s.radiusMetres)}` : who;
    }
    case 'ceo_decision':
      return s.decision === 'reject' ? 'The CEO rejected it' : 'The CEO approved it: in force';
    case 'withdrawn':
      return 'Withdrawn by the employee: its point deleted';
    case 'replaced':
      return 'Replaced by a newer home location: its point deleted';
    case 'removed':
      return 'Removed: its point deleted';
    case 'validity_changed':
      return 'How long it lasts changed';
    default:
      return String(s.kind);
  }
}

/** Whether a step is a decision, and which way, for its mark on the timeline. */
export function homeStepTone(s: Pick<HomeLocationStep, 'kind' | 'decision'>): 'ok' | 'danger' | null {
  if (s.decision === 'reject') return 'danger';
  if (s.decision === 'approve') return 'ok';
  return null;
}

/** "Your Decision as HR", "Your Decision as the CEO". */
export const decidingAsTitle = (stage: HomeStage, confidential?: boolean | null) =>
  `Your Decision as ${stage === 'ceo' ? 'the CEO' : confidential === true ? 'the CEO, at HR’s Step' : 'HR'}`;

/** What a request's page says of what was just done on it (?done=). */
export function homeDoneText(query: Query, r: Pick<HomeLocationView, 'confidential'> & Partial<Pick<HomeLocationView, 'type' | 'label'>>): { text: string; tone: 'ok' | 'warn' } | null {
  const done = one(query.done);
  const shown = homeShownAs(r);
  if (done === 'sent') return { text: `Sent. ${r.confidential ? 'The CEO decides it' : 'HR decides it first, then the CEO'}; you can follow it here.`, tone: 'ok' };
  if (done === 'withdrawn') return { text: 'Withdrawn. Its point is deleted; ask again whenever you want.', tone: 'ok' };
  if (done === 'removed') return { text: `Removed. Its point is deleted, and check-ins no longer show as ${shown}.`, tone: 'ok' };
  if (done === 'moved') return { text: 'This request moved on meanwhile: here is where it stands now.', tone: 'warn' };
  if (done === 'validity') return { text: 'Saved: how long it lasts is changed.', tone: 'ok' };
  const [stage, decision] = done.split('_');
  if (!(HOME_STAGES as readonly string[]).includes(stage) || !(HOME_DECISIONS as readonly string[]).includes(decision)) return null;
  if (decision === 'reject') return { text: 'Rejected. The employee sees your comment, and its point is deleted.', tone: 'ok' };
  if (stage === 'hr') return { text: 'Approved at HR’s step: it is with the CEO now.', tone: 'ok' };
  if (homeTypeOf(r) === 'client') return { text: `Approved: it is a client location for every employee now, on Check-in Setup; check-ins within it show as ${shown}.`, tone: 'ok' };
  return { text: `Approved: check-ins within it now show as ${shown}.`, tone: 'ok' };
}

/** What Approvals says once a check-in location is decided there (?done=home-…). */
export const APPROVALS_HOME_DONE: Record<string, string> = {
  'home-hr-approve': 'Check-in location approved at HR’s step: it is with the CEO now.',
  'home-ceo-approve': 'Check-in location approved: check-ins within it now count there.',
  'home-hr-reject': 'Check-in location rejected. The employee sees your comment.',
  'home-ceo-reject': 'Check-in location rejected. The employee sees your comment.',
};

/** "1 check-in location request", "3 check-in location requests". */
export const homesLabel = (n: number) => `${n} check-in location ${n === 1 ? 'request' : 'requests'}`;

/** Their home in force, if any (a remote site or a client location isn't their home). */
export const approvedHomeOf = (list: readonly HomeLocationView[]) => list.find((r) => r.status === 'approved' && homeTypeOf(r) === 'home' && r.inForce !== false) ?? null;

/** Their approved places in force, of every type, the newest first as listed. */
export const placesInForce = (list: readonly HomeLocationView[]) => list.filter((r) => r.status === 'approved' && r.inForce !== false);

/**
 * Whether they may ask now: one being decided at a time of each type (24 October 2026). With a type, whether that type
 * may be asked; without, whether any type still may.
 */
export const asksHome = (list: readonly HomeLocationView[], type?: HomeType) => {
  const open = openTypes(list);
  return type ? !open.includes(type) : open.length < HOME_TYPES.length;
};

/**
 * What the form says to Office staff (owner's brief, 20 October 2026: "The office network lock is unchanged"): an Office
 * person locked to the office network is still refused off it at home, unless HR lets them check in from anywhere. Since
 * 24 October 2026 the GPS lock lets a check-in at an approved home through, and either lock passing is enough.
 */
export function officeLockHint(employment: { workArrangement: string; checkInAnywhere?: boolean } | null | undefined): string | null {
  if (employment?.workArrangement !== 'office' || employment.checkInAnywhere) return null;
  return 'You work at the office: while check-ins are locked to the office network alone, a check-in from home is still refused off it, unless HR lets you check in from anywhere. With check-ins locked to the check-in locations, an approved home lets your check-ins from there through. An approved home shows your check-ins from there as Home.';
}

// ---------- the map ----------

/** A request's point, while it is kept. */
export const homePoint = (r: Pick<HomeLocationView, 'latitude' | 'longitude'>): Point | null => pointOf(r.latitude, r.longitude);

/** A request's point and radius as a map draws them (another radius while HR types one); none once its point is deleted. */
export function homeCircle(r: Pick<HomeLocationView, 'latitude' | 'longitude' | 'radiusMetres'>, radiusMetres = r.radiusMetres): MapCircle | null {
  const p = homePoint(r);
  return p ? { ...p, radiusMetres } : null;
}

/** "the home location of Walid Ali", as a map's name says it; a client location by its name. */
export const homeMapLabel = (r: Pick<HomeLocationView, 'employee' | 'radiusMetres'> & Partial<Pick<HomeLocationView, 'type' | 'label'>>, own = false) =>
  homeTypeOf(r) === 'client'
    ? `Map of the client location ${r.label ?? ''} and the ${radiusText(r.radiusMetres)} around it`.replace('  ', ' ')
    : `Map of ${own ? 'your' : `${r.employee.fullNameEn}’s`} ${typeWords(r)} and the ${radiusText(r.radiusMetres)} around it`;

// ---------- the forms ----------

/** POST /me/home-locations. */
export interface HomeAskBody {
  type: HomeType;
  latitude: number;
  longitude: number;
  accuracy?: number;
  label?: string;
  reason: string;
  radiusMetres?: number;
  wishedEndDate?: string;
}

const numberOf = (raw: string): number | null => {
  const s = latin(raw).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
};

/**
 * The employee's form (24 October 2026: "(Home Location - Remote Site - Client Location) with a comment reason"): the
 * type (a home unless chosen), the point (to 6 decimals), the reading's accuracy when read on the device, the name (a
 * remote site's or a client location's required; a home's label optional), the radius (25 to 500 m; 100 m when left
 * empty), the reason (required) and, for a remote site or a client location, the end date wished (DD/MM/YYYY typed).
 * What is wrong is the shared checks' (homeRequestProblems), the API's own.
 */
export function homeAskBody(fd: Pick<FormData, 'get'>, today = todayInCairo()): { body: HomeAskBody | null; errors: string[] } {
  const typeText = text(fd, 'type');
  const type: HomeType = isHomeType(typeText) ? typeText : 'home';
  const latitude = numberOf(text(fd, 'latitude'));
  const longitude = numberOf(text(fd, 'longitude'));
  const label = homeLabelOf(text(fd, 'label'));
  const reason = homeLabelOf(String(fd.get('reason') ?? ''));
  const radiusTyped = latin(text(fd, 'radiusMetres'));
  const radiusMetres = radiusTyped === '' ? null : /^\d+$/.test(radiusTyped) ? Number(radiusTyped) : Number.NaN;
  const wishedTyped = type === 'home' ? '' : text(fd, 'wishedEndDate');
  const wished = wishedTyped ? parseDate(wishedTyped) : '';
  const errors = homeRequestProblems({
    latitude: Number.isNaN(latitude) ? null : latitude,
    longitude: Number.isNaN(longitude) ? null : longitude,
    label,
    type,
    reason,
    radiusMetres,
    wishedEndDate: wished || null,
    today,
  });
  if (wished === null) errors.push('Enter the end date you wish as DD/MM/YYYY, e.g. 31/12/2026.');
  if (errors.length || latitude === null || longitude === null || !reason) return { body: null, errors: errors.length ? errors : ['Put the place on the map.'] };
  const body: HomeAskBody = { type, latitude: roundCoordinate(latitude), longitude: roundCoordinate(longitude), reason };
  const accuracy = numberOf(text(fd, 'accuracy'));
  if (accuracy !== null && !Number.isNaN(accuracy) && accuracy >= 0) body.accuracy = Math.round(accuracy);
  if (label) body.label = label;
  if (radiusMetres !== null) body.radiusMetres = radiusMetres;
  if (wished) body.wishedEndDate = wished;
  return { body, errors: [] };
}

/** POST /home-locations/:id/decide. */
export interface HomeDecisionBody {
  decision: HomeDecision;
  comment?: string;
  radiusMetres?: number;
  validity?: LocationValidity;
  validUntil?: string;
}

/**
 * How long it lasts as HR's form sends it (24 October 2026): one of the type's choices, and for "until a date" the date
 * typed (DD/MM/YYYY), today or later. Nothing chosen (a form from before): none, and the API takes the type's default.
 */
function validityOf(fd: Pick<FormData, 'get'>, type: HomeType, today: string): { validity?: LocationValidity; validUntil?: string; errors: string[] } {
  const chosen = text(fd, 'validity');
  if (!chosen) return { errors: [] };
  if (!isLocationValidity(chosen)) return { errors: validityProblems(type, chosen, null, today) };
  const typed = chosen === 'until_date' ? text(fd, 'validUntil') : '';
  const until = typed ? parseDate(typed) : '';
  if (chosen === 'until_date' && until === null) return { errors: ['Enter the date it lasts until as DD/MM/YYYY, e.g. 31/12/2026.'] };
  const errors = validityProblems(type, chosen, until || null, today);
  if (errors.length) return { errors };
  return chosen === 'until_date' ? { validity: chosen, validUntil: until!, errors: [] } : { validity: chosen, errors: [] };
}

/** What HR's step starts with: the type's default, with the date the employee wished (shown DD/MM/YYYY). */
export function startingValidity(r: Pick<HomeLocationView, 'type' | 'wishedEndDate'>): { validity: LocationValidity; validUntil: string } {
  const type = homeTypeOf(r);
  const validity = defaultValidity(type, r.wishedEndDate ?? null);
  return { validity, validUntil: validity === 'until_date' && r.wishedEndDate ? formatDate(r.wishedEndDate) : '' };
}

/** HR's choices of how long it lasts for a type, in order: "Until a date", "Until the contract ends" or "No end". */
export const validityChoices = (r: Pick<HomeLocationView, 'type'>): readonly LocationValidity[] => validitiesFor(homeTypeOf(r));

/** POST /home-locations/:id/validity: how long an approved home or remote site lasts, changed by HR, with a comment if any. */
export function homeValidityBody(fd: Pick<FormData, 'get'>, type: HomeType, today = todayInCairo()): { body: { validity: LocationValidity; validUntil?: string; comment?: string } | null; errors: string[] } {
  const v = validityOf(fd, type, today);
  if (v.errors.length) return { body: null, errors: v.errors };
  if (!v.validity) return { body: null, errors: ['Choose how long it lasts: until a date or until the contract ends.'] };
  const comment = text(fd, 'comment');
  return { body: { validity: v.validity, ...(v.validUntil && { validUntil: v.validUntil }), ...(comment && { comment }) }, errors: [] };
}

/**
 * A stage's decision: approve or reject (a comment to reject); at HR's step, approving, the radius in whole metres and
 * (24 October 2026) how long it lasts for the request's `type`.
 */
export function homeDecisionBody(fd: Pick<FormData, 'get'>, stage: HomeStage, type: HomeType = 'home', today = todayInCairo()): { body: HomeDecisionBody | null; errors: string[] } {
  const decision = text(fd, 'decision');
  if (!(HOME_DECISIONS as readonly string[]).includes(decision)) return { body: null, errors: ['Choose your decision: approve or reject.'] };
  const body: HomeDecisionBody = { decision: decision as HomeDecision };
  const comment = text(fd, 'comment');
  if (comment) body.comment = comment;
  else if (body.decision === 'reject') return { body: null, errors: ['Write your comment: why the home location is rejected.'] };
  if (stage === 'hr' && body.decision === 'approve') {
    const typed = latin(text(fd, 'radiusMetres'));
    const radius = /^\d+$/.test(typed) ? Number(typed) : Number.NaN;
    const problems = homeRadiusProblems(radius);
    if (problems.length) return { body: null, errors: problems };
    body.radiusMetres = radius;
    const v = validityOf(fd, type, today);
    if (v.errors.length) return { body: null, errors: v.errors };
    if (v.validity) body.validity = v.validity;
    if (v.validUntil) body.validUntil = v.validUntil;
  }
  return { body, errors: [] };
}

/** HR's removal: why, if they say. */
export function homeRemoveBody(fd: Pick<FormData, 'get'> | null | undefined): { comment?: string } {
  const comment = fd ? text(fd, 'comment') : '';
  return comment ? { comment } : {};
}

/** The decision button: where an approval sends it. */
export function homeDecisionButton(decision: HomeDecision | '', stage: HomeStage, confidential?: boolean | null, type: HomeType = 'home'): { label: string; busy: string } {
  const what = HOME_TYPE_LINES[type].toLowerCase();
  if (decision === 'reject') return { label: `Reject the ${what}`, busy: 'Rejecting…' };
  if (decision === '') return { label: 'Save the decision', busy: 'Saving…' };
  if (stage === 'hr') return { label: confidential === true ? 'Approve HR’s step' : 'Approve and send to the CEO', busy: 'Approving…' };
  return { label: `Approve the ${what}`, busy: 'Approving…' };
}
