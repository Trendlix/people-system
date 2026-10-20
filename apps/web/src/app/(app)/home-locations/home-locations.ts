import {
  HOME_DECISIONS,
  HOME_RADIUS_DEFAULT,
  HOME_STAGES,
  homeLabelOf,
  homeRadiusProblems,
  homeRequestProblems,
  homeStageName,
  isOpenHome,
  seesHomeLocations,
  type HomeDecision,
  type HomeStage,
  type Role,
} from '@trendlix/shared';
import { MY_REQUESTS } from '../../../components/nav';
import { formatDate } from '../../../lib/format';
import type { HomeLocationStep, HomeLocationView } from '../../../lib/home-location-types';
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

/** What was just done on a request, said on its page by `?done=`. */
export type HomeDone = 'sent' | 'withdrawn' | 'removed' | 'moved' | `${HomeStage}_${HomeDecision}`;
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

// ---------- who ----------

/** HR, the CEO and the Super Admin see home locations (besides each person their own); never managers or Finance. */
export const seesHomes = (user: WithRoles): boolean => seesHomeLocations(user);

// ---------- words ----------

/** "100 m", "1,200 m". */
export const radiusText = (metres: number) => `${metres.toLocaleString('en-US')} m`;

/** The request is still being decided. */
export const isOpenHomeRequest = (r: Pick<HomeLocationView, 'status'>) => isOpenHome(r.status);

