import {
  aboutKey,
  filteredComments,
  GENERAL_KEY,
  recordComments,
  SCREENING_LIMITS,
  SCREENING_VERDICT_LABELS,
  screeningCommentProblems,
  uniqueMentions,
  type CandidateCv,
  type ScreeningCommentView,
  type ScreeningComments,
  type ScreeningCv,
  type ScreeningPerson,
  type ScreeningTarget,
  type ScreeningVerdict,
} from '@trendlix/shared';
import { shownCode } from '../../../lib/hidden';
import { generalCvFileHref } from './general';
import { applicantCvHref, applicantHref } from './recruitment';

// CVs in a pop-up window and screening comments on the site (owner, 24 October 2026, on a candidate's profile: "when
// opening a CV, open it in a popup window", "is there a way to add screening comments?", "and i can add genearrl
// comments"; asked, "Yes: Good fit / Maybe / Not a fit" and "HR + hiring manager & interviewers"; packages/shared
// screening.ts): the CV window's addresses, its previous and next, the ?cv= it is opened by; the comments' badges,
// filters, form and @mentions. Pure code (relative imports), tested in screening.test.ts; the API checks every rule
// again.

// ---------- the verdict ----------

/** The verdict's badge: Good fit green, Maybe amber, Not a fit red. */
export const VERDICT_STYLE: Record<ScreeningVerdict, string> = {
  good_fit: 'bg-ok-soft text-ok',
  maybe: 'bg-warn-soft text-warn',
  not_a_fit: 'bg-danger-soft text-danger',
};

/** A verdict's badge: its words and colours; null for none. */
export function verdictBadge(verdict: ScreeningVerdict | null | undefined): { label: string; className: string } | null {
  return verdict ? { label: SCREENING_VERDICT_LABELS[verdict], className: VERDICT_STYLE[verdict] } : null;
}

/** The lists' Verdict filter as the address carries it (recruitment.ts, beside the other filters). */
export { verdictOf } from './recruitment';

// ---------- the CV window ----------

/** The query parameter the CV window is opened by: ?cv=<the application's or general CV's id>. */
export const CV_PARAM = 'cv';

/** A CV's file: shown, or saved with ?download=1 (the web's routes, with the session). */
export const cvFileHref = (cv: Pick<CandidateCv, 'kind' | 'id'>, download = false): string => (cv.kind === 'application' ? applicantCvHref(cv.id, download) : generalCvFileHref(cv.id, download));

/** A CV as a PDF for the window: a PDF as it is, a Word file converted by the server's PDF service. */
export const cvPreviewHref = (cv: Pick<CandidateCv, 'kind' | 'id'>): string => `${cvFileHref(cv)}/preview`;

/** What a CV belongs to, in words: "Application APP-2026-0001 for Video Editor", "General CV APP-2026-0007". */
export function cvBelongsTo(cv: Pick<CandidateCv, 'kind' | 'reference' | 'title'>): string {
  const ref = shownCode(cv.reference);
  if (cv.kind === 'general_cv') return ref ? `General CV ${ref}` : 'General CV';
  return `Application${ref ? ` ${ref}` : ''}${cv.title ? ` for ${cv.title}` : ''}`;
}

/** The record's id in a key: "application:<id>" → <id>; null for "general". */
export const idOfKey = (key: string | null | undefined): string | null => {
  if (!key) return null;
  const i = key.indexOf(':');
  return i < 0 ? null : key.slice(i + 1) || null;
};

/** Which of the CVs a record's id opens: its own, or the one holding the same CV (a general CV added to a vacancy); -1 for none. */
export function cvIndexOf(cvs: readonly ScreeningCv[], recordId: string | null | undefined): number {
  if (!recordId) return -1;
  const own = cvs.findIndex((c) => c.id === recordId || idOfKey(c.key) === recordId);
  return own >= 0 ? own : cvs.findIndex((c) => idOfKey(c.linkedKey) === recordId);
}

/** The CV before or after one (`step` -1 or 1), going round from the last to the first; the same one when there's only one. */
export function stepCv(count: number, index: number, step: -1 | 1): number {
  if (count <= 0) return -1;
  return (((index + step) % count) + count) % count;
}

/** "2 of 5". */
export const cvPositionText = (index: number, count: number) => `${index + 1} of ${count}`;

