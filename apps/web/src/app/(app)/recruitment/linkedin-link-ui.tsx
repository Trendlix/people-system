import { linkedinShown } from './linkedin-link';

/** "Open profile", the CV's marked "from the CV"; "—" with neither (29 October 2026). */
export function LinkedInProfileLink({ typed, fromCv, label = 'Open profile', empty = '—' }: { typed: string | null | undefined; fromCv: string | null | undefined; label?: string; empty?: string | null }) {
  const link = linkedinShown(typed, fromCv);
  if (!link) return empty;
  return (
    <>
      <a href={link.href} target="_blank" rel="noopener noreferrer nofollow">
        {label}
      </a>
      {link.fromCv && <span className="ms-2 text-xs text-muted">from the CV</span>}
    </>
  );
}
