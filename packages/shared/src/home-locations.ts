// Home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"). Asked, the owner chose:
// - Effect, "Label Home, flag elsewhere": a check-in within a person's approved home's radius is Home (check-in.ts
//   checkInPlace; remote for every other rule), and for someone with an approved home a remote check-in anywhere else,
//   outside every office location and their home, is flagged "Not at home or the office". Nothing is refused for it.
// - Approval, first "HR", then "then approved by the HR and CEO": HR approves (and may change the radius) or rejects with
//   a comment, then the CEO approves or rejects with a comment. A C-level person's (G9; confidential.ts) has both steps
//   taken by the CEO, as raise requests do.
// - Who asks: everyone with an employee profile, for occasional days at home too.
// One approved home a person (a newly approved one replaces the old, 'replaced'), one request being decided at a time.
// A home is personal data, the employee's own request their consent: seen by the employee, HR (not a C-level person's),
// the CEO and the Super Admin, never managers, Finance or the directory. Only the home's point is kept (and a label if
// they give one), only while it is being decided or in force: rejected, withdrawn, replaced or removed, the point and the
// label are deleted, the request's steps kept without them. The employee removes their approved home at any time, and HR
// (the CEO, the Super Admin) too. A check-in never keeps the home's point: it keeps its place, and since 20 October 2026
// the spot where it was pressed (punch-location.ts); the audit log never holds a point. Pure: the API decides with these
// and the web shows the same words.
//
// Requested check-in locations (owner, 24 October 2026, once the GPS lock refuses a press: "allow the employee to request
// adding this location to his profile, taking the approval cycle for sure, with a reason behind requesting to add this
// location (Home Location - Remote Site - Client Location) with a comment reason"). Asked, the owner chose "HR → CEO for
// all three", and of how long one lasts: "allow the HR to add an end date or lik it to the contract date. if renewed renew
// the due date of the checkin location"; then "location to be allowed only to the requested employee not all of them if
// home or remote, all employees if a customer location". So the home location request is one request of three types:
// - Home Location (the home of before: one approved a person, a newer one replacing it) and Remote Site (several), each
//   only the asker's; Client Location, once the CEO approves it, a company check-in location of type Client on Check-in
//   Setup, for everyone, which HR edits or ends there.
// - Each asked with a name (a home's is optional, as its label was), the point, a radius (100 m to start with, 25 to 500
//   m), a reason (required, up to 1,000 characters) and, for a remote site or a client location, the end date wished.
// - Its validity, set by HR at its step and changed later by HR: until a date, or until the contract ends (a home or a
//   remote site: the end of the current employment's signed contract, read each time, so a renewal moves it), or (a
//   client location) no end. Home locations approved before keep no end, so they go on working as they did.
// - After its end it no longer counts; 7 days before an end that is a date, the employee and HR are told.
// - An overlap with another check-in place is shown to HR and the CEO as a warning; nothing is blocked.

import { decidesConfidentialStage, seesConfidential } from './confidential.js';
import { distanceMetres, OFFICE_RADIUS_MAX, OFFICE_RADIUS_MIN } from './check-in.js';
import type { Role } from './index.js';

type Roles = { roles: readonly Role[] };

/** The radius a home starts with (owner's brief, 20 October 2026: "default 100 m"), which HR may change within the office's limits. */
export const HOME_RADIUS_DEFAULT = 100;
export const HOME_RADIUS_MIN = OFFICE_RADIUS_MIN;
export const HOME_RADIUS_MAX = OFFICE_RADIUS_MAX;

/** The longest label or address a home takes, and the longest comment on a decision. */
export const HOME_LABEL_MAX = 200;
export const HOME_COMMENT_MAX = 1000;

// ---------- the three types (owner, 24 October 2026: "Home Location - Remote Site - Client Location") ----------

export const HOME_TYPES = ['home', 'remote_site', 'client'] as const;
export type HomeType = (typeof HOME_TYPES)[number];
export const isHomeType = (v: unknown): v is HomeType => (HOME_TYPES as readonly unknown[]).includes(v);

export const HOME_TYPE_LABELS: Record<HomeType, string> = { home: 'Home Location', remote_site: 'Remote Site', client: 'Client Location' };

