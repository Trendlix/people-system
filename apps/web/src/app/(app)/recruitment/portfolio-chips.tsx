import { EMAIL_CONFIRMED_LABEL, type EmailConfirmedBy } from '@trendlix/shared';
import { portfolioChip } from './portfolio';

// An applicant's or a general CV's portfolio on HR's pages (owner, 25 October 2026: "for creatives, they need to add
// their portfolios"; asked, "Portfolio per position"): each link a chip with its platform ("Vimeo · vimeo.com/123…"),
// opened in a new tab and never fetched by the system; the PDF case study, opened or saved like the CV; and the small
// "Confirmed by LinkedIn" mark by an email LinkedIn confirmed ("Fill in with LinkedIn"). Used on the application, the
// general CV, the candidate's profile and the CV window. No hooks: a server page or a client window shows them alike.

/** The links as chips, wrapping on a phone; `empty` without any. */
export function PortfolioChips({ links, empty = '—' }: { links: readonly string[]; empty?: React.ReactNode }) {
  if (!links.length) return <>{empty}</>;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Portfolio links">
      {links.map((link) => {
        const c = portfolioChip(link);
        const inner = (
          <>
            <span className="font-semibold">{c.platform}</span>
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
            <span className="min-w-0 truncate text-muted">{c.shown}</span>
          </>
        );
        return (
          <li key={link} className="max-w-full">
            {c.href ? (
              <a
                href={c.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={link}
                className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-line bg-card px-3 text-sm text-ink no-underline hover:border-accent hover:text-accent"
              >
                {inner}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <span title={link} className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-line px-3 text-sm">
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The PDF case study sent as a portfolio: Open (in the browser) and Download, with its size. */
export function PortfolioFileLinks({ file, href, downloadHref }: { file: { fileName: string; sizeBytes: number }; href: string; downloadHref: string }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center font-semibold">
        Open the PDF case study
      </a>
      <a href={downloadHref} className="inline-flex min-h-9 items-center">
        Download
      </a>
      <span className="text-muted">{Math.max(1, Math.round(file.sizeBytes / 1024))} KB</span>
    </span>
  );
}

/** "Confirmed by LinkedIn", by an email LinkedIn confirmed when the person filled in the form with it. */
export function LinkedInMark({ by }: { by?: EmailConfirmedBy | null }) {
  if (by !== 'linkedin') return null;
  return (
    <span className="badge ms-2 inline-flex items-center gap-1 bg-ok-soft align-middle text-ok" title="The person signed in with LinkedIn, and LinkedIn confirmed this email.">
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
        <path d="m4.5 10.5 3.5 3.5 7.5-8" />
      </svg>
      {EMAIL_CONFIRMED_LABEL}
    </span>
  );
}
