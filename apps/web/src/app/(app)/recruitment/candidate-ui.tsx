import Link from 'next/link';
import {
  CANDIDATE_MATCH_KIND_LABELS,
  candidateEmployeeText,
  GENERAL_CV_SOURCE_LABELS,
  GENERAL_CV_STATUS_LABELS,
  REHIRE_LABELS,
  type CandidateApplication,
  type CandidateEmployeeLink,
  type CandidateGeneralCv,
  type PossibleMatchView,
} from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { dismissMatch, mergeCandidates } from './candidate-actions';
import { CANDIDATE_MATCHES_PATH, CANDIDATES_PATH, candidateHref, matchesCountText, mergeOrder, otherOf } from './candidates';
import { loadPossibleMatches } from './data';
import { ActionButton } from './forms';
import { generalCvHref } from './general';
import { applicantHref, matchText, vacancyHref } from './recruitment';
import { StageBadge } from './ui';
import { shownCode, withCodeInBrackets } from '@/lib/hidden';
import { Shown } from '@/components/hidden';

// Candidate profiles' pieces (owner, 22 October 2026: "how to make like a profile for each candidate to store history and
// prevent duplication?"; "Link and show rehire"; "HR decides from suggested match"): the Candidates tabs, the linked
// employee's card (a C-level person's only "Linked to an employee
// record" to HR), the possible matches with Merge and Not the same person, and a candidate's applications and general
// CVs.

/** The employee a candidate is: who, when and why they left, and whether they may be hired again. */
export function EmployeeCard({ link }: { link: CandidateEmployeeLink }) {
  const strong = link.state === 'former' && link.rehire === 'not_eligible';
  return (
    <section aria-labelledby="candidate-employee" className={`card space-y-2 p-6 ${strong ? 'border-danger/40' : ''}`}>
      <h2 id="candidate-employee" className="text-lg font-semibold">
        Employee Record
      </h2>
      <p className={`text-sm ${strong ? 'text-danger' : ''}`}>{candidateEmployeeText(link)}</p>
      {!link.restricted && link.employee && (
        <p className="text-sm">
          <Link href={`/employees/${link.employee.id}`}>
            {withCodeInBrackets(link.employee.fullNameEn, link.employee.employeeCode)}
          </Link>
          {link.rehire && <span className="text-muted"> · {REHIRE_LABELS[link.rehire]}</span>}
        </p>
      )}
      {!link.restricted && link.rehireReason && <p className="text-sm whitespace-pre-line text-muted">{link.rehireReason}</p>}
    </section>
  );
}

/**
 * The possible matches HR hasn't decided, strongest first: the other candidate, why, how strong; Merge (the older
 * candidate kept) and Not the same person for HR. `selfId`: the candidate whose page this is (none: both shown).
 */
export function MatchesCard({ matches, selfId, manages, heading = 'Possible Matches' }: { matches: PossibleMatchView[]; selfId: string | null; manages: boolean; heading?: string }) {
  if (!matches.length) return null;
  return (
    <section aria-labelledby="candidate-matches" className="card space-y-3 p-6">
      <h2 id="candidate-matches" className="text-lg font-semibold">
        {heading}
      </h2>
      <ul className="space-y-3">
        {matches.map((m) => (
          <MatchItem key={m.id} m={m} selfId={selfId} manages={manages} />
        ))}
      </ul>
    </section>
  );
}

export function MatchItem({ m, selfId, manages }: { m: PossibleMatchView; selfId: string | null; manages: boolean }) {
  const { kept, merged } = mergeOrder(m.candidates[0], m.candidates[1]);
  const shown = selfId ? [otherOf(m, selfId)] : m.candidates;
  // a candidate by their code, or by their name when the code is hidden (a developer's: 23 October 2026)
  const named = (c: { code: string; fullName: string }) => shownCode(c.code) ?? c.fullName;
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft pb-3 last:border-b-0 last:pb-0">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          {shown.map((c, i) => (
            <span key={c.id}>
              {i > 0 && <span className="text-muted">and </span>}
              <Link href={candidateHref(c.id)} className="font-semibold">
                {c.fullName}
              </Link>{' '}
              {shownCode(c.code) && <span className="text-sm text-muted">{c.code}</span>}
            </span>
          ))}
          <span className={`badge ${m.kind === 'duplicate' ? 'bg-danger-soft text-danger' : m.weak ? 'bg-canvas text-muted' : 'bg-accent-soft text-accent'}`}>
            {CANDIDATE_MATCH_KIND_LABELS[m.kind]}
          </span>
        </p>
        <p className="text-sm">
          {m.why}
          <span className="text-muted tabular-nums"> · {m.score}%</span>
          {m.weak && <span className="text-muted"> · a name alone is a weak sign</span>}
        </p>
        <p className="text-xs text-muted">
          {shown
            .map((c) => `${named(c)}: ${c.applications} ${c.applications === 1 ? 'application' : 'applications'}${c.generalCvs ? `, ${c.generalCvs} general CV${c.generalCvs === 1 ? '' : 's'}` : ''}${c.lastAppliedAt ? `, last ${formatDate(c.lastAppliedAt)}` : ''}`)
            .join(' · ')}
        </p>
      </div>
      {manages && (
        <div className="flex flex-wrap gap-2">
          <ActionButton
            action={mergeCandidates.bind(null, kept.id, merged.id)}
            label="Merge"
            pendingLabel="Merging…"
            kind="primary"
            confirm={`Merge ${named(merged)} into ${named(kept)}? Its applications, general CVs, emails, mobiles and employee link move to ${named(kept)}. A Super Admin can undo it.`}
          />
          <ActionButton action={dismissMatch.bind(null, m.id)} label="Not the same person" pendingLabel="Saving…" confirm={`${named(kept)} and ${named(merged)} are not the same person? They won’t be suggested again.`} />
        </div>
      )}
    </li>
  );
}

