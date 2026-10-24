import {
  APPLICATION_CHANNELS,
  APPLICATION_SOURCES,
  APPLICATION_STAGES,
  careersPath,
  EMPLOYMENT_TYPES,
  isApplicationStage,
  isDictionarySkill,
  keySkillsOf,
  keySkillsProblems,
  MIN_YEARS_CHOICES,
  QUESTION_KINDS,
  SKILL_GROUP_LABELS,
  SKILL_GROUPS,
  SKILLS_DICTIONARY,
  VACANCY_STATUSES,
  WORK_ARRANGEMENTS,
  type ApplicationChannel,
  type ApplicationSource,
  type ApplicationStage,
  type ApplicationView,
  type QuestionKind,
  type Role,
  type VacancyQuestion,
} from '@trendlix/shared';
import { parseDate } from '../../../lib/format';
import { shownCode } from '../../../lib/hidden';

// Recruitment on the site (owner, 22 October 2026: "where will we include the ATS?"; Phase 1): the addresses, who sees
// what, the lists' filters, the vacancy's form, the screening questions' editor, the channels' links and Make offer.
// Pure code (relative imports), tested in recruitment.test.ts; the API checks everything again.

export const RECRUITMENT_PATH = '/recruitment';
export const VACANCIES_PATH = '/recruitment/vacancies';
export const NEW_VACANCY_PATH = '/recruitment/vacancies/new';
export const APPLICANTS_PATH = '/recruitment/applicants';

export const vacancyHref = (id: string) => `${VACANCIES_PATH}/${encodeURIComponent(id)}`;
export const vacancyEditHref = (id: string) => `${vacancyHref(id)}/edit`;
export const applicantHref = (id: string) => `${APPLICANTS_PATH}/${encodeURIComponent(id)}`;
export const applicantCvHref = (id: string, download = false) => `${applicantHref(id)}/cv${download ? '?download=1' : ''}`;
/** Make offer: the job offer form filled in from the applicant and their vacancy. */
export const makeOfferHref = (applicationId: string) => `/offers/new?application=${encodeURIComponent(applicationId)}`;

type WithRoles = { roles: readonly Role[] };
const has = (user: WithRoles, roles: readonly Role[]) => user.roles.some((r) => roles.includes(r));

/** Reads vacancies and applicants: HR, the CEO, a Super Admin. */
export const readsRecruitment = (user: WithRoles) => has(user, ['hr', 'ceo', 'super_admin']);
/** Drafts and moves vacancies, moves applicants: HR, a Super Admin. */
export const managesRecruitment = (user: WithRoles) => has(user, ['hr', 'super_admin']);
/** Approves a vacancy or sends it back: the CEO, a Super Admin. */
export const approvesVacancies = (user: WithRoles) => has(user, ['ceo', 'super_admin']);

export const WHO_SEES = 'Only HR, the CEO and a Super Admin see recruitment.';

// ---------- the lists ----------

export const VACANCY_FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Waiting for the CEO' },
  { value: 'open', label: 'Open' },
  { value: 'draft', label: 'Drafts' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'closed', label: 'Closed' },
  { value: 'filled', label: 'Filled' },
  { value: 'all', label: 'All' },
] as const;
export type VacancyFilter = (typeof VACANCY_FILTERS)[number]['value'];

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

export function readVacancyFilter(query: Record<string, string | string[] | undefined>): { status: VacancyFilter; q: string } {
  const status = one(query.status);
  return { status: (VACANCY_FILTERS.some((f) => f.value === status) ? status : 'active') as VacancyFilter, q: one(query.q).slice(0, 100) };
}

export const vacanciesApiPath = (f: { status: VacancyFilter; q: string }) => `/recruitment/vacancies?status=${f.status}${f.q ? `&q=${encodeURIComponent(f.q)}` : ''}`;

export const vacanciesHref = (f: { status: VacancyFilter; q?: string }) => {
  const params = new URLSearchParams();
  if (f.status !== 'active') params.set('status', f.status);
  if (f.q) params.set('q', f.q);
  const s = params.toString();
  return s ? `${VACANCIES_PATH}?${s}` : VACANCIES_PATH;
};

