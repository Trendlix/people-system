import { vacancyConfirmed, type ApplicationDeletion, type VacancyDeletion } from '@trendlix/shared';
import { shownCode } from '@/lib/hidden';

// Deleting an applicant, or a vacancy people applied to (owner, 25 October 2026, on a closed vacancy with one rejected
// applicant: "i want to delete this"; asked, "Vacancy alone - applicant alone - superadmin only"): what the confirmation
// windows say goes, and why one stays. The API decides (packages/shared recruitment-deletes.ts); this only words it.
// Pure code, tested in deletes.test.ts.

/** "a, b and c". */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** What goes with an application, besides it: its interviews, comments and files, and the job offers drafted and never sent. */
function goesWith(d: Pick<ApplicationDeletion, 'draftOffers'>): string {
  const parts = ['interviews', 'comments', 'files'];
  if (d.draftOffers > 0) parts.push(d.draftOffers === 1 ? 'draft job offer' : 'draft job offers');
  return listed(parts);
}

/**
 * The applicant's confirmation: "This deletes APP-2026-0001, its interviews, comments and files. Their candidate profile
 * stays, as they have other records." or "…, and their candidate profile (CAN-0001)." when nothing else is left of them.
 */
export function applicationDeleteText(d: ApplicationDeletion): string {
  const what = `This deletes ${shownCode(d.number) ?? 'this application'}, its ${goesWith(d)}`;
  if (!d.candidate) return `${what}.`;
  if (!d.candidate.goes) return `${what}. Their candidate profile stays, as they have other records.`;
  const code = shownCode(d.candidate.code);
  return `${what}, and their candidate profile${code ? ` (${code})` : ''}.`;
}

/** The vacancy's confirmation: the vacancy alone, or with its applications and the candidate profiles nothing else is left of. */
export function vacancyDeleteText(d: VacancyDeletion): string {
  const number = shownCode(d.number) ?? 'this vacancy';
  const n = d.applications;
  if (n === 0) return `This deletes ${number}. Nobody has applied.`;
  const what =
    n === 1
      ? `This deletes ${number} and its application, with its interviews, comments and files.`
      : `This deletes ${number} and its ${n} applications, with their interviews, comments and files.`;
  const c = d.candidates;
  let profiles: string;
  if (c === 0) profiles = n === 1 ? 'Their candidate profile stays, as they have other records.' : 'Their candidate profiles stay, as they have other records.';
  else if (c >= n) profiles = n === 1 ? 'Their candidate profile goes too, as nothing else is left of it.' : 'Their candidate profiles go too, as nothing else is left of them.';
  else profiles = c === 1 ? 'One of their candidate profiles goes too, as nothing else is left of it; the others stay.' : `${c} of their candidate profiles go too, as nothing else is left of them; the others stay.`;
  return `${what} ${profiles}`;
}

/** Above the applications that stay, each on its own line: "One application stays on record, so the vacancy stays:". */
export function vacancyRefusalLead(count: number): string {
  return count === 1 ? 'One application stays on record, so the vacancy stays:' : `${count} applications stay on record, so the vacancy stays:`;
}

/** The box the vacancy's number is typed in: "Type VAC-2026-0001 to confirm". */
export const confirmLabel = (number: string): string => `Type ${number} to confirm`;

/**
 * Whether Delete can be pressed: nothing stays on record, and the vacancy's number typed when it has applications (the
 * shared rule: its case and the spaces around it don't matter).
 */
export function vacancyDeletable(d: Pick<VacancyDeletion, 'number' | 'refusals' | 'confirm'>, typed: string): boolean {
  if (d.refusals.length > 0) return false;
  return !d.confirm || vacancyConfirmed(typed, d.number);
}

/** What shows once it is gone: "APP-2026-0001 was deleted." */
export const deletedText = (number: string): string => `${shownCode(number) ?? 'It'} was deleted.`;

/** The API's answers for the vacancy's delete: ?confirm= with the number typed, when it has applications. */
export function vacancyDeletePath(id: string, confirm: string | null): string {
  const base = `/recruitment/vacancies/${encodeURIComponent(id)}`;
  const typed = confirm?.trim();
  return typed ? `${base}?confirm=${encodeURIComponent(typed)}` : base;
}

/** An applicant's page answered 404 (an old notification, email or audit link): deleted since, or not theirs to open. */
export const APPLICANT_GONE = 'This application isn’t here: it was deleted, or you can’t open it.';

/** The same for a vacancy deleted meanwhile. */
export const VACANCY_GONE = 'This vacancy isn’t here: it was deleted, or you can’t open it.';
