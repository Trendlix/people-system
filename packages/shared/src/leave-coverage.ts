// Leave coverage (owner, 25 October 2026: "if there are leaves applied by an employee and another employee in the same
// department is on a leave, how can we manage it without affecting the workflow?"). Asked, the owner chose:
// - "Warn and need HR": a team's staffing limit for annual leave ("At most N people on annual leave at once", "At least
//   P% at work", either, or none); a request breaking it on any day is still sent, with a warning, and HR approves it too,
//   marked "Over the staffing limit";
// - "Required over 2 days": annual leave of more than 2 working days names a colleague who covers, not off on those days;
//   shorter leave may name one;
// - "To a stand-in": someone who approves names a stand-in for the days of their leave, who decides what waits at their
//   step meanwhile (default: their department's head, or the head's head when they are the head, else HR); a C-level
//   approver's stand-in is the CEO or a Super Admin;
// - "Names, no leave types": the requester and their colleagues see who else is off by name ("Omar and Sara are off on
//   12 Nov"); the kind of leave stays HR's and the CEO's.
// The law: sick leave and casual leave (عارضة) can't be refused (Arts. 128, 131), so the limit and its HR step are annual
// leave's only, and unpaid leave's, which the employer agrees to as it does annual leave's dates. Pure code: the API
// works out and enforces these, the web shows the same. Dates are YYYY-MM-DD.

// ---------- what is limited ----------

/**
 * The leave kinds a staffing limit, its HR step and the required cover apply to: annual leave, and unpaid leave (no right
 * to it in the law: by agreement, so as plannable and refusable as annual leave). Never sick or casual leave, which can't
 * be refused, nor the others the law gives as rights (a birth, exams, Hajj, maternity, childcare), nor HR's own types.
 */
export const STAFFING_LIMITED_KINDS = ['annual', 'unpaid'] as const;

/** Whether leave of this kind counts against a staffing limit (and needs its cover over 2 days). */
export const isStaffingLimited = (kind: string | null | undefined): boolean => (STAFFING_LIMITED_KINDS as readonly string[]).includes(kind ?? '');

/** The owner's "Required over 2 days": a cover is named for leave of a limited kind of more than this many working days. */
export const COVER_REQUIRED_OVER_DAYS = 2;

/** Whether a request of this kind and days needs a colleague named to cover (an employee's own; HR's record may name one). */
export const coverRequired = (kind: string | null | undefined, days: number): boolean => isStaffingLimited(kind) && days > COVER_REQUIRED_OVER_DAYS;

/** The longest handover note a requester leaves the colleague who covers. */
export const HANDOVER_NOTE_MAX = 1000;

// ---------- the staffing limit ----------

/**
 * A team's staffing limit (or a department's without teams): at most so many people on annual (or unpaid) leave at once,
 * and/or at least this percent of its people at work. Null fields: no such limit.
 */
export interface StaffingLimit {
  maxOff: number | null;
  minAtWorkPercent: number | null;
}

/** The most people "at most N on annual leave at once" may say. */
export const STAFFING_MAX_OFF_LIMIT = 500;

/** Whether a limit says anything. */
export const hasStaffingLimit = (l: StaffingLimit | null | undefined): l is StaffingLimit => !!l && (l.maxOff !== null || l.minAtWorkPercent !== null);

/** Why a limit as typed can't be saved (none: it can). Both empty is "no limit", which removes it. */
export function staffingLimitProblems(l: { maxOff?: unknown; minAtWorkPercent?: unknown }): string[] {
  const problems: string[] = [];
  const whole = (v: unknown, min: number, max: number) => v === null || v === undefined || (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max);
  if (!whole(l.maxOff, 0, STAFFING_MAX_OFF_LIMIT)) problems.push(`Enter the most people on annual leave at once as a whole number from 0 to ${STAFFING_MAX_OFF_LIMIT}, or leave it empty.`);
  if (!whole(l.minAtWorkPercent, 1, 100)) problems.push('Enter the least share at work as a whole percent from 1 to 100, or leave it empty.');
  return problems;
}

/**
 * The fewest of `members` people a limit wants at work on a day: all but `maxOff`, and at least `minAtWorkPercent` of
 * them (rounded up: 50% of 3 is 2), whichever is more. Null: no limit, or nobody in the group.
 */
