import {
  AGENCY_BACKGROUND_LABELS,
  AGENCY_BACKGROUNDS,
  AGENCY_FIT_WEIGHTS,
  agencyMonthsText,
  companyKey,
  EX_AGENCY_LABEL,
  exAgencyText,
  type AgencyBackground,
  type AgencyBackgroundWanted,
  type AgencyJob,
  type CvListFacts,
  type CvWorkEntry,
} from '@trendlix/shared';
import { isHidden } from '../../../lib/hidden';

// Marketing agency background on the site (owner, 27 October 2026: "when opening a job, can the OCR detect if his previous
// works are in agency?", then "i need a flag if the candidate is ex marketing agencies or not AND reflectin the scoring";
// asked, he chose "Name words + your list", "Show agency years", "Set per job" and "Yes or no"; packages/shared
// marketing-agencies.ts): the vacancy form's "Agency background" (Required / Preferred / Not needed) and its line on the
// vacancy's page; the CV card's flag ("Ex-agency · 3 y 4 m"), each job of the work history marked agency or not, with
// HR's Mark as agency / Not an agency / Remove mark; the lists' "Ex-agency" badge; and Recruitment Settings' Marketing
// Agencies, HR's marks. Pure code (relative imports), tested in agency.test.ts; the API tells each CV's background and
// checks every rule again.

// ---------- the vacancy's "Agency background" ----------

/** The vacancy form's field. */
export const AGENCY_BACKGROUND_FIELD = 'agencyBackground';

/** Under the choice, its weights from the rules themselves. */
export const AGENCY_BACKGROUND_HINT = `How much marketing agency experience counts in the CV match: Required weighs ${AGENCY_FIT_WEIGHTS.required}, Preferred ${AGENCY_FIT_WEIGHTS.preferred}, Not needed leaves it out.`;

const isAgencyBackground = (value: string): value is AgencyBackgroundWanted => (AGENCY_BACKGROUNDS as readonly string[]).includes(value);

/** The choice sent: required, preferred or not needed; null for anything else (left out: the API keeps it, or its default). */
export const vacancyAgencyBackgroundOf = (value: string): AgencyBackgroundWanted | null => (isAgencyBackground(value) ? value : null);

/** The choices in order, with their labels. */
export const agencyBackgroundChoices = (): { value: AgencyBackgroundWanted; label: string }[] => AGENCY_BACKGROUNDS.map((value) => ({ value, label: AGENCY_BACKGROUND_LABELS[value] }));

/**
 * A vacancy's agency background in a line, for its page: "Preferred · weighs 10 in the CV match", "Not needed · left out
 * of the CV match"; null from an API before it.
 */
export function agencyBackgroundText(wanted: AgencyBackgroundWanted | null | undefined): string | null {
  if (!wanted || !isAgencyBackground(wanted)) return null;
  const weight = AGENCY_FIT_WEIGHTS[wanted];
  return `${AGENCY_BACKGROUND_LABELS[wanted]} · ${weight ? `weighs ${weight} in the CV match` : 'left out of the CV match'}`;
}

// ---------- the CV card ----------

/** The months at agencies on hover: "3 y 4 m at marketing agencies", or why there are none to tell. */
function monthsTitle(months: number): string {
  return months > 0 ? `${agencyMonthsText(months)} at marketing agencies in all, each month counted once` : 'At a marketing agency; its dates weren’t read';
}

/**
 * The CV card's flag (owner: "Show agency years"): "Ex-agency · 3 y 4 m", or "Not ex-agency" when no job of the work
 * history is at a marketing agency; null when not told (no work history read, or an API before it).
 */
export function agencyFlag(agency: AgencyBackground | null | undefined): { text: string; exAgency: boolean; title: string } | null {
  if (!agency) return null;
  if (!agency.exAgency) return { text: `Not ${EX_AGENCY_LABEL.toLowerCase()}`, exAgency: false, title: 'No marketing agency in the work history' };
  return { text: exAgencyText(agency) ?? EX_AGENCY_LABEL, exAgency: true, title: monthsTitle(agency.months) };
}

/**
 * A job's badge: "Agency" (its name says so), "Agency (marked)" or "Not an agency (marked)" (HR's mark, which wins over
 * the name); null for a company nothing says is one.
 */
export function agencyJobBadge(job: Pick<AgencyJob, 'agency' | 'by'> | null | undefined): { text: string; agency: boolean; title: string } | null {
  if (!job) return null;
  if (job.by === 'mark') return { text: job.agency ? 'Agency (marked)' : 'Not an agency (marked)', agency: job.agency, title: 'Marked by HR: wins over its name' };
  if (job.agency) return { text: 'Agency', agency: true, title: 'Its name says marketing agency' };
  return null;
}

/**
 * Each job of the work history as the card lists it (moreFromCv) with its mark from the API's agency background: the
 * same jobs in the same order (those with a title or a company), each paired only when its company is the same; null
 * where not (or not told).
 */
export function agencyJobsFor(workHistory: readonly Pick<CvWorkEntry, 'pastCompany'>[], agency: AgencyBackground | null | undefined): (AgencyJob | null)[] {
  const jobs = agency?.jobs ?? [];
  return workHistory.map((w, i) => {
    const j = jobs[i];
    return j && (j.pastCompany ?? null) === (w.pastCompany ?? null) ? j : null;
  });
}

/** Whether any job has a company HR can mark: one named, and not hidden from a developer. */
export const hasMarkableCompany = (jobs: readonly (Pick<AgencyJob, 'pastCompany'> | null)[]): boolean => jobs.some((j) => !!j?.pastCompany?.trim() && !isHidden(j.pastCompany));

