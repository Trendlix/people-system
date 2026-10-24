import {
  isSuggestionStatus,
  reasonText,
  SUGGESTION_STATUS_LABELS,
  SUGGESTION_STATUSES,
  type SuggestionReason,
  type SuggestionStatus,
  type VacancySuggestions,
  type VacancySuggestionView,
} from '@trendlix/shared';
import { formatDate } from '../../../lib/format';
import { isHidden, shownCode } from '../../../lib/hidden';
import { vacancyHref } from './recruitment';

// Suggested From Earlier CVs on a vacancy's page (owner, 24 October 2026: "does the system automatically add recomended
// general cv's to the opened posts?"; asked, "Suggest; HR adds", "General CVs + past applicants", "Yes, HR presses
// 'Invite to apply'"; packages/shared suggested-cvs.ts): the addresses, the status filter, where each came from, its
// reasons as chips, what was decided, and the words of the invitation's confirmation. Pure code (relative imports),
// tested in suggestions.test.ts; the API checks everything again.

/** The vacancy page's view of its suggestions (?view=suggested), beside the list and the board. */
export const SUGGESTED_VIEW = 'suggested';

/** The status filter's chips, in order: suggested first, then what HR decided. */
export const SUGGESTION_FILTERS: readonly SuggestionStatus[] = SUGGESTION_STATUSES;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

/** The status shown, as the address carries it (?suggestions=): suggested unless another. */
export const readSuggestionStatus = (query: Record<string, string | string[] | undefined>): SuggestionStatus => {
  const s = one(query.suggestions);
  return isSuggestionStatus(s) ? s : 'suggested';
};

/** A vacancy's suggestions on its page, at a status (suggested: the address without it). */
export function suggestionsHref(vacancyId: string, status: SuggestionStatus = 'suggested'): string {
  const params = new URLSearchParams({ view: SUGGESTED_VIEW });
  if (status !== 'suggested') params.set('suggestions', status);
  return `${vacancyHref(vacancyId)}?${params.toString()}`;
}

export const suggestionsApiPath = (vacancyId: string, status: SuggestionStatus) =>
  `/recruitment/vacancies/${encodeURIComponent(vacancyId)}/suggestions${status === 'suggested' ? '' : `?status=${status}`}`;

/** The view's chip: "Suggested From Earlier CVs (5)"; without a count while it isn't known. */
export const suggestedViewLabel = (count: number | null | undefined) => `Suggested From Earlier CVs${typeof count === 'number' ? ` (${count})` : ''}`;

/** A status chip: "Invited (2)". */
export const statusChip = (status: SuggestionStatus, counts: Partial<Record<SuggestionStatus, number>>) => `${SUGGESTION_STATUS_LABELS[status]} (${counts[status] ?? 0})`;

/**
 * Where it came from: "General CV APP-2026-0007 · Video · Production, 03/09/2026", or "Applied for Motion Designer on
 * 12/05/2026" (a developer's code left out); "The earlier CV has gone" when it was deleted since.
 */
export function sourceText(row: Pick<VacancySuggestionView, 'source'>): string {
  const s = row.source;
  if (!s) return 'The earlier CV has gone';
  if (s.kind === 'general_cv') {
    const ref = shownCode(s.number);
    const area = isHidden(s.area) ? null : s.area;
    return `General CV${ref ? ` ${ref}` : ''}${area ? ` · ${area}` : ''}, ${formatDate(s.receivedAt)}`;
  }
  return `Applied for ${s.vacancy.title} on ${formatDate(s.appliedAt)}`;
}

/** A reason as its chip: the words and whether it is muted (years below the least asked). */
export function reasonChips(reasons: readonly SuggestionReason[]): { key: string; text: string; muted: boolean; title: string | null }[] {
  return reasons.map((r, i) => ({
    key: `${r.kind}-${i}`,
    text: reasonText(r),
    muted: r.kind === 'experience' && r.met === false,
    // the key skills found, on hover
    title: r.kind === 'skills' ? r.found.join(', ') : null,
  }));
}

/** The score as shown: "84". */
export const scoreText = (score: number) => String(Math.max(0, Math.min(100, Math.round(score))));

/** What was decided, in a line: "Invited on 24/10/2026 at mona@example.com", "Added on 24/10/2026 (APP-2026-0012)" … */
export function decisionText(row: Pick<VacancySuggestionView, 'status' | 'decidedAt' | 'invitedAt' | 'sentTo' | 'application' | 'decidedBy'>): string | null {
  const by = row.decidedBy ? ` by ${row.decidedBy.name ?? row.decidedBy.email}` : '';
  const ref = shownCode(row.application?.number);
  if (row.status === 'invited') return `Invited on ${formatDate(row.invitedAt ?? row.decidedAt)}${row.sentTo ? ` at ${row.sentTo}` : ''}${by}`;
  if (row.status === 'added') return `Added on ${formatDate(row.decidedAt)}${ref ? ` (${ref})` : ''}${by}`;
  if (row.status === 'applied') return `Applied on ${formatDate(row.decidedAt)}${ref ? ` (${ref})` : ''}${row.invitedAt ? ', invited before' : ''}`;
  if (row.status === 'dismissed') return `Dismissed on ${formatDate(row.decidedAt)}${by}`;
  return null;
}

/** "Email Mona Example at mona@example.com an invitation to apply for Video Editor?" before Invite to apply. */
export const inviteConfirmText = (row: Pick<VacancySuggestionView, 'candidate' | 'email'>, jobTitle: string) =>
  `Email ${row.candidate.fullName}${row.email ? ` at ${row.email}` : ''} an invitation to apply for ${jobTitle}? It has the job's apply link; they apply themselves.`;

/** Why none are worked out for the vacancy now, in words; null when they are. */
export function pausedText(s: Pick<VacancySuggestions, 'paused' | 'recencyMonths'>): string | null {
  if (s.paused === 'c_level') return 'Earlier CVs are never suggested for a C-level vacancy.';
  if (s.paused === 'not_open') return 'Not worked out while the vacancy isn’t taking applications: those kept are shown.';
  return null;
}

/** What the list says it holds: "General CVs and past applicants of the last 12 months, best first." */
export const poolText = (recencyMonths: number) =>
  `General CVs and earlier applicants for other jobs from the last ${recencyMonths} ${recencyMonths === 1 ? 'month' : 'months'}, best first. Nobody joins the vacancy until you add them.`;

/** What a status filter with nobody says. */
export const emptyText = (status: SuggestionStatus) =>
  status === 'suggested' ? 'No earlier CVs match this vacancy now.' : `Nobody ${SUGGESTION_STATUS_LABELS[status].toLowerCase()} yet.`;

/** What Add to this vacancy did. */
export const addedText = (number: string | null | undefined) => `Added to the vacancy${shownCode(number) ? ` as ${number}` : ''}, at Applied.`;
