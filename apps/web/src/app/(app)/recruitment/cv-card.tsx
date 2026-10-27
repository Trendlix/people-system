import Link from 'next/link';
import type { CvReadingView } from '@trendlix/shared';
import { getCurrentUser } from '@/lib/session';
import { CV_CARD_NOTE, cvTextMissing, latestRoleText, linksFound, moreFromCv, periodText, readingFacts, readingStatusText, shortLink, workHistoryHeading } from './cv-reading';
import { CvFitSection, FitPercent } from './cv-fit-ui';
import { NO_KEY_SKILLS_NOTE } from './cv-fit';
import { CvTextViewer } from './cv-text-viewer';
import { loadAgencyMarks, loadApplicantCvText, loadGeneralCvText } from './data';
import { AGENCY_MARKS_HREF, agencyFlag, agencyJobBadge, agencyJobCount, agencyJobsFor, hasMarkableCompany, markActionsFor, markIdOf, type AgencyMarkView, type MarkAction } from './agency';
import { removeAgencyMark, setAgencyMark } from './agency-actions';
import { AgencyMarkButtons } from './agency-ui';
import { managesRecruitment } from './recruitment';

// "From the CV" on the applicant page and the general CV page (owner, 22 October 2026: "make the OCR egine reads the CV
// and analyse it. is that applicable?"; "Built-in rules only"): the reading's status, the years (estimated from the
// dates), the education, the languages and the links found; for an applicant, the vacancy's key skills found ✓ and not
// ✗ with the CV match %; and the CV's text, folded. A hint for HR, never a decision: the stage and "filtered out" stay
// the screening questions'. A developer sees what was found but never the text or the links (the API refuses them).
// More since 24 October 2026 (owner: "is the pulled data all what can be pulled from the uploaded cv?"; "CV years in
// list + more rules"): the latest role and the city with the facts; the education details, the work history (folded),
// the dictionary's skills and the certifications, each when found. A developer's titles, companies, schools,
// certifications and city come masked ("••••").
// The CV match became the CV fit (owner, 25 October 2026: "aren't you supposed to match the candidate to the job based on
// the CV and ATS?"; "Full CV fit score"): its percent with the breakdown on hover or tap, and a CV Fit section with each
// part (key skills, title, experience, requirements, education), what it found and its share of the fit.
// Marketing agency background (owner, 27 October 2026: "when opening a job, can the OCR detect if his previous works are
// in agency?", then "i need a flag if the candidate is ex marketing agencies or not AND reflectin the scoring"; asked,
// "Show agency years" and "Name words + your list"): the flag "Ex-agency · 3 y 4 m" (or "Not ex-agency"; nothing when no
// work history was read), each job of the work history marked "Agency" (its name) or HR's mark, and for HR and a Super
// Admin, Mark as agency / Not an agency / Remove mark on each job with a company (never a developer's: hidden companies).

/** A mark's button: its server action bound to the company, or to the mark. */
function markButton(a: MarkAction) {
  return a.kind === 'set'
    ? { key: `set-${a.agency}`, action: setAgencyMark.bind(null, a.company, a.agency), label: a.label, pendingLabel: a.pendingLabel, confirm: a.confirm }
    : { key: 'remove', action: removeAgencyMark.bind(null, a.id), label: a.label, pendingLabel: a.pendingLabel, confirm: a.confirm };
}

