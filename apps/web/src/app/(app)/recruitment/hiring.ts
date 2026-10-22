import {
  boardMove,
  FEEDBACK_CRITERIA,
  INTERVIEW_KINDS,
  isHiringSuggestion,
  isRecommendation,
  type ApplicationStage,
  type BoardCard,
  type BoardMove,
  type FeedbackCriterion,
  type InterviewKind,
  type InterviewSaved,
  type Recommendation,
} from '@trendlix/shared';
import { formatDateTime, parseDate, parseTime } from '../../../lib/format';
import { vacancyHref } from './recruitment';

// Recruitment on the site, Phase 2 (owner, 22 October 2026: "where will we include the ATS?"; "interview invites go by
// email through the owner's SMTP settings"): the addresses, the board's drops, the interview and scorecard forms, the
// suggestion, the rejection's email tick, the analytics' filters and the words for what an email did. Pure code
// (relative imports), tested in hiring.test.ts; the API checks everything again.

export const INTERVIEWS_PATH = '/recruitment/interviews';
export const MY_HIRING_PATH = '/recruitment/my-hiring';
export const ANALYTICS_PATH = '/recruitment/analytics';
export const SETTINGS_PATH = '/recruitment/settings';
export const ONBOARDING_PATH = '/onboarding';
export const ONBOARDING_CHECKLIST_PATH = '/onboarding/checklist';

export const onboardingHref = (id: string) => `${ONBOARDING_PATH}/${encodeURIComponent(id)}`;
/** A vacancy's page showing its pipeline board (the list stays its default). */
export const boardHref = (vacancyId: string) => `${vacancyHref(vacancyId)}?view=board`;
export const analyticsExcelHref = (q: AnalyticsQuery) => `${ANALYTICS_PATH}/excel${analyticsSearch(q)}`;

// ---------- the board ----------

/** What dropping a card on a column does (shared boardMove), with the card's own state. */
export const dropOn = (card: Pick<BoardCard, 'stage' | 'filteredOut' | 'openOffer'>, to: ApplicationStage): BoardMove =>
  boardMove(card.stage, to, { filteredOut: card.filteredOut, openOffer: card.openOffer });