export function fewestAtWork(limit: StaffingLimit | null | undefined, members: number): number | null {
  if (!hasStaffingLimit(limit) || members <= 0) return null;
  const byCount = limit.maxOff !== null ? Math.max(0, members - limit.maxOff) : 0;
  const byShare = limit.minAtWorkPercent !== null ? Math.ceil((members * limit.minAtWorkPercent) / 100 - 1e-9) : 0;
  return Math.min(members, Math.max(byCount, byShare));
}

/** A limit in words: "At most 2 people on annual leave at once · At least 50% at work"; "No limit". */
export function staffingLimitText(limit: StaffingLimit | null | undefined): string {
  if (!hasStaffingLimit(limit)) return 'No limit';
  return [
    limit.maxOff !== null ? `At most ${limit.maxOff} ${limit.maxOff === 1 ? 'person' : 'people'} on annual leave at once` : null,
    limit.minAtWorkPercent !== null ? `At least ${limit.minAtWorkPercent}% at work` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// ---------- the days a leave takes ----------

/**
 * The days of a leave from its first day to its last (both included) that are worked out for coverage: the working days
 * of the requester's shift that aren't official holidays (nobody is expected at work on the others), every day for a type
 * counted in calendar days. At most `max` (a year), so a long childcare leave stays a list of a year.
 */
export function coverageDayList(
  start: string,
  end: string,
  count: { workingDays: readonly number[]; holidays: readonly string[]; calendarDays: boolean },
  max = 366,
): string[] {
  if (!DATE.test(start) || !DATE.test(end) || end < start) return [];
  const working = new Set(count.workingDays);
  const off = new Set(count.holidays);
  const days: string[] = [];
  for (let n = dayNumber(start); n <= dayNumber(end) && days.length < max; n++) {
    const day = new Date(n * 86_400_000);
    const date = day.toISOString().slice(0, 10);
    if (count.calendarDays || (working.has(day.getUTCDay()) && !off.has(date))) days.push(date);
  }
  return days;
}

// ---------- coverage: who else is off ----------

/** A person as the coverage names them (by the name the directory shows). */
export interface CoveragePerson {
  id: string;
  fullNameEn: string;
}

/** A person of the group on the days worked out: employed from `from` to `to` (null: current). */
export interface CoverageMember extends CoveragePerson {
  from: string;
  to: string | null;
}

/** A leave of someone in the group, approved or being decided (`waiting`). */
export interface CoverageLeave {
  employeeId: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  waiting: boolean;
  /** Of a limited kind (annual, unpaid): counted against the staffing limit. */
  limited: boolean;
  /** Its type's name, for those who see it (HR, the CEO); null for everyone else. */
  typeName: string | null;
}

/** Someone working elsewhere on some days, not off: from home (wfh) or on an official duty (od). */
export interface CoverageElsewhere {
  employeeId: string;
  startDate: string;
  endDate: string;
  kind: 'wfh' | 'od';
  waiting: boolean;
}

/** Someone off on a day: their name, whether it is still being decided, half a day, and its type (null: not shown). */
export interface CoverageOff extends CoveragePerson {
  waiting: boolean;
  halfDay: boolean;
  type: string | null;
}

/** Someone working remotely or on duty on a day: at work, shown apart. */
export interface CoverageAway extends CoveragePerson {
  waiting: boolean;
}

/** A day of the coverage: who of the group is off, working remotely or on duty, and "N of M at work". */
export interface CoverageDay {
  date: string;
  /** The group's people employed that day, the requester included. */
  members: number;
  /** Of them, not on leave (working from home or on an official duty counts as at work); the requester's day off counted. */
  atWork: number;
  /** The others off that day (never the requester), by name. */
  off: CoverageOff[];
  remote: CoverageAway[];
  onDuty: CoverageAway[];
  /** The requester is off that day with this request. */
  self: boolean;
  /** People on leave of a limited kind that day (approved and being decided), this request included when it is one. */
  limitedOff: number;
  /** The fewest at work the group's limit wants that day; null: no limit. */
  fewestAtWork: number | null;
  /** This request breaks the limit that day. */
  over: boolean;
}

/** What a coverage is worked out from. */
export interface CoverageInput {
  /** The days worked out (coverageDayList). */
  days: readonly string[];
  /** The group: the requester's team (else department), the requester among them. */
  members: readonly CoverageMember[];
  /** The others' leave, approved or being decided (never this request). */
  leave: readonly CoverageLeave[];
  elsewhere: readonly CoverageElsewhere[];
  /** Whose request it is (null: none, e.g. a day's picture). */
  requesterId: string | null;
  /** The request: its days, and whether it is of a limited kind (only then is the limit checked). */
  request: { startDate: string; endDate: string; limited: boolean } | null;
  limit: StaffingLimit | null;
}

/**
 * Each day's coverage: the group's people employed that day; the others off (one entry a person: approved, or still
 * being decided, marked waiting), working from home or on duty (at work, shown apart, never counted as off); the
 * requester's own day off; "N of M at work"; and, for a request of a limited kind, the people on leave of a limited kind
 * with it and whether that leaves fewer at work than the limit wants (over). Someone not employed that day isn't counted.
 */
export function coverageDays(input: CoverageInput): CoverageDay[] {
  const out: CoverageDay[] = [];
  for (const date of input.days) {
    const employed = input.members.filter((m) => m.from <= date && (m.to === null || m.to >= date));
    const ids = new Set(employed.map((m) => m.id));
    const names = new Map(employed.map((m) => [m.id, m.fullNameEn]));
    const self =
      !!input.request && !!input.requesterId && ids.has(input.requesterId) && input.request.startDate <= date && input.request.endDate >= date;
    const off = new Map<string, CoverageOff & { limited: boolean }>();
    for (const l of input.leave) {
      if (l.employeeId === input.requesterId || !ids.has(l.employeeId) || l.startDate > date || l.endDate < date) continue;
      const before = off.get(l.employeeId);
      // one entry a person: an approved leave over one being decided
      if (before && !before.waiting) continue;
      off.set(l.employeeId, { id: l.employeeId, fullNameEn: names.get(l.employeeId)!, waiting: l.waiting, halfDay: l.halfDay, type: l.typeName, limited: l.limited });
    }
    const remote = new Map<string, CoverageAway>();
    const onDuty = new Map<string, CoverageAway>();
    for (const e of input.elsewhere) {
      if (e.employeeId === input.requesterId || !ids.has(e.employeeId) || off.has(e.employeeId) || e.startDate > date || e.endDate < date) continue;
      const list = e.kind === 'wfh' ? remote : onDuty;
      const before = list.get(e.employeeId);
      if (before && !before.waiting) continue;
      list.set(e.employeeId, { id: e.employeeId, fullNameEn: names.get(e.employeeId)!, waiting: e.waiting });
    }
    const members = employed.length;
    const others = [...off.values()];
    const limitedOff = others.filter((o) => o.limited).length + (self && input.request?.limited ? 1 : 0);
    const fewest = fewestAtWork(input.limit, members);
    out.push({
      date,
      members,
      atWork: Math.max(0, members - others.length - (self ? 1 : 0)),
      off: others.sort(byName).map(({ limited: _limited, ...o }) => o),
      remote: [...remote.values()].sort(byName),
      onDuty: [...onDuty.values()].sort(byName),
      self,
      limitedOff,
      fewestAtWork: fewest,
      over: self && !!input.request?.limited && fewest !== null && members - limitedOff < fewest,
    });
  }
  return out;
}

/** Whether the request breaks its group's limit on any of its days. */
export const breaksStaffingLimit = (days: readonly Pick<CoverageDay, 'over'>[]): boolean => days.some((d) => d.over);

// ---------- the cover ----------

/** What the API knows of the colleague named to cover. */
export interface CoverFacts {
  requesterId: string;
  coverId: string;
  /** Null: no such employee, or one the caller may not see (a C-level person, for most). */
  cover: { fullNameEn: string; current: boolean } | null;
  /** They are off (approved or being decided) on some of the leave's days. */
  offOnDays: boolean;
}

/**
 * Why a colleague can't cover the leave (none: they can): someone employed now, not the requester, not off on any of its
 * days (any department, the requester's team first in the list).
 */
export function coverProblems(f: CoverFacts): string[] {
  if (f.coverId === f.requesterId) return ['You can’t cover your own leave: choose a colleague.'];
  if (!f.cover || !f.cover.current) return ['Choose the colleague who covers from the list.'];
  if (f.offOnDays) return [`${f.cover.fullNameEn} is off on some of these days, so they can’t cover them: choose another colleague.`];
  return [];
}

/** A colleague who may cover, as the form lists them: where they work, and whether they are in the requester's team. */
export interface CoverCandidate extends CoveragePerson {
  department: string | null;
  team: string | null;
  sameTeam: boolean;
}

/** The colleagues in the requester's team first, then everyone else, each by name. */
export function sortedCandidates<T extends { fullNameEn: string; sameTeam: boolean }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Number(b.sameTeam) - Number(a.sameTeam) || a.fullNameEn.localeCompare(b.fullNameEn));
}

