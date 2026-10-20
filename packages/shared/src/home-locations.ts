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
// (the CEO, the Super Admin) too. A check-in keeps only the place, never the coordinates; the audit log never holds the
// point. Pure: the API decides with these and the web shows the same words.

import { decidesConfidentialStage, seesConfidential } from './confidential.js';
import { OFFICE_RADIUS_MAX, OFFICE_RADIUS_MIN } from './check-in.js';
import type { Role } from './index.js';

type Roles = { roles: readonly Role[] };

/** The radius a home starts with (owner's brief, 20 October 2026: "default 100 m"), which HR may change within the office's limits. */
export const HOME_RADIUS_DEFAULT = 100;
export const HOME_RADIUS_MIN = OFFICE_RADIUS_MIN;
export const HOME_RADIUS_MAX = OFFICE_RADIUS_MAX;

/** The longest label or address a home takes, and the longest comment on a decision. */
export const HOME_LABEL_MAX = 200;
export const HOME_COMMENT_MAX = 1000;

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

/** A step of a request, logged on it in the order taken: sent, HR's and the CEO's decisions, withdrawn, replaced, removed. */
export const HOME_STEP_KINDS = ['submitted', 'hr_decision', 'ceo_decision', 'withdrawn', 'replaced', 'removed'] as const;
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
 * label or address of up to 200 characters if given.
 */
export function homeRequestProblems(r: { latitude: number | null | undefined; longitude: number | null | undefined; label?: string | null }): string[] {
  const problems: string[] = [];
  const { latitude: lat, longitude: lng } = r;
  if (!isNumber(lat) || !isNumber(lng)) problems.push('Put your home on the map, or use your current location while at home.');
  else if (Math.abs(lat) > 90 || Math.abs(lng) > 180) problems.push('That point isn’t on the map: put your home on the map again.');
  const label = homeLabelOf(r.label);
  if (label && label.length > HOME_LABEL_MAX) problems.push(`Keep the label to ${HOME_LABEL_MAX} characters or fewer.`);
  return problems;
}

/** Why a request being decided blocks another: one at a time (409). */
export const HOME_OPEN_ALREADY = 'Your home location request is being decided already: withdraw it first to ask again with another point.';

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

/** An approved home is removed by its employee at any time, and by HR, the CEO or the Super Admin who see it. */
export const removesHome = (user: Roles, r: Pick<HomeParties, 'own' | 'confidential'> & { status: string }): boolean => r.status === 'approved' && seesHome(user, r);

/** What a request's stage is called, inside a sentence: HR, or the CEO for a C-level person's HR step. */
export const homeStageName = (stage: HomeStage, confidential?: boolean | null): string => (stage === 'ceo' || confidential === true ? 'the CEO' : 'HR');