/** Inside a sentence: "home location", "remote site", "client location". */
export const homeTypeWords = (type: HomeType): string => HOME_TYPE_LABELS[type].toLowerCase();

/** A client location counts for everyone once approved; a home or a remote site only for the person who asked (owner, 24 October 2026). */
export const countsForEveryone = (type: HomeType): boolean => type === 'client';

/** What the request page and the approval say of a client location before it is approved. */
export const CLIENT_FOR_EVERYONE_TEXT = 'Approving makes this place count for everyone.';

/** The radius a request is asked with (owner's brief, 24 October 2026: "default 100 m, 25–500 m"); HR may set another within 20 to 5,000 m. */
export const LOCATION_ASK_RADIUS_MIN = 25;
export const LOCATION_ASK_RADIUS_MAX = 500;

/** The longest reason a request takes. */
export const LOCATION_REASON_MAX = 1000;

/** Why a request is asked, required since 24 October 2026 (those of before have none). */
export const LOCATION_REASON_NEEDED = 'Write the reason: why you need this place to check in from.';

// ---------- how long an approved one lasts ----------

/** Until a date; until the contract ends (a home or a remote site); no end (a client location, and the homes approved before 24 October 2026). */
export const LOCATION_VALIDITIES = ['until_date', 'contract', 'no_end'] as const;
export type LocationValidity = (typeof LOCATION_VALIDITIES)[number];
export const isLocationValidity = (v: unknown): v is LocationValidity => (LOCATION_VALIDITIES as readonly unknown[]).includes(v);

export const LOCATION_VALIDITY_LABELS: Record<LocationValidity, string> = { until_date: 'Until a date', contract: 'Until the contract ends', no_end: 'No end' };

/** What HR chooses from for each type: a date or the contract for a home or a remote site; a date or no end for a client location. */
export const validitiesFor = (type: HomeType): readonly LocationValidity[] => (type === 'client' ? ['until_date', 'no_end'] : ['until_date', 'contract']);

/**
 * What HR's step starts with: a home until the contract ends; a remote site until the date the employee wished, else the
 * contract's end; a client location until the date wished, else no end.
 */
export function defaultValidity(type: HomeType, wishedEndDate: string | null | undefined): LocationValidity {
  if (type === 'home') return 'contract';
  if (wishedEndDate) return 'until_date';
  return type === 'client' ? 'no_end' : 'contract';
}

/** The days before an end (a date) that the employee and HR are told. */
export const LOCATION_ENDING_NOTICE_DAYS = 7;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (d: string) => DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** Why a validity can't be set (none: it can): one of the type's, a real date for "until a date", today or later. */
export function validityProblems(type: HomeType, validity: unknown, validUntil: string | null | undefined, today: string): string[] {
  if (!isLocationValidity(validity) || !validitiesFor(type).includes(validity)) {
    return [`Choose how long it lasts: ${validitiesFor(type).map((v) => LOCATION_VALIDITY_LABELS[v].toLowerCase()).join(' or ')}.`];
  }
  if (validity !== 'until_date') return [];
  if (!validUntil || !realDate(validUntil)) return ['Enter the date it lasts until, e.g. 2026-12-31.'];
  if (validUntil < today) return ['Choose an end date of today or later.'];
  return [];
}

/** The person's contract as a place's validity reads it: whether they have a current employment, and its signed contract's end. */
export interface LocationContract {
  employed: boolean;
  /** signedContractEnd: the latest end of the current employment's signed versions; null: open-ended, or none signed yet. */
  end: string | null;
}

/**
 * Where an approved place stands on `today` (YYYY-MM-DD): its last day (null: no end known) and whether it counts. Until a
 * date: that date. Until the contract ends: the current employment's signed contract's end, read each time, so a renewal
 * or an amendment extending it moves it (owner, 24 October 2026: "if renewed renew the due date"); with no current
 * employment it has ended ("When the employment ends, the location ends"); with none signed yet, or an open-ended one, no
 * end. No end (a client location; a home approved before validity was kept): none. Only an approved one counts.
 */
export function locationStanding(
  v: { status: string; validity: string | null; validUntil: string | null },
  contract: LocationContract | null,
  today: string,
): { end: string | null; inForce: boolean } {
  const end = v.validity === 'until_date' ? v.validUntil : v.validity === 'contract' ? (contract?.end ?? null) : null;
  const employed = v.validity !== 'contract' || contract?.employed !== false;
  return { end, inForce: v.status === 'approved' && employed && (end === null || end >= today) };
}