// ---------- the stand-in ----------

/** A stand-in: a person (by their employee id), or HR (anyone holding HR). */
export interface StandInPick {
  employeeId: string | null;
  hr: boolean;
}

/** What a requester's default stand-in is worked out from. */
export interface StandInFacts {
  requesterId: string;
  /** The requester is C-level: only the CEO or a Super Admin stands in (owner, 19 October 2026: C-level confidential). */
  cLevel: boolean;
  /** The head of their department (a team's: its department's head). */
  departmentHeadId: string | null;
  /** Their own direct manager: the head's head, when they are the head. */
  managerId: string | null;
  /** The employees whose accounts are the CEO's, then a Super Admin's (the C-level path), in that order of preference. */
  ceoIds: readonly string[];
  superAdminIds: readonly string[];
  /** Those off (approved or being decided) on some of the days, who can't stand in. */
  unavailable: ReadonlySet<string>;
}

/**
 * The stand-in offered first: the head of their department; the head's head (their own direct manager) when they are the
 * head; else HR. A C-level person's: the CEO, else a Super Admin; never HR, who doesn't see C-level people (null when
 * nobody can). Never the requester, nor someone off on those days.
 */
export function defaultStandIn(f: StandInFacts): StandInPick | null {
  const free = (id: string | null | undefined): id is string => !!id && id !== f.requesterId && !f.unavailable.has(id);
  if (f.cLevel) {
    const pick = f.ceoIds.find(free) ?? f.superAdminIds.find(free);
    return pick ? { employeeId: pick, hr: false } : null;
  }
  if (free(f.departmentHeadId)) return { employeeId: f.departmentHeadId, hr: false };
  if (f.departmentHeadId === f.requesterId && free(f.managerId)) return { employeeId: f.managerId, hr: false };
  return { employeeId: null, hr: true };
}