/** "3 days", "1 day", "Today". */
export const daysText = (days: number) => (days <= 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`);

// ---------- interviews ----------

/** What scheduling (or moving) an interview sends. */
export interface InterviewBody {
  date: string;
  time: string;
  minutes: number;
  kind: InterviewKind;
  location: string | null;
  interviewerIds: string[];
  note: string | null;
}

const text = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === 'string' ? v.trim() : '';
};

/**
 * The interview form read: the day (DD/MM/YYYY), the time (the 12-hour picker's "10:30 AM"), its length, how it is held,
 * where, the interviewers ticked and the note; every problem the form itself can see, in words (the API checks the rest).
 */
export function interviewForm(fd: FormData): { body: InterviewBody | null; errors: string[] } {
  const errors: string[] = [];
  const date = parseDate(text(fd, 'date'));
  const time = parseTime(text(fd, 'time'));
  if (!date) errors.push('Choose the day of the interview, as DD/MM/YYYY.');
  if (!time) errors.push('Choose the time of the interview.');
  const minutes = Number(text(fd, 'minutes'));
  if (!Number.isInteger(minutes) || minutes < 15) errors.push('Choose how long it takes.');
  const kind = text(fd, 'kind');
  if (!(INTERVIEW_KINDS as readonly string[]).includes(kind)) errors.push('Choose how it is held.');
  const interviewerIds = fd.getAll('interviewerIds').filter((v): v is string => typeof v === 'string' && v !== '');
  if (!interviewerIds.length) errors.push('Choose who interviews them.');
  if (errors.length) return { body: null, errors };
  return {
    body: { date: date!, time: time!, minutes, kind: kind as InterviewKind, location: text(fd, 'location') || null, interviewerIds, note: text(fd, 'note') || null },
    errors: [],
  };
}

/** What the page says about the candidate's email once an interview is saved, moved or cancelled. */
export function emailText(email: InterviewSaved['email']): string {
  switch (email) {
    case 'sent':
      return 'The candidate was emailed, with the calendar invitation.';
    case 'not_set_up':
      return 'Saved. Email isn’t set up on the server, so tell the candidate yourself.';
    case 'failed':
      return 'Saved, but the email provider refused the email: tell the candidate yourself.';
    case 'not_sent':
      return 'Saved.';
  }
}

/** When an interview is, as the pages show it: "29/10/2026, 10:30 AM · 45 minutes". */
export const interviewWhen = (startsAt: string, minutes: number) => `${formatDateTime(startsAt)} · ${minutes} minutes`;

// ---------- scorecards ----------

export interface FeedbackBody {
  ratings: Record<FeedbackCriterion, number>;
  recommendation: Recommendation;
  notes: string | null;
}

/** The scorecard form read: a rating from 1 to 5 for each criterion, the recommendation, the notes. */
export function feedbackForm(fd: FormData): { body: FeedbackBody | null; errors: string[] } {
  const errors: string[] = [];
  const ratings = {} as Record<FeedbackCriterion, number>;
  for (const c of FEEDBACK_CRITERIA) {
    const n = Number(text(fd, `rating_${c}`));
    if (!Number.isInteger(n) || n < 1 || n > 5) errors.push('Rate every criterion from 1 to 5.');
    else ratings[c] = n;
  }
  const recommendation = text(fd, 'recommendation');
  if (!isRecommendation(recommendation)) errors.push('Choose your recommendation.');
  const unique = [...new Set(errors)];
  if (unique.length) return { body: null, errors: unique };
  return { body: { ratings, recommendation: recommendation as Recommendation, notes: text(fd, 'notes') || null }, errors: [] };
}

// ---------- the hiring manager's suggestion, the rejection ----------

export function suggestionForm(fd: FormData): { body: { suggestion: 'next' | 'reject'; note: string | null } | null; errors: string[] } {
  const suggestion = text(fd, 'suggestion');
  if (!isHiringSuggestion(suggestion)) return { body: null, errors: ['Suggest the next step or a rejection.'] };
  return { body: { suggestion, note: text(fd, 'note') || null }, errors: [] };
}

/** What the page says once someone is rejected, by what their email did. */
export function rejectedText(emailed: string | undefined): string {
  if (emailed === 'sent') return 'Rejected. The candidate was emailed.';
  if (emailed === 'not_set_up') return 'Rejected. Email isn’t set up on the server, so nothing was sent.';
  if (emailed === 'failed') return 'Rejected, but the email provider refused the email.';
  return 'Rejected.';
}

// ---------- the analytics ----------

export interface AnalyticsQuery {
  year: number;
  departmentId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

/** The year (this one unless a year from 2000 is asked) and the department, as the address carries them. */
export function readAnalyticsQuery(query: Record<string, string | string[] | undefined>, today: string): AnalyticsQuery {
  const thisYear = Number(today.slice(0, 4));
  const year = Number(one(query.year));
  const departmentId = one(query.departmentId);
  return { year: Number.isInteger(year) && year >= 2000 && year <= thisYear + 1 ? year : thisYear, departmentId: UUID.test(departmentId) ? departmentId : '' };
}

export function analyticsSearch(q: AnalyticsQuery): string {
  const params = new URLSearchParams({ year: String(q.year) });
  if (q.departmentId) params.set('departmentId', q.departmentId);
  return `?${params.toString()}`;
}

/** "12.5 days", or "—" with none. */
export const daysFigure = (days: number | null) => (days === null ? '—' : `${days} ${days === 1 ? 'day' : 'days'}`);

/** "66.7%", or "—" with none. */
export const percentFigure = (percent: number | null) => (percent === null ? '—' : `${percent}%`);