/**
 * The end of the current employment's signed contract (owner, 24 October 2026: "if renewed renew the due date"): the latest
 * end of its signed versions (active, superseded, ended: a renewal or an amendment extending it moves it); none (null)
 * when one of them is open-ended, or none is signed.
 */
export function signedContractEnd(versions: readonly { status: string; endDate: string | null }[]): string | null {
  const signed = versions.filter((c) => c.status === 'active' || c.status === 'superseded' || c.status === 'ended');
  if (!signed.length || signed.some((c) => c.endDate === null)) return null;
  return signed.map((c) => c.endDate!).sort().at(-1)!;
}

/** Its validity in words: "Until 31/12/2026", "Until the contract ends (31/12/2026)", "No end". `show`: how a date is shown. */
export function validityText(validity: string | null, end: string | null, show: (ymd: string) => string = (d) => d): string {
  if (validity === 'until_date' && end) return `Until ${show(end)}`;
  if (validity === 'contract') return end ? `Until the contract ends (${show(end)})` : 'Until the contract ends';
  return 'No end';
}

// ---------- overlaps (owner, 24 October 2026: a warning, never a block) ----------

/** A place a request may overlap: its name and kind, its point and radius. */
export interface OverlapCandidate {
  label: string | null;
  kind: 'office' | 'sub_location' | 'client' | HomeType;
  latitude: number;
  longitude: number;
  radiusMetres: number;
}

/** The places a request's circle overlaps (their circles meet), nearest first, with the distance between the points. */
export function overlapsOf(c: { latitude: number; longitude: number; radiusMetres: number }, others: readonly OverlapCandidate[]): (Omit<OverlapCandidate, 'latitude' | 'longitude'> & { distanceMetres: number })[] {
  return others
    .map((o) => ({ o, d: distanceMetres(c, o) }))
    .filter(({ o, d }) => d < c.radiusMetres + o.radiusMetres)
    .sort((a, b) => a.d - b.d)
    .map(({ o, d }) => ({ label: o.label, kind: o.kind, radiusMetres: o.radiusMetres, distanceMetres: Math.round(d) }));
}

// ---------- where a request stands ----------

/** With HR, with the CEO, approved (the home in force), rejected, withdrawn by the employee, replaced by a newer one, removed. */
export const HOME_STATUSES = ['with_hr', 'with_ceo', 'approved', 'rejected', 'withdrawn', 'replaced', 'removed'] as const;
export type HomeStatus = (typeof HOME_STATUSES)[number];

export const HOME_STATUS_LABELS: Record<HomeStatus, string> = {
  with_hr: 'With HR',
  with_ceo: 'With the CEO',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  replaced: 'Replaced',
  removed: 'Removed',
};

export const isHomeStatus = (v: unknown): v is HomeStatus => (HOME_STATUSES as readonly unknown[]).includes(v);

/** Being decided: with HR or with the CEO. One at a time a person. */
export const OPEN_HOME_STATUSES: readonly HomeStatus[] = ['with_hr', 'with_ceo'];
export const isOpenHome = (status: string): boolean => (OPEN_HOME_STATUSES as readonly string[]).includes(status);

/** Whether a request keeps its point and label: while it is being decided, and once approved (the home in force). */
export const keepsHomePoint = (status: string): boolean => isOpenHome(status) || status === 'approved';

/** A request's status as its badge says it: a C-level person's with HR is with the CEO, who takes HR's step. */
export const homeStatusLabel = (status: HomeStatus, confidential?: boolean | null): string =>
  confidential === true && status === 'with_hr' ? 'With the CEO' : (HOME_STATUS_LABELS[status] ?? status);

/** The two steps: HR's, then the CEO's. */
export const HOME_STAGES = ['hr', 'ceo'] as const;
export type HomeStage = (typeof HOME_STAGES)[number];

/** The stage a request is at; none once decided. */
export const homeStage = (status: string): HomeStage | null => (status === 'with_hr' ? 'hr' : status === 'with_ceo' ? 'ceo' : null);