/** What the API knows of the stand-in chosen. */
export interface StandInChosen {
  /** Null: no such employee, or one the caller may not see. */
  person: { fullNameEn: string; current: boolean; account: boolean } | null;
}

/**
 * Why a stand-in chosen can't be (none: they can): HR, but not for a C-level person; else someone employed now with a
 * sign-in account (they decide in the system), not the requester, not off on those days; a C-level person's the CEO or a
 * Super Admin only.
 */
export function standInProblems(pick: StandInPick, f: StandInFacts & StandInChosen): string[] {
  if (pick.hr) return f.cLevel ? ['A C-level person’s stand-in is the CEO or a Super Admin, not HR: choose one of them.'] : [];
  if (!pick.employeeId) return ['Choose who decides your team’s requests while you are away, or HR.'];
  if (pick.employeeId === f.requesterId) return ['You can’t stand in for yourself: choose someone else, or HR.'];
  if (!f.person || !f.person.current) return ['Choose your stand-in from the list.'];
  if (f.cLevel && !f.ceoIds.includes(pick.employeeId) && !f.superAdminIds.includes(pick.employeeId)) {
    return ['A C-level person’s stand-in is the CEO or a Super Admin: choose one of them.'];
  }
  if (!f.person.account) return [`${f.person.fullNameEn} has no sign-in account, so they can’t decide requests: choose someone else${f.cLevel ? '' : ', or HR'}.`];
  if (f.unavailable.has(pick.employeeId)) return [`${f.person.fullNameEn} is off on some of these days, so they can’t stand in: choose someone else${f.cLevel ? '' : ', or HR'}.`];
  return [];
}