/** The ?cv= read from an address's query ("" or none: no CV open). */
export const readCvParam = (search: string | URLSearchParams): string | null => {
  const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search;
  const v = params.get(CV_PARAM)?.trim();
  return v ? v : null;
};

/** An address's query with ?cv= set to `id` (null: taken away), the other parameters kept: "?tab=x&cv=…", or "" when none is left. */
export function withCvParam(search: string, id: string | null): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (id) params.set(CV_PARAM, id);
  else params.delete(CV_PARAM);
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** A page's own CV, for the window when the comments (with the candidate's CVs) couldn't be loaded. */
export function ownCv(
  kind: 'application' | 'general_cv',
  record: { id: string; reference: string; title: string; sentAt: string },
  file: { fileName: string; mimeType: string; sizeBytes: number } | null,
): ScreeningCv[] {
  if (!file) return [];
  return [
    {
      kind,
      id: record.id,
      reference: record.reference,
      title: record.title,
      cvFileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sentAt: record.sentAt,
      key: `${kind}:${record.id}`,
      linkedKey: null,
    },
  ];
}

/** The candidate profile's CVs as the window has them, when the comments couldn't be loaded (no linked records then). */
export const asScreeningCvs = (cvs: readonly CandidateCv[]): ScreeningCv[] => cvs.map((c) => ({ ...c, key: `${c.kind}:${c.id}`, linkedKey: null }));

/** The size of a file, "120 KB". */
export const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** A record's page on the site: an applicant's, or a general CV's. */
export const recordHref = (cv: Pick<CandidateCv, 'kind' | 'id'>) => (cv.kind === 'application' ? applicantHref(cv.id) : `/recruitment/general-cvs/${encodeURIComponent(cv.id)}`);

// ---------- the comments shown ----------

/** A record's comments on its page and in the CV window: its own, the one holding the same CV's, and the general ones. */
export function commentsOfRecord(data: Pick<ScreeningComments, 'comments' | 'targets'>, key: string): ScreeningCommentView[] {
  const linked = data.targets.find((t) => t.key === key)?.linkedKey ?? null;
  return recordComments(data.comments, [key, linked]);
}

/** A CV's comments in the window: its record's, the one holding the same CV's, and the general ones. */
export const commentsOfCv = (data: Pick<ScreeningComments, 'comments'>, cv: Pick<ScreeningCv, 'key' | 'linkedKey'>): ScreeningCommentView[] => recordComments(data.comments, [cv.key, cv.linkedKey]);

/** The profile card's filters: All, General, then each record with comments or not, with their counts. */
export function commentFilters(data: Pick<ScreeningComments, 'comments' | 'targets'>): { key: string; label: string; count: number }[] {
  const out = [{ key: 'all', label: 'All', count: data.comments.length }];
  for (const t of data.targets) out.push({ key: t.key, label: t.key === GENERAL_KEY ? 'General' : t.label, count: filteredComments(data.comments, t.key, data.targets).length });
  return out;
}

/**
 * Where a new comment goes by default: the page's own record (General on the candidate's profile) when it is one of the
 * targets, else, in the CV window, the CV's record (or the one holding the same CV), else the first target.
 */
export function defaultTargetKey(targets: readonly ScreeningTarget[], pageKey: string, cv?: Pick<ScreeningCv, 'key' | 'linkedKey'> | null): string {
  const has = (k: string | null | undefined) => !!k && targets.some((t) => t.key === k);
  if (cv) {
    if (pageKey === cv.key || pageKey === cv.linkedKey) return has(pageKey) ? pageKey : has(cv.key) ? cv.key : (targets[0]?.key ?? '');
    if (has(cv.key)) return cv.key;
    if (has(cv.linkedKey)) return cv.linkedKey!;
  }
  return has(pageKey) ? pageKey : (targets[0]?.key ?? '');
}

/** Who wrote a comment, as shown: their name, else their email, else "HR (earlier notes)", else a former user. */
export const authorName = (c: Pick<ScreeningCommentView, 'author' | 'authorLabel'>): string => c.author?.name ?? c.author?.email ?? c.authorLabel ?? 'A former user';

/** A comment's chip on a record's page: "General" for a general one, else what it is about. */
export const chipOf = (c: Pick<ScreeningCommentView, 'about' | 'aboutLabel'>): string => (c.about.kind === 'general' ? 'General' : c.aboutLabel);

/** Whether a comment is a general one, marked so on a record's page. */
export const isGeneral = (c: Pick<ScreeningCommentView, 'about'>): boolean => aboutKey(c.about) === GENERAL_KEY;

