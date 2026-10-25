// The positions on "Send us your CV" (owner, 25 October 2026, on General CVs' "Area" filter: "what do you mean by area
// here?", then "should it be the positions?"; asked, they chose "Position, grouped by team"): the person chooses the job
// they would like, not an area.
// - The positions are the company's job titles, never a C-level one (a job title for a confidential grade, as G9 ·
//   Executive), with their levels merged: "Junior Video Editor" and "Senior Video Editor" are one "Video Editor".
// - Grouped by the job title's team (else its department), the team's name the group's heading. The same name in two
//   teams stays two positions, one under each, so the team is always known from the position: a CV keeps its team as
//   before (general_cvs.department_id) and the team filters and the suggestions keep working.
// - Plus "Other (write it)", in words.
// - HR hides a position from the careers page, or gives it a public name, in Recruitment Settings ("Positions on the CV
//   Form"); a new job title's position is shown until HR hides it. HR's own lists keep the hidden ones, marked hidden.
// Each position's key is its team's id and its merged name in lower case ("<team id>:video editor"): it stays while the
// job titles behind it change level, and HR's choices are kept by it.
// Pure code: the API builds the list from the job titles (apps/api/src/recruitment/cv-positions.ts), the web shows it.
// Tested in apps/api/src/common/cv-positions.spec.ts.

import type { RecruitmentUserRef } from './recruitment.js';

export const CV_POSITION_LIMITS = {
  /** A public name HR gives a position, at most. */
  publicName: 80,
  /** What someone writes for Other, at most. */
  other: 80,
  /** A position's key, at most (a team's id, a colon and the name). */
  key: 200,
} as const;

/** The careers form's and HR's value for "Other (write it)": never a position's key (theirs start with a team's id). */
export const OTHER_POSITION = 'other';

/** The refusal of a position that isn't on the list (unknown, gone, hidden from the careers page, or C-level). */
export const POSITION_NOT_LISTED = 'Choose a position from the list.';

// ---------- merging the levels ----------

/**
 * The words of a level before a title: "Senior Video Editor", "Jr. Designer", "Assistant Producer", "Intern Copywriter",
 * "Mid-level Developer"; and in Arabic "متدرب", "مساعد", "جونيور", "سينيور". Written as compared (normalWord).
 */
const LEADING_LEVELS = new Set([
  'junior',
  'senior',
  'lead',
  'principal',
  'associate',
  'assistant',
  'intern',
  'trainee',
  'jr',
  'sr',
  'mid',
  'mid-level',
  'mid-senior',
  'entry-level',
  'متدرب',
  'مساعد',
  'جونيور',
  'سينيور',
]);

/** Two words that are a level before a title: "Mid level Designer", "Entry level Designer". */
const LEADING_LEVEL_PAIRS = new Set(['mid level', 'entry level']);

/**
 * The words of a level after a title: "Video Editor Senior", "Engineer II", "Designer Jr."; and in Arabic "محاسب أول"
 * (Senior Accountant), "مصمم مبتدئ", "محاسب متدرب", "مصمم رئيسي". "Intern" and "Trainee" only after a word naming a
 * person (personWord): "Video Editor Intern" is a Video Editor, "Marketing Intern" stays as it is.
 */
const TRAILING_LEVELS = new Set(['junior', 'senior', 'jr', 'sr', 'i', 'ii', 'iii', 'أول', 'اول', 'مبتدئ', 'مبتدىء', 'متدرب', 'جونيور', 'سينيور', 'رئيسي']);
const TRAILING_AFTER_PERSON = new Set(['intern', 'trainee']);

/** Words after which a leading word isn't a level: "Lead Generation Specialist", "Assistant to the CEO". */
const NOT_A_LEVEL_BEFORE: Readonly<Record<string, ReadonlySet<string>>> = {
  lead: new Set(['generation', 'gen']),
  assistant: new Set(['to']),
};

/** A word as levels are compared: lower case, without the dot of an abbreviation or a comma after it. */
const normalWord = (w: string) => w.toLowerCase().replace(/[.,:;]+$/, '');

/**
 * A word naming a person ("Editor", "Designer", "Copywriter", "Accountant", "Specialist", "Analyst", "Executive",
 * "Technician"); never "Marketing", "Content", "Management" or "Sales" ("Management Trainee" stays as it is).
 */
const personWord = (w: string) => /(er|or|ist|yst|ant|ive|ian|ee)$/i.test(normalWord(w));

/** Every level word, as a level in brackets or after a dash or a comma at the end: "Video Editor (Senior)", "Video Editor - Lead". */
const ANY_LEVEL = new Set([...LEADING_LEVELS, ...TRAILING_LEVELS, ...TRAILING_AFTER_PERSON]);