/** A stand-in in force: whose step they take, and whether they see C-level people (the CEO, a Super Admin). */
export interface StandInInForce {
  /** The stand-in's employee id; null: HR stands in. */
  employeeId: string | null;
  /** The stand-in sees C-level people: the CEO or a Super Admin (HR never does). */
  seesConfidential: boolean;
}

/**
 * Whether a request waiting at an absent approver's step moves to their stand-in (owner: "Waiting and new requests go to
 * the stand-in for those days, then back"): any but the stand-in's own (nobody decides their own: it stays with the
 * approver), and never a C-level person's to a stand-in who doesn't see C-level people (it stays with the approver too).
 */
export function movesToStandIn(r: { employeeId: string }, standIn: StandInInForce, cLevel: ReadonlySet<string>): boolean {
  if (standIn.employeeId !== null && r.employeeId === standIn.employeeId) return false;
  if (cLevel.has(r.employeeId) && !standIn.seesConfidential) return false;
  return true;
}

/** Whether an approver's leave puts their stand-in in force today: approved, and today within its days. */
export const standInInForce = (leave: { status: string; startDate: string; endDate: string }, today: string): boolean =>
  leave.status === 'approved' && leave.startDate <= today && leave.endDate >= today;

// ---------- what the API sends ----------

/** The group a coverage is of: the requester's team, else their department. */
export interface LeaveCoverageGroup {
  id: string;
  nameEn: string;
  team: boolean;
}

/**
 * Who is looking (owner: "Names, no leave types"): the requester (names only), an approver (names and "leave"), or HR and
 * the CEO (names with the leave's types).
 */
export type CoverageViewer = 'requester' | 'approver' | 'hr';

/** The requester covers a colleague on some of these days: a warning, never a block (HR sees it on the approval). */
export interface CoveringClash {
  requestId: string;
  employee: CoveragePerson;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  waiting: boolean;
}

/** GET /leave/requests/:id/coverage: the request's days as its approvers (and its employee) see them. */
export interface LeaveCoverageView {
  group: LeaveCoverageGroup | null;
  limit: StaffingLimit | null;
  /** The request is of a limited kind (annual, unpaid): the limit applies to it. */
  limited: boolean;
  viewer: CoverageViewer;
  days: CoverageDay[];
  /** It breaks the limit on some day. */
  overLimit: boolean;
  /** The requester covers colleagues on some of its days. */
  covering: CoveringClash[];
}

/** Someone a requester may name to stand in for them, as the form lists them. */
export interface StandInOption extends CoveragePerson {
  department: string | null;
  team: string | null;
}

/** The stand-in part of the form: whether one is needed, the default, the others offered, and whether HR is one. */
export interface StandInChoiceView {
  /** The requester approves for others (direct reports, or a team or department they lead): they name a stand-in. */
  needed: boolean;
  default: { employee: CoveragePerson | null; hr: boolean } | null;
  options: StandInOption[];
  /** HR may stand in (never for a C-level person). */
  hr: boolean;
  /** The requester is C-level: the CEO or a Super Admin only. */
  cLevel: boolean;
}

/** GET /me/leave/coverage?from=&to=&typeId=&halfDay=: the new request's days, its cover and its stand-in, as typed. */
export interface LeaveFormCoverage extends LeaveCoverageView {
  /** The days it takes, as the law counts them. */
  leaveDays: number;
  cover: { required: boolean; overDays: number; candidates: CoverCandidate[] };
  standIn: StandInChoiceView;
}

/** GET /me/leave/covering: a colleague's leave the caller covers, current or to come (never its type). */
export interface CoverAssignment {
  requestId: string;
  employee: CoveragePerson;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  /** Still being decided. */
  waiting: boolean;
  handoverNote: string | null;
}

/** GET /leave/staffing: a team (or a department without teams) and its limit, for Organization → Leave → Staffing. */
export interface StaffingUnitView {
  id: string;
  nameEn: string;
  /** A team's department. */
  parent: { id: string; nameEn: string } | null;
  team: boolean;
  /** A department with teams: its limits are its teams' (none of its own). */
  hasTeams: boolean;
  /** Its people employed now. */
  members: number;
  limit: StaffingLimit | null;
  updatedAt: string | null;
}

// ---------- helpers ----------

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
const byName = (a: CoveragePerson, b: CoveragePerson) => a.fullNameEn.localeCompare(b.fullNameEn);