/** Where it stands, in a sentence, and the comment of a rejection. */
export function homeProgressText(r: Pick<HomeLocationView, 'status' | 'confidential' | 'radiusMetres' | 'approvedAt' | 'rejectedStage' | 'rejectReason'>): {
  text: string;
  reason?: string | null;
} {
  switch (r.status) {
    case 'with_hr':
      return { text: r.confidential ? 'With the CEO, who takes HR’s step and then decides it' : 'With HR, who decides it first; then the CEO' };
    case 'with_ceo':
      return { text: r.confidential ? 'Approved at HR’s step: with the CEO to decide it' : 'HR approved it: with the CEO now' };
    case 'approved':
      return { text: `Approved ${formatDate(r.approvedAt)}: a check-in within ${radiusText(r.radiusMetres)} of it shows as Home` };
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

/** A request in a line of a list: "Home, Nasr City · 100 m", "Point on the map · 150 m"; "Point deleted" once it isn't kept. */
export function homeWhatText(r: Pick<HomeLocationView, 'label' | 'latitude' | 'radiusMetres'>): string {
  if (r.latitude === null) return 'Point deleted';
  return `${r.label ?? 'Point on the map'} · ${radiusText(r.radiusMetres)}`;
}

/** The profile's line: "Home location: approved 20/10/2026 · 100 m". */
export const profileHomeText = (r: Pick<HomeLocationView, 'approvedAt' | 'radiusMetres'>) => `Home location: approved ${formatDate(r.approvedAt)} · ${radiusText(r.radiusMetres)}`;

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
export function homeDoneText(query: Query, r: Pick<HomeLocationView, 'confidential'>): { text: string; tone: 'ok' | 'warn' } | null {
  const done = one(query.done);
  if (done === 'sent') return { text: `Sent. ${r.confidential ? 'The CEO decides it' : 'HR decides it first, then the CEO'}; you can follow it here.`, tone: 'ok' };
  if (done === 'withdrawn') return { text: 'Withdrawn. Its point is deleted; ask again whenever you want.', tone: 'ok' };
  if (done === 'removed') return { text: 'Removed. Its point is deleted, and check-ins no longer show as Home.', tone: 'ok' };
  if (done === 'moved') return { text: 'This request moved on meanwhile: here is where it stands now.', tone: 'warn' };
  const [stage, decision] = done.split('_');
  if (!(HOME_STAGES as readonly string[]).includes(stage) || !(HOME_DECISIONS as readonly string[]).includes(decision)) return null;
  if (decision === 'reject') return { text: 'Rejected. The employee sees your comment, and its point is deleted.', tone: 'ok' };
  return { text: stage === 'hr' ? 'Approved at HR’s step: it is with the CEO now.' : 'Approved: check-ins within it now show as Home.', tone: 'ok' };
}

/** What Approvals says once a home location is decided there (?done=home-…). */
export const APPROVALS_HOME_DONE: Record<string, string> = {
  'home-hr-approve': 'Home location approved at HR’s step: it is with the CEO now.',
  'home-ceo-approve': 'Home location approved: check-ins within it now show as Home.',
  'home-hr-reject': 'Home location rejected. The employee sees your comment.',
  'home-ceo-reject': 'Home location rejected. The employee sees your comment.',
};

/** "1 home location request", "3 home location requests". */
export const homesLabel = (n: number) => `${n} home location ${n === 1 ? 'request' : 'requests'}`;

/** Their home in force, if any. */
export const approvedHomeOf = (list: readonly HomeLocationView[]) => list.find((r) => r.status === 'approved') ?? null;

/** Whether they may ask now: nothing of theirs is being decided (one at a time). */
export const asksHome = (list: readonly HomeLocationView[]) => !list.some(isOpenHomeRequest);

/**
 * What the form says to Office staff (owner's brief, 20 October 2026: "The office network lock is unchanged"): an Office
 * person locked to the office network is still refused off it at home, unless HR lets them check in from anywhere.
 */
export function officeLockHint(employment: { workArrangement: string; checkInAnywhere?: boolean } | null | undefined): string | null {
  if (employment?.workArrangement !== 'office' || employment.checkInAnywhere) return null;
  return 'You work at the office: while check-ins are locked to the office network, a check-in from home is still refused off it, unless HR lets you check in from anywhere. An approved home shows your check-ins from there as Home.';
}

// ---------- the map ----------

/** A request's point, while it is kept. */
export const homePoint = (r: Pick<HomeLocationView, 'latitude' | 'longitude'>): Point | null => pointOf(r.latitude, r.longitude);

/** A request's point and radius as a map draws them (another radius while HR types one); none once its point is deleted. */
export function homeCircle(r: Pick<HomeLocationView, 'latitude' | 'longitude' | 'radiusMetres'>, radiusMetres = r.radiusMetres): MapCircle | null {
  const p = homePoint(r);
  return p ? { ...p, radiusMetres } : null;
}

/** "the home location of Walid Ali", as a map's name says it. */
export const homeMapLabel = (r: Pick<HomeLocationView, 'employee' | 'radiusMetres'>, own = false) =>
  `Map of ${own ? 'your' : `${r.employee.fullNameEn}’s`} home location and the ${radiusText(r.radiusMetres)} around it`;

// ---------- the forms ----------

/** POST /me/home-locations. */
export interface HomeAskBody {
  latitude: number;
  longitude: number;
  accuracy?: number;
  label?: string;
}

const numberOf = (raw: string): number | null => {
  const s = latin(raw).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
};

/** The employee's form: the point (to 6 decimals), the reading's accuracy when read on the device, and the label. */
export function homeAskBody(fd: Pick<FormData, 'get'>): { body: HomeAskBody | null; errors: string[] } {
  const latitude = numberOf(text(fd, 'latitude'));
  const longitude = numberOf(text(fd, 'longitude'));
  const label = homeLabelOf(text(fd, 'label'));
  const errors = homeRequestProblems({ latitude: Number.isNaN(latitude) ? null : latitude, longitude: Number.isNaN(longitude) ? null : longitude, label });
  if (errors.length || latitude === null || longitude === null) return { body: null, errors: errors.length ? errors : ['Put your home on the map.'] };
  const body: HomeAskBody = { latitude: roundCoordinate(latitude), longitude: roundCoordinate(longitude) };
  const accuracy = numberOf(text(fd, 'accuracy'));
  if (accuracy !== null && !Number.isNaN(accuracy) && accuracy >= 0) body.accuracy = Math.round(accuracy);
  if (label) body.label = label;
  return { body, errors: [] };
}

/** POST /home-locations/:id/decide. */
export interface HomeDecisionBody {
  decision: HomeDecision;
  comment?: string;
  radiusMetres?: number;
}

/** A stage's decision: approve or reject (a comment to reject); at HR's step, approving, the radius in whole metres. */
export function homeDecisionBody(fd: Pick<FormData, 'get'>, stage: HomeStage): { body: HomeDecisionBody | null; errors: string[] } {
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
  }
  return { body, errors: [] };
}

/** HR's removal: why, if they say. */
export function homeRemoveBody(fd: Pick<FormData, 'get'> | null | undefined): { comment?: string } {
  const comment = fd ? text(fd, 'comment') : '';
  return comment ? { comment } : {};
}

/** The decision button: where an approval sends it. */
export function homeDecisionButton(decision: HomeDecision | '', stage: HomeStage, confidential?: boolean | null): { label: string; busy: string } {
  if (decision === 'reject') return { label: 'Reject the home location', busy: 'Rejecting…' };
  if (decision === '') return { label: 'Save the decision', busy: 'Saving…' };
  if (stage === 'hr') return { label: confidential === true ? 'Approve HR’s step' : 'Approve and send to the CEO', busy: 'Approving…' };
  return { label: 'Approve the home location', busy: 'Approving…' };
}