// ---------- @mentions ----------

/** The longest an @… being typed is looked up for (a full name, with spaces). */
const MENTION_QUERY_MAX = 40;

/**
 * The @mention being typed at the caret: what follows an @ (at the start, or after a space or a bracket) up to the caret,
 * on one line; null when none is.
 */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  const prev = at > 0 ? before[at - 1] : '';
  if (prev && !/[\s([{"'“‘]/.test(prev)) return null;
  const query = before.slice(at + 1);
  if (query.length > MENTION_QUERY_MAX || /[\n\r@]/.test(query) || /^\s/.test(query)) return null;
  return { start: at, query };
}

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * The colleagues offered for an @mention: those who may read a comment on the chosen target (its `mentionable`), whose
 * name or email has every word typed (a word's start), not chosen already; at most `max`, by name.
 */
export function mentionSuggestions(people: readonly ScreeningPerson[], mentionable: readonly string[], query: string, chosen: readonly string[] = [], max = 6): ScreeningPerson[] {
  const allowed = new Set(mentionable);
  const words = fold(query).split(/\s+/).filter(Boolean);
  return people
    .filter((p) => allowed.has(p.id) && !chosen.includes(p.id))
    .filter((p) => {
      const parts = fold(`${p.name} ${p.email}`).split(/[\s@._-]+/);
      return words.every((w) => parts.some((part) => part.startsWith(w)));
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, max);
}

/** The text with the @… being typed replaced by "@Name " and the caret after it. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const inserted = `@${name} `;
  const after = text.slice(caret).replace(/^ /, '');
  return { text: `${text.slice(0, start)}${inserted}${after}`, caret: start + inserted.length };
}

/** The mentions still meant: the people chosen whose "@Name" is still in the text (one deleted from it is dropped). */
export function keptMentions(text: string, chosen: readonly string[], people: readonly Pick<ScreeningPerson, 'id' | 'name'>[]): string[] {
  const byId = new Map(people.map((p) => [p.id, p.name]));
  return uniqueMentions(chosen).filter((id) => {
    const name = byId.get(id);
    return !!name && text.includes(`@${name}`);
  });
}

/** A comment's text in parts, the "@Name" of each one mentioned marked (the longest names first, so one inside another isn't cut). */
export function mentionParts(text: string, names: readonly string[]): { text: string; mention: boolean }[] {
  const wanted = [...new Set(names.filter((n) => n.trim()))].sort((a, b) => b.length - a.length);
  if (!wanted.length || !text) return text ? [{ text, mention: false }] : [];
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`@(?:${wanted.map(escape).join('|')})`, 'g');
  const out: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), mention: false });
    out.push({ text: m[0], mention: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false });
  return out;
}

// ---------- the form ----------

const field = (fd: FormData, name: string): string => {
  const v = fd.get(name);
  return typeof v === 'string' ? v.trim() : '';
};

/** What the comment form sends (POST /recruitment/comments, or PATCH /recruitment/comments/:id). */
export interface CommentBody {
  comment: string;
  verdict: ScreeningVerdict | null;
  mentions: string[];
}

/** The comment form read: its text, its verdict (none: no verdict), its mentions; or what is wrong, in words (the API checks again). */
export function commentForm(fd: FormData): { body: CommentBody | null; errors: string[] } {
  const comment = field(fd, 'comment');
  const verdictText = field(fd, 'verdict');
  const mentions = uniqueMentions(fd.getAll('mentions').filter((v): v is string => typeof v === 'string'));
  const errors = screeningCommentProblems({ comment, verdict: verdictText || null, mentions });
  if (errors.length) return { body: null, errors };
  return { body: { comment, verdict: (verdictText || null) as ScreeningVerdict | null, mentions }, errors: [] };
}

/** Where a new comment goes, as the API takes it: an application's, a general CV's, or (the candidate) a general one. */
export function targetBody(key: string, candidateId: string | null): { applicationId: string } | { generalCvId: string } | { candidateId: string } | null {
  const id = idOfKey(key);
  if (key.startsWith('application:') && id) return { applicationId: id };
  if (key.startsWith('general_cv:') && id) return { generalCvId: id };
  if (key === GENERAL_KEY && candidateId) return { candidateId };
  return null;
}

export const COMMENT_MAX = SCREENING_LIMITS.text;