/** How many of the jobs are at marketing agencies, for the work history's fold. */
export const agencyJobCount = (jobs: readonly (Pick<AgencyJob, 'agency'> | null)[]): number => jobs.filter((j) => j?.agency).length;

/** What HR can do on a job of the work history: mark its company an agency or not one, or remove its mark. */
export type MarkAction =
  | { kind: 'set'; company: string; agency: boolean; label: string; pendingLabel: string; confirm: string }
  | { kind: 'remove'; id: string; label: string; pendingLabel: string; confirm: string };

/** The confirmation of a mark: it counts in every CV naming the company, whose CV matches are worked out again. */
export function markConfirmText(company: string, agency: boolean): string {
  return `Mark “${company}” as ${agency ? 'a marketing agency' : 'not a marketing agency'}? It counts for every CV that names it, and their CV matches are worked out again.`;
}

export const removeMarkConfirmText = (company: string) => `Remove the mark on “${company}”? Its name’s words decide again, for every CV that names it.`;

/**
 * A job's actions for HR (and a Super Admin): the mark that changes what it is now (Mark as agency, or Not an agency), and
 * Remove mark when HR marked it (its id known); none without a company, or with one hidden from a developer.
 */
export function markActionsFor(company: string | null | undefined, job: Pick<AgencyJob, 'agency' | 'by'> | null, markId: string | null): MarkAction[] {
  const name = company?.trim();
  if (!name || isHidden(name) || !job) return [];
  const agency = !job.agency;
  const actions: MarkAction[] = [{ kind: 'set', company: name, agency, label: agency ? 'Mark as agency' : 'Not an agency', pendingLabel: 'Saving…', confirm: markConfirmText(name, agency) }];
  if (job.by === 'mark' && markId) actions.push({ kind: 'remove', id: markId, label: 'Remove mark', pendingLabel: 'Removing…', confirm: removeMarkConfirmText(name) });
  return actions;
}

// ---------- the lists ----------

/**
 * The lists' badge (owner: "i need a flag if the candidate is ex marketing agencies or not"): "Ex-agency" with its months
 * on hover; null for one not ex-agency, not told, or from an API before it.
 */
export function exAgencyChip(fromCv: Pick<CvListFacts, 'exAgency' | 'agencyMonths'> | null | undefined): { text: string; title: string } | null {
  if (!fromCv?.exAgency) return null;
  return { text: EX_AGENCY_LABEL, title: monthsTitle(fromCv.agencyMonths ?? 0) };
}

// ---------- Recruitment Settings' Marketing Agencies (HR's marks) ----------

/** A mark as the API sends it (GET /recruitment/agency-marks; apps/api agency-marks.service.ts). */
export interface AgencyMarkView {
  id: string;
  /** The company as HR wrote it last. */
  name: string;
  /** True: a marketing agency; false: not one, whatever its name says. */
  agency: boolean;
  /** What its name's words alone say. */
  byName: boolean;
  updatedAt: string;
}

export const AGENCY_MARKS_API = '/recruitment/agency-marks';
export const agencyMarkApiPath = (id: string) => `${AGENCY_MARKS_API}/${encodeURIComponent(id)}`;

/** The settings' section, linked from the CV card. */
export const AGENCY_MARKS_HREF = '/organization/recruitment#marketing-agencies';

/** The section's explanation. */
export const AGENCY_MARKS_NOTE =
  'Past employers in a CV are recognised as marketing agencies by the words in their names (Agency, Advertising, Creative, Studio, Media, Digital, PR, وكالة, دعاية, إعلان …), never travel, recruitment, real estate, insurance, shipping or news agencies. A company marked here wins over its name.';

/** A mark in words. */
export const markText = (agency: boolean) => (agency ? 'Agency' : 'Not an agency');

/** When the name alone would say otherwise: "Its name says agency", "Its name doesn’t say agency"; null when they agree. */
export function markNote(m: Pick<AgencyMarkView, 'agency' | 'byName'>): string | null {
  if (m.agency === m.byName) return null;
  return m.byName ? 'Its name says agency' : 'Its name doesn’t say agency';
}

/** The id of HR's mark on a company, by its name as compared (any case, spacing or Arabic letter form); null without one. */
export function markIdOf(marks: readonly Pick<AgencyMarkView, 'id' | 'name'>[], company: string | null | undefined): string | null {
  const key = company ? companyKey(company) : '';
  if (!key) return null;
  return marks.find((m) => companyKey(m.name) === key)?.id ?? null;
}

/** The add form's fields. */
export const MARK_FIELDS = { company: 'company', agency: 'agency' } as const;
const COMPANY_LIMIT = 200;

/** The add form read: the company and whether it is a marketing agency, or what is wrong in words (the API checks again). */
export function agencyMarkForm(fd: FormData): { body: { company: string; agency: boolean } | null; errors: string[] } {
  const raw = fd.get(MARK_FIELDS.company);
  const company = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  const choice = fd.get(MARK_FIELDS.agency);
  const errors: string[] = [];
  if (company.length < 2 || !companyKey(company)) errors.push('Write the company’s name, e.g. Publicis Egypt.');
  else if (company.length > COMPANY_LIMIT) errors.push(`Keep the company’s name to ${COMPANY_LIMIT} characters or fewer.`);
  if (choice !== 'yes' && choice !== 'no') errors.push('Choose whether it is a marketing agency.');
  if (errors.length) return { body: null, errors };
  return { body: { company, agency: choice === 'yes' }, errors: [] };
}

/** What was saved, in words. */
export const markSavedText = (company: string, agency: boolean) => `Saved: “${company}” is ${agency ? 'a marketing agency' : 'not a marketing agency'}.`;