/** The applicants' filters, as the address carries them. */
export interface ApplicantsQuery {
  vacancyId: string;
  stage: ApplicationStage | '';
  minMatch: number | null;
  minYears: number | null;
  source: ApplicationSource | '';
  filtered: 'hide' | 'only' | 'all';
  q: string;
  /** The CV match % at least (the key skills found in the CV; 22 October 2026). */
  minCvMatch: number | null;
  /** '': best match first (the screening questions); 'cv': best CV match first; 'years': most experience first (24 October 2026). */
  sort: '' | 'cv' | 'years';
  /** A skill of the dictionary their CV names (24 October 2026); '' for any. */
  skill: string;
}

/** The "CV match ≥ 50%" filter's threshold. */
export const GOOD_CV_MATCH_PERCENT = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readApplicantsQuery(query: Record<string, string | string[] | undefined>): ApplicantsQuery {
  const num = (v: string, max: number) => {
    const n = Number(v);
    return v !== '' && Number.isFinite(n) && n >= 0 && n <= max ? n : null;
  };
  const stage = one(query.stage);
  const source = one(query.source);
  const filtered = one(query.filtered);
  const vacancyId = one(query.vacancyId);
  return {
    vacancyId: UUID.test(vacancyId) ? vacancyId : '',
    stage: isApplicationStage(stage) ? stage : '',
    minMatch: num(one(query.minMatch), 100),
    minYears: minYearsOf(query.minYears),
    source: (APPLICATION_SOURCES as readonly string[]).includes(source) ? (source as ApplicationSource) : '',
    filtered: filtered === 'only' || filtered === 'all' ? filtered : 'hide',
    q: one(query.q).slice(0, 100),
    minCvMatch: num(one(query.minCvMatch), 100),
    sort: sortOf(one(query.sort)),
    skill: skillOf(query.skill),
  };
}

const sortOf = (v: string): ApplicantsQuery['sort'] => (v === 'cv' || v === 'years' ? v : '');

/** A skill filter as the address carries it: one of the dictionary's (skills-dictionary.ts), else none (''). */
export const skillOf = (v: string | string[] | undefined): string => {
  const s = one(v);
  return isDictionarySkill(s) ? s : '';
};

/** A years filter as the address carries it: 0 to 60 years, else none (null). */
export const minYearsOf = (v: string | string[] | undefined): number | null => {
  const t = one(v);
  const n = Number(t);
  return t !== '' && Number.isFinite(n) && n >= 0 && n <= 60 ? n : null;
};

// ---------- the Min. experience and Skill filters (owner, 24 October 2026: "CV years in list + more rules") ----------

/**
 * The Min. experience filter's choices: 1+, 2+, 3+, 5+, 8+ and 10+ years (the years typed, else the CV's estimate: the
 * API's rule), and an old link's other value too, so the filter shows what the list is filtered by.
 */
export function minYearsOptions(current: number | null): { value: string; label: string }[] {
  const values: number[] = [...MIN_YEARS_CHOICES];
  if (current !== null && current > 0 && !values.includes(current)) values.push(current);
  return values.sort((a, b) => a - b).map((n) => ({ value: String(n), label: `${n}+ years` }));
}

/** The Skill filter's choices: the dictionary's skills by group, in its order. */
export const skillGroups = (): { label: string; skills: string[] }[] =>
  SKILL_GROUPS.map((g) => ({ label: SKILL_GROUP_LABELS[g], skills: SKILLS_DICTIONARY.filter((s) => s.group === g).map((s) => s.name) })).filter((g) => g.skills.length > 0);

function applicantParams(q: Partial<ApplicantsQuery>): URLSearchParams {
  const params = new URLSearchParams();
  if (q.vacancyId) params.set('vacancyId', q.vacancyId);
  if (q.stage) params.set('stage', q.stage);
  if (q.minMatch !== null && q.minMatch !== undefined) params.set('minMatch', String(q.minMatch));
  if (q.minYears !== null && q.minYears !== undefined) params.set('minYears', String(q.minYears));
  if (q.source) params.set('source', q.source);
  if (q.filtered && q.filtered !== 'hide') params.set('filtered', q.filtered);
  if (q.q) params.set('q', q.q);
  if (q.minCvMatch !== null && q.minCvMatch !== undefined) params.set('minCvMatch', String(q.minCvMatch));
  if (q.sort) params.set('sort', q.sort);
  if (q.skill) params.set('skill', q.skill);
  return params;
}

export const applicantsApiPath = (q: Partial<ApplicantsQuery>) => {
  const s = applicantParams(q).toString();
  return s ? `/recruitment/applications?${s}` : '/recruitment/applications';
};