export async function FromTheCv({ reading, subject }: { reading: CvReadingView; subject: { applicationId: string } | { generalCvId: string } }) {
  const forApplicant = 'applicationId' in subject;
  const read = reading.status === 'read';
  const more = moreFromCv(reading);
  const agencyJobs = read ? agencyJobsFor(more.workHistory, reading.agency) : [];
  const [text, user] = await Promise.all([
    read ? ('applicationId' in subject ? loadApplicantCvText(subject.applicationId) : loadGeneralCvText(subject.generalCvId)) : null,
    getCurrentUser(),
  ]);
  const links = text?.kind === 'ok' ? linksFound(text.value) : [];
  // HR's mark buttons (HR, a Super Admin): Remove mark needs the marks' ids, loaded only when a job has one
  const marksCompanies = managesRecruitment(user) && hasMarkableCompany(agencyJobs);
  const loadedMarks = marksCompanies && agencyJobs.some((j) => j?.by === 'mark') ? await loadAgencyMarks() : null;
  const marks: AgencyMarkView[] = loadedMarks?.kind === 'ok' ? loadedMarks.value : [];
  const flag = read ? agencyFlag(reading.agency) : null;
  return (
    <section aria-labelledby="from-the-cv" className="card space-y-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="from-the-cv" className="text-lg font-semibold">
          From the CV
        </h2>
        {/* the CV fit's percent (25 October 2026), its parts in CV Fit below; the key skills alone no longer make it */}
        {forApplicant && (
          <div className="text-sm">
            CV match <FitPercent percent={reading.cvMatchPercent} fit={reading.fit} className="font-semibold" />
          </div>
        )}
      </div>
      <p className={`text-sm ${reading.status === 'failed' ? 'text-warn' : 'text-muted'}`}>{readingStatusText(reading)}</p>
      {/* "Ex-agency · 3 y 4 m" (owner, 27 October 2026: "i need a flag if the candidate is ex marketing agencies or not") */}
      {flag && (
        <p className="text-sm">
          <span className={`badge ${flag.exAgency ? 'bg-accent-soft text-accent' : 'bg-canvas text-muted'}`} title={flag.title}>
            {flag.text}
          </span>
        </p>
      )}

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

      {forApplicant && reading.status === 'read' && reading.fit && <CvFitSection fit={reading.fit} id="from-the-cv-fit" />}

      {reading.status === 'read' && more.education.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Education Details</h3>
          <ul className="space-y-1 text-sm">
            {more.education.map((e, i) => (
              <li key={`${i}-${e}`} dir="auto">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {read && more.workHistory.length > 0 && (
        <details className="rounded-lg border border-line">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{workHistoryHeading(more.workHistory.length, agencyJobCount(agencyJobs))}</summary>
          <ol className="space-y-3 border-t border-line px-4 py-3 text-sm">
            {more.workHistory.map((w, i) => {
              const period = periodText(w);
              // each job marked agency or not (27 October 2026: "Show agency years"), HR's mark winning over its name
              const badge = agencyJobBadge(agencyJobs[i]);
              const actions = marksCompanies ? markActionsFor(w.pastCompany, agencyJobs[i] ?? null, markIdOf(marks, w.pastCompany)) : [];
              return (
                <li key={`${i}-${w.from ?? ''}`} className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span dir="auto">{latestRoleText(w.pastTitle, w.pastCompany)}</span>
                      {badge && (
                        <span className={`badge ${badge.agency ? 'bg-accent-soft text-accent' : 'bg-canvas text-muted'}`} title={badge.title}>
                          {badge.text}
                        </span>
                      )}
                    </span>
                    {period && <span className="text-muted tabular-nums">{period}</span>}
                  </div>
                  {actions.length > 0 && <AgencyMarkButtons company={w.pastCompany ?? ''} actions={actions.map(markButton)} />}
                </li>
              );
            })}
          </ol>
          {marksCompanies && (
            <p className="border-t border-line px-4 py-3 text-xs text-muted">
              A mark counts for every CV that names the company. <Link href={AGENCY_MARKS_HREF}>See all marketing agency marks</Link>
            </p>
          )}
        </details>
      )}

      {reading.status === 'read' && more.skills.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Skills</h3>
          <ul className="flex flex-wrap gap-2" aria-label="Skills named in the CV">
            {more.skills.map((s) => (
              <li key={s} className="badge bg-canvas text-ink">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {reading.status === 'read' && more.certifications.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Certifications</h3>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {more.certifications.map((c, i) => (
              <li key={`${i}-${c}`} dir="auto">
                {c}
              </li>
            ))}
          </ul>
        </div>
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
          <p className="text-sm text-muted">{NO_KEY_SKILLS_NOTE} Add them on the vacancy&apos;s form to see which the CV names.</p>
        ))}

      {text && (text.kind === 'ok' ? text.value.cvText && <CvTextViewer text={text.value.cvText} /> : <p className="text-sm text-muted">{cvTextMissing(text)}</p>)}

      <p className="text-xs text-muted">{CV_CARD_NOTE}</p>
    </section>
  );
}
