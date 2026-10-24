import { MEETING_PROVIDER_LABELS, providerOfLink, type InterviewView, type MeetingProvider } from '@trendlix/shared';
import { joinOf } from './meetings';

// An online interview's meeting where it is shown (owner, 24 October 2026: "automatically generate meeting links";
// "Google Meet, Microsoft Teams, Zoom"): the service's mark and name, and Join, on the applicant's page, Interviews and My
// Hiring. Join opens the meeting in a new tab. Nothing when there is no link (none yet, or hidden from a developer, who
// could otherwise join an interview).

/** A small mark for each service, drawn in the page's own colours (no outside images). */
const MARK: Readonly<Record<MeetingProvider, string>> = { google: 'G', microsoft: 'T', zoom: 'Z' };

export function MeetingJoin({ interview, compact = false }: { interview: Pick<InterviewView, 'kind' | 'location' | 'meeting'>; compact?: boolean }) {
  const join = joinOf(interview);
  const provider = interview.meeting?.provider ?? join?.provider ?? (interview.kind === 'online' ? providerOfLink(interview.location) : null);
  if (!join && !provider) return null;
  const name = provider ? MEETING_PROVIDER_LABELS[provider] : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {provider && (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <span aria-hidden="true" className="inline-flex size-5 items-center justify-center rounded bg-accent-soft text-xs font-bold text-accent">
            {MARK[provider]}
          </span>
          {name}
        </span>
      )}
      {join && (
        <a href={join.url} target="_blank" rel="noopener noreferrer nofollow" className={compact ? 'text-sm font-semibold' : 'btn btn-secondary min-h-9 px-3'}>
          Join<span className="sr-only"> the {name ?? 'online'} meeting</span>
        </a>
      )}
    </span>
  );
}