/** An applicants' list's address on the site: All Applicants, or a vacancy's page. */
export const applicantsHref = (base: string, q: Partial<ApplicantsQuery>) => {
  const params = applicantParams(base === APPLICANTS_PATH ? q : { ...q, vacancyId: '' });
  const s = params.toString();
  return s ? `${base}?${s}` : base;
};

// ---------- the vacancy's form ----------

/** What the vacancy form sends (POST, or PATCH with every field). */
export interface VacancyBody {
  jobTitleId: string;
  title: string;
  gradeId: string | null;
  hiringManagerId: string | null;
  headcount: number;
  employmentType: string;
  workArrangement: string;
  shiftId: string | null;
  durationMonths: number | null;
  closingDate: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  about: string | null;
  responsibilities: string | null;
  requirements: string | null;
  questions?: VacancyQuestion[];
  /** Up to 20 short skills looked for in each CV (owner, 22 October 2026: "make the OCR egine reads the CV and analyse it"). */
  keySkills: string[];
}

const field = (fd: FormData, name: string): string => {
  const v = fd.get(name);
  return typeof v === 'string' ? v.trim() : '';
};

/** A whole or decimal amount as typed ("15,000", "١٥٠٠٠" read by parseNumber's caller); NaN when it isn't one. */
function amountOf(text: string): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * The vacancy form read: its body, or what is wrong in words (the API checks every rule again). `withQuestions`: the
 * questions' editor was on the form (not once people have applied to a published vacancy).
 */
export function vacancyForm(fd: FormData, { withQuestions }: { withQuestions: boolean }): { body: VacancyBody | null; errors: string[] } {
  const errors: string[] = [];
  const jobTitleId = field(fd, 'jobTitleId');
  if (!jobTitleId) errors.push('Choose the job title.');
  const headcountText = field(fd, 'headcount') || '1';
  const headcount = Number(headcountText);
  if (!Number.isInteger(headcount)) errors.push('The headcount is how many people to hire: a whole number from 1 to 50.');
  const employmentType = field(fd, 'employmentType');
  if (!(EMPLOYMENT_TYPES as readonly string[]).includes(employmentType)) errors.push('Choose the employment type.');
  const workArrangement = field(fd, 'workArrangement') || 'office';
  if (!(WORK_ARRANGEMENTS as readonly string[]).includes(workArrangement)) errors.push('Choose where the work is done.');
  const durationText = field(fd, 'durationMonths');
  const durationMonths = durationText ? Number(durationText) : null;
  if (durationMonths !== null && !Number.isInteger(durationMonths)) errors.push('The contract length is in whole months, from 1 to 60.');
  const closingText = field(fd, 'closingDate');
  const closingDate = closingText ? parseDate(closingText) : null;
  if (closingDate === null && closingText) errors.push('Give the closing date as DD/MM/YYYY, or leave it empty.');
  const salaryMin = amountOf(field(fd, 'salaryMin'));
  const salaryMax = amountOf(field(fd, 'salaryMax'));
  if (Number.isNaN(salaryMin)) errors.push('Give the least salary as an amount, e.g. 15000, or leave it empty.');
  if (Number.isNaN(salaryMax)) errors.push('Give the most salary as an amount, e.g. 25000, or leave it empty.');
  const keySkills = keySkillsOf(field(fd, 'keySkills'));
  errors.push(...keySkillsProblems(keySkills));
  let questions: VacancyQuestion[] | undefined;
  if (withQuestions) {
    try {
      const parsed: unknown = JSON.parse(field(fd, 'questions') || '[]');
      questions = Array.isArray(parsed) ? (parsed as VacancyQuestion[]) : [];
    } catch {
      errors.push('The questions could not be read. Reload the page and try again.');
    }
  }
  if (errors.length) return { body: null, errors };
  const html = (name: string) => {
    const v = fd.get(name);
    return typeof v === 'string' && v.trim() ? v : null;
  };
  return {
    body: {
      jobTitleId,
      title: field(fd, 'title'),
      gradeId: field(fd, 'gradeId') || null,
      hiringManagerId: field(fd, 'hiringManagerId') || null,
      headcount,
      employmentType,
      workArrangement,
      shiftId: field(fd, 'shiftId') || null,
      durationMonths,
      closingDate: closingDate || null,
      salaryMin,
      salaryMax,
      about: html('about'),
      responsibilities: html('responsibilities'),
      requirements: html('requirements'),
      ...(questions !== undefined && { questions }),
      keySkills,
    },
    errors: [],
  };
}

