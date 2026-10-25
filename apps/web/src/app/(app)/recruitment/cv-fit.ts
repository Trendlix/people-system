import {
  addedWithoutAnswers,
  cvFitLine,
  cvFitPartDetail,
  KEY_SKILLS_LIMITS,
  keySkillsOf,
  suggestKeySkills,
  type CvFit,
  type OpenPositionFit,
  type ScreeningCv,
} from '@trendlix/shared';
import { matchText, vacancyEditHref } from './recruitment';

// The CV fit on the site (owner, 25 October 2026, on the Marketing Manager vacancy's applicants added from Suggested From
// Earlier CVs: "aren't you supposed to match the candidate to the job based on the CV and ATS?"; asked, "Full CV fit
// score"; packages/shared cv-fit.ts): the CV match % with its breakdown, the Match column's fallback for those never asked
// the screening questions ("72% · CV"), the CV Fit section's rows, the other open positions a CV fits ("and if it
// recomended to another position based on the CV"), and the key skills suggested on the vacancy's form. Pure code
// (relative imports), tested in cv-fit.test.ts; the API works the fit out and checks everything again.

/** The Match cell's tooltip when it shows the CV fit: the screening questions weren't asked. */
export const NOT_ASKED_TITLE = 'Not asked the screening questions: the CV match';

/**
 * The Match cell (the screening questions' match): its %, else, for one never asked them (added from the suggestions or
 * by HR, or a vacancy without questions), the CV fit's muted with "· CV" ("72% · CV", as Experience shows "≈ 8 y · CV");
 * else "—" (one added from the suggestions whose CV isn't read yet says why on hover).
 */
export function matchCell(a: { matchPercent: number | null; cvMatchPercent: number | null; source?: string }): { text: string; fromCv: boolean; title: string | null } {
  if (a.matchPercent !== null) return { text: matchText(a.matchPercent), fromCv: false, title: null };
  if (a.cvMatchPercent !== null) return { text: `${matchText(a.cvMatchPercent)} · CV`, fromCv: true, title: NOT_ASKED_TITLE };
  return { text: '—', fromCv: false, title: a.source && addedWithoutAnswers(a.source) ? 'Not asked the screening questions, and the CV isn’t read yet' : null };
}

/** The breakdown on hover: "Key skills 4 of 6 · Title close (Digital Marketing Manager) · 8 y vs 5–8 · …"; null without a fit. */
export const fitTitle = (fit: CvFit | null | undefined): string | null => (fit ? cvFitLine(fit) : null);

/** The CV Fit section's rows: each part's name, its score, its share of the fit and what it found. */
export function fitRows(fit: CvFit): { key: string; label: string; score: string; weight: string; detail: string }[] {
  return fit.parts.map((p) => ({
    key: p.key,
    label: p.label,
    score: `${Math.round(p.score)}%`,
    weight: `${Number.isInteger(p.weight) ? p.weight : p.weight.toFixed(1)}% of the fit`,
    detail: cvFitPartDetail(p),
  }));
}

/** The CV Fit section's summary under its heading: why the parts left out are, in a line. */
export function fitSummary(fit: CvFit): string {
  if (fit.percent === null) return cvFitLine(fit);
  const left = fit.parts.length < 5 ? ' The parts that couldn’t be scored are left out, the others re-weighted to 100.' : '';
  return `${fit.percent}% from the parts below.${left}`;
}

/** An open position's hover: its breakdown, else its percent. */
export const openPositionTitle = (p: Pick<OpenPositionFit, 'percent' | 'fit'>): string => (p.fit ? cvFitLine(p.fit) : `${p.percent}%`);

/** The CV an open position is added from: an applicant's, or a general CV's. */
export type FitRecord = { applicationId: string } | { generalCvId: string };

/** A CV window's CV as Add to this vacancy names it: a general CV moved to a vacancy by its application. */
export function recordOfCv(cv: Pick<ScreeningCv, 'kind' | 'id' | 'linkedKey'>): FitRecord {
  if (cv.kind === 'general_cv' && cv.linkedKey?.startsWith('application:')) return { applicationId: cv.linkedKey.slice('application:'.length) };
  return cv.kind === 'application' ? { applicationId: cv.id } : { generalCvId: cv.id };
}