/** Where an approval at a stage sends it: HR's to the CEO, the CEO's approves it. */
export const homeStatusAfterApproval = (stage: HomeStage): HomeStatus => (stage === 'hr' ? 'with_ceo' : 'approved');

export const HOME_DECISIONS = ['approve', 'reject'] as const;
export type HomeDecision = (typeof HOME_DECISIONS)[number];

/**
 * A step of a request, logged on it in the order taken: sent, HR's and the CEO's decisions, withdrawn, replaced, removed;
 * and (24 October 2026) its validity changed by HR once approved.
 */
export const HOME_STEP_KINDS = ['submitted', 'hr_decision', 'ceo_decision', 'withdrawn', 'replaced', 'removed', 'validity_changed'] as const;
export type HomeStepKind = (typeof HOME_STEP_KINDS)[number];

/** The step a stage's decision is logged as. */
export const homeDecisionStepKind = (stage: HomeStage): HomeStepKind => (stage === 'hr' ? 'hr_decision' : 'ceo_decision');

// ---------- what is asked ----------

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** A label as kept: spaces tidied, none for nothing typed. */
export function homeLabelOf(text: string | null | undefined): string | null {
  const s = (text ?? '').trim().replace(/\s+/g, ' ');
  return s ? s : null;
}

/** Why a home's radius can't be used (none: it can): whole metres from 20 to 5,000, as an office location's. */
export function homeRadiusProblems(radiusMetres: number): string[] {
  if (Number.isInteger(radiusMetres) && radiusMetres >= HOME_RADIUS_MIN && radiusMetres <= HOME_RADIUS_MAX) return [];
  return [`Enter the radius in whole metres from ${HOME_RADIUS_MIN} to ${HOME_RADIUS_MAX.toLocaleString('en-US')}, e.g. ${HOME_RADIUS_DEFAULT}.`];
}

/**
 * Why a home can't be asked for (none: it can): its point (latitude −90 to 90, longitude −180 to 180, both), and a
 * label or address of up to 200 characters if given. Since 24 October 2026, with `type` (the three types): a remote
 * site's or a client location's name (required), the reason (required), the radius (25 to 500 m, when sent) and the end
 * date wished (a remote site or a client location, today or later, when given).
 */
export function homeRequestProblems(r: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  label?: string | null;
  type?: HomeType;
  reason?: string | null;
  radiusMetres?: number | null;
  wishedEndDate?: string | null;
  today?: string;
}): string[] {
  const problems: string[] = [];
  const { latitude: lat, longitude: lng } = r;
  const what = r.type && r.type !== 'home' ? 'the place' : 'your home';
  if (!isNumber(lat) || !isNumber(lng)) problems.push(r.type && r.type !== 'home' ? 'Put the place on the map, or use your current location while there.' : 'Put your home on the map, or use your current location while at home.');
  else if (Math.abs(lat) > 90 || Math.abs(lng) > 180) problems.push(`That point isn’t on the map: put ${what} on the map again.`);
  const label = homeLabelOf(r.label);
  if (label && label.length > HOME_LABEL_MAX) problems.push(`Keep the ${r.type && r.type !== 'home' ? 'name' : 'label'} to ${HOME_LABEL_MAX} characters or fewer.`);
  if (!r.type) return problems;
  if (r.type !== 'home' && !label) problems.push(r.type === 'client' ? 'Name the place: the client’s name, e.g. Acme Cairo office.' : 'Name the place, e.g. Studio in Zamalek.');
  const reason = homeLabelOf(r.reason);
  if (!reason) problems.push(LOCATION_REASON_NEEDED);
  else if (reason.length > LOCATION_REASON_MAX) problems.push(`Keep the reason to ${LOCATION_REASON_MAX.toLocaleString('en-US')} characters or fewer.`);
  if (r.radiusMetres !== undefined && r.radiusMetres !== null) {
    if (!Number.isInteger(r.radiusMetres) || r.radiusMetres < LOCATION_ASK_RADIUS_MIN || r.radiusMetres > LOCATION_ASK_RADIUS_MAX) {
      problems.push(`Enter the radius in whole metres from ${LOCATION_ASK_RADIUS_MIN} to ${LOCATION_ASK_RADIUS_MAX}, e.g. ${HOME_RADIUS_DEFAULT}.`);
    }
  }
  if (r.wishedEndDate) {
    if (r.type === 'home') problems.push('A home location has no end date to wish: HR links it to your contract.');
    else if (!realDate(r.wishedEndDate)) problems.push('Enter the end date you wish as a date, e.g. 2026-12-31.');
    else if (r.today && r.wishedEndDate < r.today) problems.push('Choose an end date of today or later.');
  }
  return problems;
}