/**
 * A job title's position name, its levels taken off (owner, 25 October 2026: levels merged, "Video Editor" for Junior and
 * Senior): the level words before it (Junior, Senior, Lead, Principal, Associate, Assistant, Intern, Trainee, Jr., Sr.,
 * Mid-level, Entry level; in Arabic متدرب, مساعد, جونيور, سينيور), after it (Junior, Senior, Jr., Sr., I, II, III; Intern
 * and Trainee after a word naming a person; in Arabic أول, مبتدئ, متدرب, جونيور, سينيور, رئيسي), and any of them in
 * brackets or after a dash at the end. Words that change the job stay: "Head of Content", "Account Manager", "Team
 * Lead", "Executive Assistant", "Sales Associate", "Marketing Intern", "Lead Generation Specialist". Never down to
 * nothing: "Intern" stays "Intern", "Senior Associate" is "Associate". Spaces made single; the words otherwise as written.
 */
export function positionNameOf(title: string): string {
  let words = title.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (!words.length) return '';
  // "Video Editor (Senior)", "Video Editor - Junior", "Video Editor, Intern", "Video Editor – II"
  const tidy = words.join(' ');
  const end = /^(.*\S)\s*(?:\(\s*([^()]+?)\s*\)|\[\s*([^[\]]+?)\s*\]|[-–—|/]\s*(\S+)|,\s*(\S+))$/u.exec(tidy);
  if (end) {
    const level = normalWord(end[2] ?? end[3] ?? end[4] ?? end[5] ?? '');
    if (ANY_LEVEL.has(level) || LEADING_LEVEL_PAIRS.has(level)) words = end[1].split(' ');
  }
  for (let changed = true; changed && words.length > 1; ) {
    changed = false;
    const first = normalWord(words[0]);
    const pair = words.length > 2 ? `${first} ${normalWord(words[1])}` : '';
    if (pair && LEADING_LEVEL_PAIRS.has(pair)) {
      words = words.slice(2);
      changed = true;
      continue;
    }
    if (LEADING_LEVELS.has(first) && !NOT_A_LEVEL_BEFORE[first]?.has(normalWord(words[1]))) {
      words = words.slice(1);
      // "Senior - Video Editor"
      while (words.length > 1 && /^[-–—|/,]$/.test(words[0])) words = words.slice(1);
      changed = true;
      continue;
    }
    const last = normalWord(words[words.length - 1]);
    if (TRAILING_LEVELS.has(last) || (TRAILING_AFTER_PERSON.has(last) && personWord(words[words.length - 2]))) {
      words = words.slice(0, -1);
      while (words.length > 1 && /^[-–—|/,]$/.test(words[words.length - 1])) words = words.slice(0, -1);
      changed = true;
    }
  }
  return words.join(' ').replace(/[\s,–—|/-]+$/u, '') || tidy;
}

/**
 * A position's name as compared and keyed: lower case, single spaces, and in Arabic every alef with a hamza or madda a
 * bare alef, ة as ه and ى as ي (so "مُحرِّر" and "محرر" are one); the dots of abbreviations kept.
 */
export function normalPositionName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** A position's key: its team's id and its name as compared, "<team id>:video editor". */
export const positionKeyOf = (teamId: string, name: string): string => `${teamId}:${normalPositionName(name)}`;

/** The team's id a position's key starts with; null when it isn't a key. */
export function teamIdOfKey(key: string): string | null {
  const at = key.indexOf(':');
  return at > 0 ? key.slice(0, at) : null;
}

// ---------- the list ----------

/** A team (or a department) positions are grouped under, in the organisation's order: a department, then its teams. */
export interface PositionTeam {
  id: string;
  name: string;
  /** Its department's name, for a team; null for a department. */
  departmentName: string | null;
}

/** A job title as positions are made from it: its own team (or department), and whether it is C-level. */
export interface PositionTitle {
  id: string;
  name: string;
  teamId: string;
  /** For a confidential grade (as G9 · Executive): never a position. */
  cLevel: boolean;
}

/** What HR chose for a position, by its key: hidden from the careers page, a public name. None: shown, by its own name. */
export interface PositionChoice {
  hidden: boolean;
  publicName: string | null;
}

/** A position: a job title's name with its levels merged, under its team. */
export interface CvPosition {
  /** "<team id>:video editor" (positionKeyOf). */
  key: string;
  /** Its merged name: "Video Editor". */
  name: string;
  /** HR's name for it on the careers page; null: its own. */
  publicName: string | null;
  /** As the lists show it: the public name, else its own. */
  shownName: string;
  /** Hidden from the careers page by HR (HR's lists keep it, marked hidden). */
  hidden: boolean;
  /** Its team (or department): the one a CV for it is kept with. */
  teamId: string;
  /** Its team as the careers page names it: "Video"; "Content (Marketing)" when another team is called Content too. */
  team: string;
  /** Its team as HR's lists name it: "Video · Production". */
  teamHrName: string;
  /** The job titles it merges, in their order, and their names. */
  titleIds: string[];
  titles: string[];
}

/**
 * The positions (owner, 25 October 2026: "Position, grouped by team"): each team's non-C-level job titles with their
 * levels merged (positionNameOf), one position a name a team (the same name in two teams is two positions, one under
 * each), with HR's choices by key (hidden, a public name). In the teams' order, and by name within a team; a team with
 * none is left out. A position's name is its first job title's, merged.
 */