/**
 * On the candidate's page (their CVs' best for each vacancy): the CV the position names (the API's `record`), else the
 * CV whose own Other Open Positions has that vacancy; null when none is known: then no Add there.
 */
export function recordFor(vacancyId: string, cvs: readonly Pick<ScreeningCv, 'kind' | 'id' | 'linkedKey' | 'openPositions'>[], positions: readonly Pick<OpenPositionFit, 'vacancy' | 'record'>[] = []): FitRecord | null {
  const named = positions.find((p) => p.vacancy.id === vacancyId)?.record;
  if (named) return named.kind === 'application' ? { applicationId: named.id } : { generalCvId: named.id };
  const cv = cvs.find((c) => c.openPositions?.some((p) => p.vacancy.id === vacancyId));
  return cv ? recordOfCv(cv) : null;
}

/** What the Other Open Positions section says with none. */
export const NO_OPEN_POSITIONS = 'No other open vacancy fits this CV at 50% or more.';

// ---------- the key skills suggested (vacancy form) ----------

/** The vacancy page's note when it lists none, before its link "Suggest key skills". */
export const NO_KEY_SKILLS_NOTE = 'No key skills listed: the CV match uses the title, years and requirements only.';

/** The edit form, suggesting key skills as it opens. */
export const suggestKeySkillsHref = (vacancyId: string) => `${vacancyEditHref(vacancyId)}?suggest=1`;

/** Whether the form was opened to suggest key skills (?suggest=1). */
export const wantsSuggestion = (query: Record<string, string | string[] | undefined>): boolean => {
  const v = query.suggest;
  return (Array.isArray(v) ? v[0] : v) === '1';
};

/** A job title's name from its picker label ("Video Editor — Production · Video" → "Video Editor"). */
export const jobTitleName = (label: string | null | undefined): string | null => (label ? label.split(' — ')[0].trim() || null : null);

/** The key skills as typed (commas, Arabic commas or lines), each once, in order. */
export const typedKeySkills = (text: string): string[] => keySkillsOf(text);

/**
 * The chips after a suggestion: those kept, then each suggested one not there yet (any case), up to 20; and how many were
 * added. Nothing is saved until HR saves the form.
 */
export function withSuggested(current: readonly string[], suggested: readonly string[]): { skills: string[]; added: number } {
  const skills = keySkillsOf([...current]);
  const seen = new Set(skills.map((s) => s.toLowerCase()));
  let added = 0;
  for (const s of keySkillsOf([...suggested])) {
    if (skills.length >= KEY_SKILLS_LIMITS.max) break;
    if (seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    skills.push(s);
    added++;
  }
  return { skills, added };
}

/** The key skills suggested from what the form says: its title, its job title's name, and its texts (HTML). */
export const suggestedFrom = (f: { title: string; jobTitle: string | null; about: string; responsibilities: string; requirements: string }): string[] =>
  suggestKeySkills({ title: f.title || f.jobTitle || '', jobTitle: f.jobTitle, about: f.about, responsibilities: f.responsibilities, requirements: f.requirements });

/**
 * The chips as the form opens: its key skills; opened to suggest them (?suggest=1) with none listed, those suggested
 * from its saved title and texts, and what was suggested in words.
 */
export function openingKeySkills(
  d: { keySkills: string[]; title: string; about: string; responsibilities: string; requirements: string },
  jobTitle: string | null,
  suggest: boolean,
): { skills: string[]; note: string | null } {
  if (!suggest || d.keySkills.length) return { skills: d.keySkills, note: null };
  const found = suggestedFrom({ title: d.title, jobTitle, about: d.about, responsibilities: d.responsibilities, requirements: d.requirements });
  const next = withSuggested([], found);
  return { skills: next.skills, note: suggestedText(next.added, found.length) };
}

/** What the suggestion did, in words, for HR to check before saving. */
export function suggestedText(added: number, found: number): string {
  if (!found) return 'Nothing to suggest from the title and texts: add the key skills yourself.';
  if (!added) return 'The suggested key skills are listed already.';
  return `${added} key ${added === 1 ? 'skill' : 'skills'} suggested from the title and texts: remove any that don’t fit, then save.`;
}