/** A candidate's applications: the job, when, the stage or outcome (the rejection's reason), the match and the CV match. */
export function CandidateApplicationsTable({ rows }: { rows: CandidateApplication[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Applied</th>
            <th>Stage</th>
            <th className="text-right">Match</th>
            <th className="text-right">CV match</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>
                <Link href={applicantHref(a.id)} className="font-semibold">
                  {a.vacancy.title}
                </Link>
                <span className="block text-xs text-muted">
                  {shownCode(a.number) && `${a.number} · `}
                  <Link href={vacancyHref(a.vacancy.id)} className="text-muted">
                    {a.vacancy.number}
                  </Link>
                </span>
              </td>
              <td className="text-sm whitespace-nowrap">{formatDate(a.appliedAt)}</td>
              <td>
                <StageBadge stage={a.stage} filteredOut={a.filteredOut} />
                {a.rejectReason && <span className="block max-w-xs text-xs text-muted">{a.rejectReason}</span>}
              </td>
              <td className="text-right tabular-nums">{matchText(a.matchPercent)}</td>
              <td className="text-right tabular-nums">{matchText(a.cvMatchPercent)}</td>
              <td className="text-sm">{a.sourceText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A candidate's general CVs: the reference, the area, how it came, where it stands. */
export function CandidateGeneralCvsTable({ rows }: { rows: CandidateGeneralCv[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>General CV</th>
            <th>Area</th>
            <th>Source</th>
            <th>Status</th>
            <th>Received</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.id}>
              <td>
                <Link href={generalCvHref(g.id)} className="font-semibold">
                  <Shown text={g.number} />
                </Link>
              </td>
              <td className="text-sm">{g.area}</td>
              <td className="text-sm">{GENERAL_CV_SOURCE_LABELS[g.source]}</td>
              <td className="text-sm">
                {GENERAL_CV_STATUS_LABELS[g.status]}
                {g.movedTo && (
                  <Link href={applicantHref(g.movedTo.applicationId)} className="block text-xs">
                    {shownCode(g.movedTo.reference) ?? 'Its application'}
                  </Link>
                )}
              </td>
              <td className="text-sm whitespace-nowrap">{formatDate(g.receivedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const tabClass = (on: boolean) =>
  `inline-flex min-h-10 items-center gap-2 border-b-2 px-1 text-sm font-semibold no-underline ${on ? 'border-ink text-ink hover:text-ink' : 'border-transparent text-muted hover:text-ink'}`;

/** The two tabs: the candidates, and the possible matches with their count (a badge when there are some). */
export async function CandidatesTabs({ on }: { on: 'list' | 'matches' }) {
  const loaded = await loadPossibleMatches();
  const m = loaded.kind === 'ok' ? loaded.value : null;
  const count = m ? m.duplicates.length + m.suggested.length : 0;
  return (
    <nav aria-label="Candidates" className="flex gap-6 border-b border-line">
      <Link href={CANDIDATES_PATH} className={tabClass(on === 'list')} aria-current={on === 'list' ? 'page' : undefined}>
        Candidates
      </Link>
      <Link href={CANDIDATE_MATCHES_PATH} className={tabClass(on === 'matches')} aria-current={on === 'matches' ? 'page' : undefined}>
        Possible matches
        {m && count > 0 && <span className="badge bg-accent-soft text-accent tabular-nums">{matchesCountText(m.duplicates.length, m.suggested.length)}</span>}
      </Link>
    </nav>
  );
}