export function cvPositions(teams: readonly PositionTeam[], titles: readonly PositionTitle[], choices: ReadonlyMap<string, PositionChoice> = new Map()): CvPosition[] {
  const names = teamNames(teams);
  const byTeam = new Map<string, Map<string, { name: string; ids: string[]; titles: string[] }>>();
  for (const t of titles) {
    if (t.cLevel || !names.has(t.teamId)) continue;
    const name = positionNameOf(t.name);
    if (!name) continue;
    const merged = byTeam.get(t.teamId) ?? new Map<string, { name: string; ids: string[]; titles: string[] }>();
    byTeam.set(t.teamId, merged);
    const key = positionKeyOf(t.teamId, name);
    const one = merged.get(key) ?? { name, ids: [], titles: [] };
    merged.set(key, one);
    one.ids.push(t.id);
    one.titles.push(t.name.trim().replace(/\s+/g, ' '));
  }
  const out: CvPosition[] = [];
  for (const team of teams) {
    const merged = byTeam.get(team.id);
    if (!merged) continue;
    const named = names.get(team.id)!;
    const rows = [...merged.entries()].map(([key, m]): CvPosition => {
      const choice = choices.get(key);
      const publicName = choice?.publicName?.trim() ? choice.publicName.trim().replace(/\s+/g, ' ') : null;
      return {
        key,
        name: m.name,
        publicName,
        shownName: publicName ?? m.name,
        hidden: choice?.hidden === true,
        teamId: team.id,
        team: named.name,
        teamHrName: named.hrName,
        titleIds: m.ids,
        titles: m.titles,
      };
    });
    rows.sort((a, b) => a.shownName.localeCompare(b.shownName, 'en', { sensitivity: 'base' }) || a.key.localeCompare(b.key));
    out.push(...rows);
  }
  return out;
}

/**
 * The teams' names: the careers page's ("Video"; a team called as another is told apart by its department in brackets,
 * "Content (Marketing)", as the areas were; a department keeps its own), and HR's ("Video · Production").
 */
function teamNames(teams: readonly PositionTeam[]): Map<string, { name: string; hrName: string }> {
  const key = (name: string) => normalPositionName(name);
  const count = new Map<string, number>();
  for (const t of teams) count.set(key(t.name), (count.get(key(t.name)) ?? 0) + 1);
  const out = new Map<string, { name: string; hrName: string }>();
  for (const t of teams) {
    const name = t.name.trim().replace(/\s+/g, ' ');
    const department = t.departmentName?.trim().replace(/\s+/g, ' ') ?? null;
    out.set(t.id, {
      name: department !== null && (count.get(key(t.name)) ?? 0) > 1 ? `${name} (${department})` : name,
      hrName: department !== null ? `${name} · ${department}` : name,
    });
  }
  return out;
}

/** A team's positions on a list: the careers page's (shown ones only), or HR's (the hidden ones too, marked). */
export interface CvPositionGroup {
  teamId: string;
  /** The group's heading: the team as the careers page names it ("Video"). */
  team: string;
  positions: { key: string; name: string; hidden?: boolean }[];
}

/**
 * The positions grouped by team, in their order: the careers page's (`withHidden` false: the shown ones only, by their
 * shown names), or HR's (the hidden ones too, each marked).
 */
export function positionGroups(positions: readonly CvPosition[], { withHidden }: { withHidden: boolean }): CvPositionGroup[] {
  const groups: CvPositionGroup[] = [];
  for (const p of positions) {
    if (p.hidden && !withHidden) continue;
    let g = groups[groups.length - 1];
    if (!g || g.teamId !== p.teamId) {
      g = { teamId: p.teamId, team: withHidden ? p.teamHrName : p.team, positions: [] };
      groups.push(g);
    }
    g.positions.push(withHidden ? { key: p.key, name: p.shownName, hidden: p.hidden } : { key: p.key, name: p.shownName });
  }
  return groups;
}

// ---------- HR's choices (Recruitment Settings) ----------

/** One position as HR saves it: shown or hidden, and a public name (empty: its own). */
export interface CvPositionChoiceInput {
  key: string;
  hidden: boolean;
  publicName?: string | null;
}

/** What is wrong with HR's choices, in words: a public name too long, a position not on the list (it changed since). */
export function positionChoiceProblems(rows: readonly CvPositionChoiceInput[], known: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const L = CV_POSITION_LIMITS;
  if (rows.some((r) => typeof r.publicName === 'string' && r.publicName.trim().length > L.publicName)) problems.push(`Keep each public name to ${L.publicName} characters or fewer.`);
  if (rows.some((r) => !known.has(r.key))) problems.push('The positions changed since the page opened: reload it and try again.');
  return problems;
}

/** GET /recruitment/settings/positions: every position (hidden ones too), and the teams HR's lists filter by. */
export interface CvPositionsView {
  positions: CvPosition[];
  /**
   * The teams (or departments) a general CV can be kept with, as HR's lists name them ("Video · Production"), in the
   * organisation's order: the positions' teams, and the areas older CVs were sent for.
   */
  teams: { id: string; name: string }[];
  updatedAt: string | null;
  updatedBy: RecruitmentUserRef | null;
}