// ---------- the questions' editor ----------

/** A key no question of these has: q1, q2 … the next after the highest. */
export function nextQuestionKey(questions: readonly { key: string }[]): string {
  const top = questions.reduce((n, q) => {
    const m = /^q(\d+)$/.exec(q.key);
    return m ? Math.max(n, Number(m[1])) : n;
  }, 0);
  return `q${top + 1}`;
}

/** A new question of a kind, with what that kind needs to start with. */
export function newQuestion(kind: QuestionKind, key: string): VacancyQuestion {
  const base = { key, kind, text: '', required: true, knockout: false };
  if (kind === 'yes_no') return { ...base, wanted: 'yes', points: 0 };
  if (kind === 'number') return { ...base, atLeast: null, points: 0 };
  if (kind === 'choice') {
    return {
      ...base,
      options: [
        { label: '', points: 0, accepted: true },
        { label: '', points: 0, accepted: true },
      ],
    };
  }
  return { ...base, required: false };
}

/** A question turned into another kind: its words and whether it is required kept. */
export const withKind = (q: VacancyQuestion, kind: QuestionKind): VacancyQuestion => ({ ...newQuestion(kind, q.key), text: q.text, required: kind === 'text' ? q.required : q.required || q.knockout });

export const isQuestionKind = (v: string): v is QuestionKind => (QUESTION_KINDS as readonly string[]).includes(v);

/** A list with one item moved up (-1) or down (+1); as it was at an end. */
export function moved<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return [...list];
  const out = [...list];
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

// ---------- the channels ----------

/** The channels' links of a vacancy, each the careers page's address with its ?src= (never a general CV's: HR's move only). */
export function channelLinks(origin: string, slug: string): { source: ApplicationChannel; href: string }[] {
  return APPLICATION_CHANNELS.map((source) => ({ source, href: `${origin}${careersPath(slug, source)}` }));
}

// ---------- Make offer ----------

const ARABIC = /[؀-ۿ]/;

/**
 * The job offer's form filled in from the applicant and their vacancy (Make offer): the name in the language it is
 * written in (the other to type), the email and mobile, the position; everything else as a new offer starts.
 */
export function offerFromApplication<D extends {
  fullNameEn: string;
  fullNameAr: string;
  email: string;
  mobile: string;
  employmentType: string;
  departmentId: string;
  jobTitleId: string;
  gradeId: string;
  managerId: string;
  shiftId: string;
  workArrangement: string;
  durationMonths: number;
  note: string;
}>(base: D, a: Pick<ApplicationView, 'number' | 'fullName' | 'email' | 'mobile' | 'position'>): D {
  const arabic = ARABIC.test(a.fullName);
  return {
    ...base,
    fullNameEn: arabic ? '' : a.fullName,
    fullNameAr: arabic ? a.fullName : '',
    email: a.email,
    mobile: a.mobile,
    employmentType: a.position.employmentType,
    departmentId: a.position.departmentId ?? '',
    jobTitleId: a.position.jobTitleId,
    gradeId: a.position.gradeId ?? '',
    managerId: a.position.hiringManagerId ?? '',
    shiftId: a.position.shiftId ?? '',
    workArrangement: a.position.workArrangement,
    durationMonths: a.position.durationMonths ?? base.durationMonths,
    note: base.note || (shownCode(a.number) ? `From applicant ${a.number}` : 'From their application'),
  };
}

/** The stage chips of an applicants' list: every stage, in order. */
export const STAGE_FILTERS: readonly ApplicationStage[] = APPLICATION_STAGES;

export const VACANCY_STATUS_STYLE: Record<(typeof VACANCY_STATUSES)[number], string> = {
  draft: 'bg-canvas text-muted',
  pending: 'bg-warn-soft text-warn',
  open: 'bg-ok-soft text-ok',
  on_hold: 'bg-warn-soft text-warn',
  closed: 'bg-canvas text-muted',
  filled: 'bg-accent-soft text-accent',
};

export const STAGE_STYLE: Record<ApplicationStage, string> = {
  applied: 'bg-canvas text-ink',
  shortlisted: 'bg-accent-soft text-accent',
  interview: 'bg-accent-soft text-accent',
  offer: 'bg-warn-soft text-warn',
  hired: 'bg-ok-soft text-ok',
  rejected: 'bg-danger-soft text-danger',
};

/** "90%", or "—" without scored questions. */
export const matchText = (percent: number | null) => (percent === null ? '—' : `${percent}%`);
