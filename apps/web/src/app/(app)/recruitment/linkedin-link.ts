import { isHidden } from '../../../lib/hidden';

// The LinkedIn link a page shows (owner, 29 October 2026: "the OCR is not filling the linkedin link like in the candidate
// profile"): the one typed on the form, else the one found in the CV (its text, or a link behind a "LinkedIn" word),
// marked as the CV's. Pure code, tested in linkedin-link.test.ts.

/** The link to show and whether it is the CV's; null with neither (or masked, a developer's view). */
export function linkedinShown(typed: string | null | undefined, fromCv: string | null | undefined): { href: string; fromCv: boolean } | null {
  if (typed) return isHidden(typed) ? null : { href: typed, fromCv: false };
  if (!fromCv || isHidden(fromCv)) return null;
  return { href: /^https?:\/\//i.test(fromCv) ? fromCv : `https://${fromCv}`, fromCv: true };
}
