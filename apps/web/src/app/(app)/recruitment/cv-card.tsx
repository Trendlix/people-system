import type { CvReadingView } from '@trendlix/shared';
import { CV_CARD_NOTE, cvTextMissing, linksFound, readingFacts, readingStatusText, shortLink, skillsCountText } from './cv-reading';
import { CvTextViewer } from './cv-text-viewer';
import { loadApplicantCvText, loadGeneralCvText } from './data';
import { matchText } from './recruitment';

// "From the CV" on the applicant page and the general CV page (owner, 22 October 2026: "make the OCR egine reads the CV
// and analyse it. is that applicable?"; "Built-in rules only"): the reading's status, the years (estimated from the
// dates), the education, the languages and the links found; for an applicant, the vacancy's key skills found ✓ and not
// ✗ with the CV match %; and the CV's text, folded. A hint for HR, never a decision: the stage and "filtered out" stay
// the screening questions'. A developer sees what was found but never the text or the links (the API refuses them).

export async function FromTheCv({ reading, subject }: { reading: CvReadingView; subject: { applicationId: string } | { generalCvId: string } }) {
  const forApplicant = 'applicationId' in subject;
  const text = reading.status === 'read' ? await ('applicationId' in subject ? loadApplicantCvText(subject.applicationId) : loadGeneralCvText(subject.generalCvId)) : null;
  const links = text?.kind === 'ok' ? linksFound(text.value) : [];
  const count = skillsCountText(reading.skills);
  return (
    <section aria-labelledby="from-the-cv" className="card space-y-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="from-the-cv" className="text-lg font-semibold">
          From the CV
        </h2>
        {forApplicant && (
          <p className="text-sm">
            CV match <span className="font-semibold tabular-nums">{matchText(reading.cvMatchPercent)}</span>
            {count && reading.status === 'read' && <span className="text-muted tabular-nums"> ({count})</span>}
          </p>
        )}
      </div>
      <p className={`text-sm ${reading.status === 'failed' ? 'text-warn' : 'text-muted'}`}>{readingStatusText(reading)}</p>

      {reading.status === 'read' && (
        <dl className="grid gap-4 sm:grid-cols-3">
          {readingFacts(reading).map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-xs font-medium tracking-wide text-muted uppercase">{f.label}</dt>
              <dd className="mt-1 text-sm break-words">{f.value}</dd>
            </div>
          ))}
          {links.length > 0 && (
            <div className="min-w-0 sm:col-span-3">
              <dt className="text-xs font-medium tracking-wide text-muted uppercase">Links found</dt>
              <dd className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm break-all">
                {links.map((l) => (
                  <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow">
                    {shortLink(l)}
                  </a>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}

      {forApplicant &&
        (reading.skills ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Key Skills</h3>
            {reading.status === 'read' ? (
              <ul className="flex flex-wrap gap-2" aria-label="The vacancy's key skills">
                {reading.skills.found.map((s) => (
                  <li key={`found-${s}`} className="badge bg-ok-soft text-ok">
                    <span aria-hidden="true">✓ </span>
                    {s}
                    <span className="sr-only"> (found)</span>
                  </li>
                ))}
                {reading.skills.missing.map((s) => (
                  <li key={`missing-${s}`} className="badge bg-canvas text-muted">
                    <span aria-hidden="true">✗ </span>
                    {s}
                    <span className="sr-only"> (not found)</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Looked for once the CV&apos;s text is read: {[...reading.skills.found, ...reading.skills.missing].join(', ')}.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">The vacancy lists no key skills. Add them on its form to see which the CV names and its CV match.</p>
        ))}

      {text && (text.kind === 'ok' ? text.value.cvText && <CvTextViewer text={text.value.cvText} /> : <p className="text-sm text-muted">{cvTextMissing(text)}</p>)}

      <p className="text-xs text-muted">{CV_CARD_NOTE}</p>
    </section>
  );
}