/** Why a request being decided blocks another: one at a time (409). */
export const HOME_OPEN_ALREADY = 'Your home location request is being decided already: withdraw it first to ask again with another point.';

/** Since 24 October 2026: one being decided at a time of each type (409). */
export const homeOpenAlready = (type: HomeType): string =>
  type === 'home' ? HOME_OPEN_ALREADY : `Your ${homeTypeWords(type)} request is being decided already: withdraw it first, or wait for its decision, to ask for another.`;

// ---------- who sees and decides ----------

/** A request as the rules take it: whether it is the caller's own, whether its person is C-level, and whether a CEO asked it. */
export interface HomeParties {
  /** The caller is the request's employee. */
  own: boolean;
  /** Its employee is C-level (G9): HR doesn't see it, the CEO takes both steps. */
  confidential: boolean;
  /** It was asked by someone holding the CEO role: their own CEO step is a Super Admin's. */
  byCeo?: boolean;
}

const holds = (user: Roles, role: Role) => user.roles.includes(role);

/**
 * Who sees homes (besides each person their own): HR, the CEO and the Super Admin (owner's brief, 20 October 2026: "Never
 * managers, Finance or the directory").
 */
export const seesHomeLocations = (user: Roles): boolean => holds(user, 'hr') || holds(user, 'ceo') || holds(user, 'super_admin');

/** Whether the caller sees a request: their own; else HR, the CEO or the Super Admin, a C-level person's not HR (only those who see C-level people). */
export function seesHome(user: Roles, r: Pick<HomeParties, 'own' | 'confidential'>): boolean {
  if (r.own) return true;
  if (!seesHomeLocations(user)) return false;
  return !r.confidential || seesConfidential(user);
}

/**
 * Who decides a stage: HR's stage HR, a C-level person's the CEO (or HR with Super Admin); the CEO's stage the CEO, and,
 * on a request a CEO asked for themself, a Super Admin. Nobody their own request.
 */
export function decidesHomeStage(user: Roles, stage: HomeStage, r: HomeParties): boolean {
  if (r.own) return false;
  if (stage === 'hr') return r.confidential ? decidesConfidentialStage(user, ['hr']) : holds(user, 'hr');
  return holds(user, 'ceo') || (r.byCeo === true && holds(user, 'super_admin'));
}

/** Whether a request waits for the caller's decision now. */
export function waitsForHome(user: Roles, r: HomeParties & { status: string }): boolean {
  const stage = homeStage(r.status);
  return stage !== null && decidesHomeStage(user, stage, r);
}

/** The employee withdraws their own request while it is being decided. */
export const withdrawsHome = (r: Pick<HomeParties, 'own'> & { status: string }): boolean => r.own && isOpenHome(r.status);

/**
 * An approved home is removed by its employee at any time, and by HR, the CEO or the Super Admin who see it. A client
 * location, once approved, is the company's: HR ends it on Check-in Setup instead (24 October 2026).
 */
export const removesHome = (user: Roles, r: Pick<HomeParties, 'own' | 'confidential'> & { status: string; type?: string | null }): boolean =>
  r.status === 'approved' && r.type !== 'client' && seesHome(user, r);

/** HR changes an approved home's or remote site's validity later (owner, 24 October 2026: "allow the HR to add an end date"); a C-level person's the CEO. */
export const setsLocationValidity = (user: Roles, r: Pick<HomeParties, 'own' | 'confidential'> & { status: string; type?: string | null }): boolean =>
  r.status === 'approved' && r.type !== 'client' && !r.own && (r.confidential ? decidesConfidentialStage(user, ['hr']) : holds(user, 'hr'));

/** What a request's stage is called, inside a sentence: HR, or the CEO for a C-level person's HR step. */
export const homeStageName = (stage: HomeStage, confidential?: boolean | null): string => (stage === 'ceo' || confidential === true ? 'the CEO' : 'HR');
